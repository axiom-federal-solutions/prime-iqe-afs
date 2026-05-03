// =============================================================
// AGENTS/DRAFT-BID.JS — Generate Google Sheet draft from approved bid
// JOB: Take an approved bid, pull all related data (opportunity + pricing +
//      compliance + supplier matches), build a federal-bid-ready Google Sheet,
//      save the URL back to `proposals` table, transition bid to drafted.
// SCHEDULE: workflow_dispatch (manual with bid_id input) +
//           hourly cron in batch mode (drains bids.status='approved')
// COST: ~$0/month (Drive + Sheets API are free; minimal Anthropic spend)
// SAFETY: Never auto-submits to government — always staged for Mr. Kemp.
// =============================================================

const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');
const { ensureFolder, createSheetInFolder, getFileMeta } = require('../lib/google-drive');
const { writeRange, renameFirstTab, buildDraftRows }     = require('../lib/google-sheets');
const { createDocFromTemplate }                          = require('../lib/google-docs');

const BATCH_LIMIT     = 5;   // up to 5 drafts per run; Sonnet API time-budget
const ROOT_FOLDER     = 'PRIME — Federal Bid Drafts';

// 2026-05-03: optional Google Doc template ID. If set, the agent ALSO
// creates a Doc from this template alongside the Sheet, with placeholders
// like {{TITLE}} {{AGENCY}} {{VALUE}} replaced. Set as GitHub Secret.
const TEMPLATE_DOC_ID = process.env.GOOGLE_TEMPLATE_DOC_ID || null;

// ----------------------------------------------------------
// MAIN: single-bid CLI mode OR batch (drain approved queue)
// ----------------------------------------------------------
async function runDraftBid() {
  const enabled = await isAgentEnabled('DRAFT-BID');
  if (!enabled) process.exit(0);

  const bidIdArg = process.argv[2];

  if (bidIdArg) {
    console.log('DRAFT-BID: single mode — bid ' + bidIdArg);
    try {
      await draftOneBid(bidIdArg);
    } catch (err) {
      console.error('DRAFT-BID ERROR:', err.message);
      await logAction('DRAFT-BID', 'Draft failed', { bidId: bidIdArg, error: err.message });
      process.exit(1);
    }
    return;
  }

  // Batch mode — pull all approved bids that don't have a proposal yet
  console.log('DRAFT-BID: batch mode — checking for approved bids without drafts');
  const { data: queue, error } = await supabase
    .from('bids')
    .select('id, opportunity_id, decision_date, status')
    .eq('status', 'approved')
    .order('decision_date', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    await logAction('DRAFT-BID', 'Batch queue read failed', { error: error.message });
    process.exit(1);
  }
  if (!queue || queue.length === 0) {
    await logAction('DRAFT-BID', 'No approved bids waiting for draft', { checked_at: new Date().toISOString() });
    return;
  }

  // Filter out any that already have a proposals row
  const ids = queue.map(b => b.id);
  const { data: existing } = await supabase
    .from('proposals')
    .select('bid_id')
    .in('bid_id', ids);
  const haveDrafts = new Set((existing || []).map(p => p.bid_id));
  const toDraft = queue.filter(b => !haveDrafts.has(b.id));

  if (toDraft.length === 0) {
    await logAction('DRAFT-BID', 'All approved bids already have drafts', { checked: queue.length });
    return;
  }

  let drafted = 0, failed = 0;
  for (const bid of toDraft) {
    try {
      await draftOneBid(bid.id);
      drafted++;
    } catch (err) {
      failed++;
      console.warn('DRAFT-BID: failed bid ' + bid.id + ' —', err.message);
      await logAction('DRAFT-BID', 'Bid draft failed (batch)', { bidId: bid.id, error: err.message });
    }
  }
  await logAction('DRAFT-BID', 'Batch run complete', { checked: toDraft.length, drafted, failed });
  console.log('DRAFT-BID: batch done — ' + drafted + ' drafted, ' + failed + ' failed.');
}

// ----------------------------------------------------------
// CORE: build one draft for one bid
// ----------------------------------------------------------
async function draftOneBid(bidId) {
  // 1. Pull bid + opportunity in one query
  const { data: bid, error: bidErr } = await supabase
    .from('bids')
    .select('*, opportunities(*)')
    .eq('id', bidId)
    .single();
  if (bidErr || !bid) throw new Error('Bid not found: ' + bidId);

  const opp = bid.opportunities || {};
  console.log('DRAFT-BID: drafting for "' + (opp.title || bidId) + '"');

  // 2. Pull supplier matches for this solicitation (for sub plans section)
  let suppliers = [];
  if (opp.solicitation_number) {
    const { data: matches } = await supabase
      .from('supplier_matches')
      .select(`match_score, match_type, suppliers(name, state, certifications, socioeconomic, federal_contract_count, avg_contract_value)`)
      .eq('solicitation_number', opp.solicitation_number)
      .order('match_score', { ascending: false })
      .limit(10);
    suppliers = matches || [];
  }

  // 3. Compliance checks already attached to bid (VAULT writes to bids.compliance_checks JSONB)
  const compliance = Array.isArray(bid.compliance_checks) ? bid.compliance_checks : [];

  // 4. Ensure root folder exists in PrimeOps1's Drive
  console.log('DRAFT-BID: ensuring Drive folder exists...');
  const folderId = await ensureFolder(ROOT_FOLDER);

  // 5. Create the Sheet inside the folder
  const sheetTitle = `${(opp.solicitation_number || bidId).slice(0, 32)} — ${(opp.title || 'Federal Bid').slice(0, 60)}`;
  console.log('DRAFT-BID: creating sheet "' + sheetTitle + '"');
  const sheet = await createSheetInFolder(sheetTitle, folderId);

  // 6. Rename the first tab + populate the data
  await renameFirstTab(sheet.spreadsheetId, 'Bid Draft');
  const rows = buildDraftRows({ opp, bid, compliance, suppliers });
  // Write rows to A1:C{N}
  const range = `Bid Draft!A1:C${rows.length}`;
  await writeRange(sheet.spreadsheetId, range, rows);

  // 7. (Optional) Generate the Doc from template if GOOGLE_TEMPLATE_DOC_ID configured
  let docInfo = null;
  if (TEMPLATE_DOC_ID) {
    try {
      console.log('DRAFT-BID: generating Doc from template ' + TEMPLATE_DOC_ID + '...');
      docInfo = await createDocFromTemplate(
        TEMPLATE_DOC_ID,
        sheetTitle.replace(/^📊 /, '📋 '), // same title, different emoji prefix
        folderId,
        { opp, bid, compliance, suppliers }
      );
      console.log('DRAFT-BID: Doc created — ' + docInfo.documentUrl);
    } catch (docErr) {
      // Doc failure shouldn't block Sheet creation — log and continue.
      console.warn('DRAFT-BID: Doc generation failed (Sheet still created):', docErr.message);
      await logAction('DRAFT-BID', 'Doc generation failed (Sheet ok)', {
        bid_id: bidId,
        template_id: TEMPLATE_DOC_ID,
        error: docErr.message,
      });
    }
  }

  // 8. Insert proposals row + transition bid status
  const { error: proposalErr } = await supabase.from('proposals').insert({
    bid_id:           bidId,
    opportunity_id:   opp.id,
    drive_file_id:    sheet.spreadsheetId,
    drive_folder_id:  folderId,
    sheet_url:        sheet.spreadsheetUrl,
    sheet_title:      sheetTitle,
    doc_file_id:      docInfo?.documentId || null,
    doc_url:          docInfo?.documentUrl || null,
    status:           'draft',
  });
  if (proposalErr) throw new Error('Proposal insert failed: ' + proposalErr.message);

  await supabase.from('bids').update({ status: 'drafted' }).eq('id', bidId);

  console.log('DRAFT-BID: ✅ done');
  console.log('  Sheet: ' + sheet.spreadsheetUrl);
  if (docInfo) console.log('  Doc:   ' + docInfo.documentUrl);

  await logAction('DRAFT-BID', 'Draft created', {
    bid_id:        bidId,
    opportunity:   opp.title,
    sheet_url:     sheet.spreadsheetUrl,
    sheet_id:      sheet.spreadsheetId,
    doc_url:       docInfo?.documentUrl || null,
    doc_id:        docInfo?.documentId  || null,
    rows_written:  rows.length,
    placeholders_replaced: docInfo?.placeholderCount || 0,
    suppliers:     suppliers.length,
    compliance_checks: compliance.length,
  });
}

runDraftBid().catch(err => {
  console.error('DRAFT-BID: unhandled error —', err);
  process.exit(1);
});
