// =============================================================
// LIB/GOOGLE-SHEETS.JS — Sheets v4 API helpers (minimal, no SDK)
// JOB: Write cells in batches, format headers, build the federal-bid
//      draft template programmatically.
// USED BY: agents/draft-bid.js
// SCOPE NEEDED: spreadsheets
// =============================================================

const { googleFetch } = require('./google-auth');

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Write a 2D array of values into a target range using A1 notation.
 *   writeRange(sheetId, 'Sheet1!A1:B3', [['Title','Walker'],['NAICS','236220'],['Value','$500K']])
 */
async function writeRange(spreadsheetId, range, values) {
  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await googleFetch(url, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ values }),
  });
  return await res.json();
}

/**
 * Batch update — runs multiple operations in one API call.
 * Use for things like creating extra sheets/tabs, formatting, merging cells.
 *   batchUpdate(sheetId, [{updateSheetProperties: {...}}, {addSheet: {...}}])
 */
async function batchUpdate(spreadsheetId, requests) {
  const url = `${SHEETS_API}/${spreadsheetId}:batchUpdate`;
  const res = await googleFetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ requests }),
  });
  return await res.json();
}

/**
 * Convenience: rename the default first sheet/tab so it's not just "Sheet1".
 */
async function renameFirstTab(spreadsheetId, newName) {
  // Get sheet meta to find the first sheet's id
  const metaRes = await googleFetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties(sheetId,title,index)`);
  const meta = await metaRes.json();
  const first = (meta.sheets || []).find(s => s.properties.index === 0);
  if (!first) return;
  await batchUpdate(spreadsheetId, [{
    updateSheetProperties: {
      properties: { sheetId: first.properties.sheetId, title: newName },
      fields:     'title',
    },
  }]);
}

/**
 * Convenience: build the standard federal-bid draft layout in one shot.
 * Writes section headers, opportunity facts, pricing, compliance, action items.
 * Returns the rows written so caller can log them.
 *
 * `data` shape:
 *   {
 *     opp:        opportunity row from supabase
 *     bid:        bid row including pricing_data
 *     compliance: array of compliance check objects
 *     suppliers:  array of matched supplier rows (for sub plans)
 *   }
 */
function buildDraftRows(data) {
  const o = data.opp || {};
  const bid = data.bid || {};
  const pricing = bid.pricing_data || {};
  const fmt = v => v != null ? '$' + Number(v).toLocaleString() : '';

  const rows = [];
  // Header
  rows.push(['📋 PRIME — FEDERAL BID DRAFT', '', '']);
  rows.push(['Generated', new Date().toLocaleString('en-US'), '']);
  rows.push(['Walker Contractors LLC', 'DBA: Axiom Federal Solutions', 'CAGE: 7JKKO']);
  rows.push(['', '', '']);

  // Section 1: Opportunity Summary
  rows.push(['1. OPPORTUNITY SUMMARY', '', '']);
  rows.push(['Title',           o.title || '',                     '']);
  rows.push(['Solicitation #',  o.solicitation_number || '',       '']);
  rows.push(['Agency',          o.agency || '',                    '']);
  rows.push(['NAICS',           o.naics || '',                     '']);
  rows.push(['Set-Aside',       o.set_aside || 'Full and Open',    '']);
  rows.push(['State',           o.state || '',                     '']);
  rows.push(['Estimated Value', fmt(o.value),                       '']);
  rows.push(['Posted',          o.posted_date || '',               '']);
  rows.push(['Deadline',        o.deadline || o.response_deadline || '', '']);
  rows.push(['SAM.gov Link',    o.notice_url || '',                '']);
  rows.push(['', '', '']);

  // Section 2: PRIME Score & Recommendation
  rows.push(['2. SCORING (JUDGE)', '', '']);
  rows.push(['PRIME Score',     o.prime_score != null ? o.prime_score : '', '']);
  rows.push(['ACQ Score',       o.acq_score   != null ? o.acq_score   : '', '']);
  rows.push(['LEASE Score',     o.lease_score != null ? o.lease_score : '', '']);
  rows.push(['Tier',            o.tier || '',                     '']);
  rows.push(['Recommendation',  o.recommendation || '',           '']);
  rows.push(['JUDGE Reasoning', o.reasoning || '',                '']);
  rows.push(['', '', '']);

  // Section 3: Pricing (from BID ENGINE)
  rows.push(['3. PRICING (BID ENGINE)', '', '']);
  if (pricing.base) {
    rows.push(['Pricing Model',   pricing.model || '',                  '']);
    rows.push(['Pricing Source',  pricing.pricing_source || '',         '']);
    rows.push(['Year-1 Bid',      fmt(pricing.base),                    '']);
    rows.push(['Final-Year Bid',  fmt(pricing.escalated || pricing.base), '']);
    if (pricing.total_if_all_years) rows.push(['Total If All Years',  fmt(pricing.total_if_all_years), '']);
    const bd = pricing.breakdown || {};
    Object.keys(bd).forEach(k => {
      rows.push(['  ' + k.replace(/_/g, ' '), fmt(bd[k]), '']);
    });
    if (pricing.competitor_avg) rows.push(['Competitor Avg', fmt(pricing.competitor_avg), '']);
    if (pricing.note)           rows.push(['Pricing Note',  pricing.note,                 '']);
  } else {
    rows.push(['Pricing not yet calculated', 'Run BID ENGINE on this opportunity', '']);
  }
  rows.push(['', '', '']);

  // Section 4: Compliance / Eligibility (from VAULT)
  rows.push(['4. COMPLIANCE (VAULT)', '', '']);
  if (Array.isArray(data.compliance) && data.compliance.length) {
    rows.push(['Status', bid.compliance_status || 'pending', '']);
    rows.push(['Check', 'Result', 'Note']);
    data.compliance.forEach(c => rows.push([c.check, c.status, c.note || '']));
  } else {
    rows.push(['VAULT has not yet checked this bid', 'Run VAULT manually or wait for daily 5:30 AM run', '']);
  }
  rows.push(['', '', '']);

  // Section 5: Sub / Teaming (from supplier_matches)
  rows.push(['5. SUB / TEAMING CANDIDATES', '', '']);
  if (Array.isArray(data.suppliers) && data.suppliers.length) {
    rows.push(['Match Score', 'Supplier', 'State / Certs']);
    data.suppliers.slice(0, 10).forEach(s => {
      const sup = s.suppliers || s;
      const certs = (sup.certifications || sup.socioeconomic || []).join(', ');
      rows.push([s.match_score || '', sup.name || '—', `${sup.state || '—'} · ${certs}`]);
    });
  } else {
    rows.push(['No supplier matches yet', 'Run RECON Supplier Scan to populate', '']);
  }
  rows.push(['', '', '']);

  // Section 6: Next actions
  rows.push(['6. NEXT ACTIONS', '', '']);
  rows.push(['☐ Confirm bid bond if value > $150K (FAR 28.102-1)', '', '']);
  rows.push(['☐ Pull Davis-Bacon wage determination from SAM.gov', '', '']);
  rows.push(['☐ Verify Trevor Monnie partnership letter on file', '', '']);
  rows.push(['☐ Review compliance checks above — none can be FAIL at submission', '', '']);
  rows.push(['☐ Sign + submit through SAM.gov before deadline', '', '']);
  rows.push(['', '', '']);

  return rows;
}

module.exports = { writeRange, batchUpdate, renameFirstTab, buildDraftRows };
