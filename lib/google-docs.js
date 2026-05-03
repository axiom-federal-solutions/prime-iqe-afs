// =============================================================
// LIB/GOOGLE-DOCS.JS — Google Docs API helpers
// JOB: Copy a template Doc, run replaceAllText to substitute placeholders
//      like {{TITLE}}, {{AGENCY}}, {{VALUE}}, etc.
// USED BY: agents/draft-bid.js
// SCOPE NEEDED: drive.file (copy file) + spreadsheets is NOT needed for Docs
//               but the original consent for spreadsheets+drive.file works.
//               If you only granted drive.file, that's enough — Docs is a Drive
//               file type and Docs API uses the same auth.
// =============================================================

const { googleFetch } = require('./google-auth');
const { copyFile, getFileMeta } = require('./google-drive');

const DOCS_API = 'https://docs.googleapis.com/v1/documents';

/**
 * Run a batchUpdate on a Doc — used to bulk-replace all placeholder tokens.
 * `replacements` shape: { '{{TITLE}}': 'My Bid Title', '{{AGENCY}}': 'USACE', ... }
 */
async function replacePlaceholders(documentId, replacements) {
  const requests = Object.entries(replacements).map(([token, value]) => ({
    replaceAllText: {
      containsText: { text: token, matchCase: true },
      replaceText:  String(value == null ? '' : value),
    },
  }));
  if (requests.length === 0) return null;

  const res = await googleFetch(`${DOCS_API}/${documentId}:batchUpdate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ requests }),
  });
  return await res.json();
}

/**
 * Get a Doc's plain text (for verification or fallback rendering).
 */
async function getDocText(documentId) {
  const res = await googleFetch(`${DOCS_API}/${documentId}`);
  const data = await res.json();
  // Walk the body content to extract plain text
  let text = '';
  for (const el of (data.body?.content || [])) {
    if (el.paragraph) {
      for (const run of (el.paragraph.elements || [])) {
        if (run.textRun?.content) text += run.textRun.content;
      }
    }
  }
  return text;
}

/**
 * Copy a template Doc into a folder, run placeholder replacements, return
 * the new file id + webViewLink.
 *
 * `data` shape — same as buildDraftRows in google-sheets.js:
 *   { opp, bid, compliance, suppliers }
 */
async function createDocFromTemplate(templateDocId, newName, destFolderId, data) {
  // Step 1: copy the template
  const copy = await copyFile(templateDocId, newName, destFolderId);
  const newDocId = copy.id;

  // Step 2: build the placeholder map from data
  const replacements = buildPlaceholderMap(data);

  // Step 3: run the batch replace
  await replacePlaceholders(newDocId, replacements);

  // Step 4: return final metadata
  const meta = await getFileMeta(newDocId);
  return {
    documentId:    newDocId,
    documentUrl:   meta.webViewLink || `https://docs.google.com/document/d/${newDocId}`,
    placeholders:  replacements,
    placeholderCount: Object.keys(replacements).length,
  };
}

/**
 * Build the placeholder dictionary from opportunity + bid + compliance + suppliers.
 * Follows the same field set as the Sheet's buildDraftRows for consistency.
 *
 * Mr. Kemp's template can use any subset of these tokens. Tokens that don't
 * exist in the template are simply ignored — no error.
 */
function buildPlaceholderMap(data) {
  const o = data.opp || {};
  const bid = data.bid || {};
  const pricing = bid.pricing_data || {};
  const compliance = Array.isArray(data.compliance) ? data.compliance : [];
  const suppliers  = Array.isArray(data.suppliers)  ? data.suppliers  : [];

  const fmtMoney = v => v != null ? '$' + Number(v).toLocaleString() : '—';
  const fmtDate  = v => v ? new Date(v).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';

  // Build text representations of multi-line content
  const pricingBreakdown = (() => {
    if (!pricing.breakdown) return '—';
    return Object.entries(pricing.breakdown).map(([k, v]) =>
      `  ${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? fmtMoney(v) : v}`
    ).join('\n');
  })();

  const complianceTable = (() => {
    if (compliance.length === 0) return 'VAULT has not yet checked this bid.';
    return compliance.map(c => `  • ${c.check}: ${c.status}${c.note ? ' — ' + c.note : ''}`).join('\n');
  })();

  const supplierList = (() => {
    if (suppliers.length === 0) return 'No supplier matches yet — run RECON Supplier Scan.';
    return suppliers.slice(0, 10).map((s, i) => {
      const sup = s.suppliers || s;
      const certs = (sup.certifications || sup.socioeconomic || []).join(', ') || 'No certs on file';
      return `  ${i + 1}. ${sup.name || 'Unknown'} (${sup.state || '—'}) · Score ${s.match_score || '—'} · ${certs}`;
    }).join('\n');
  })();

  return {
    // Company info — these are always the same
    '{{COMPANY_NAME}}':     'Walker Contractors LLC',
    '{{COMPANY_DBA}}':      'Axiom Federal Solutions',
    '{{COMPANY_CAGE}}':     process.env.CAGE_CODE || '7JKKO',
    '{{COMPANY_UEI}}':      process.env.SAM_UEI   || 'USMQMFAGL9M4',
    '{{COMPANY_CONTACT}}':  'Mr. Kemp, Managing Member',
    '{{COMPANY_EMAIL}}':    'PrimeOpps1@gmail.com',
    '{{COMPANY_ADDRESS}}':  'New Orleans, Louisiana 70114',

    // Date stamps
    '{{TODAY}}':            fmtDate(new Date()),
    '{{GENERATED_AT}}':     new Date().toLocaleString('en-US'),
    '{{GENERATED_DATE}}':   fmtDate(new Date()),

    // Opportunity facts
    '{{TITLE}}':                 o.title || '—',
    '{{SOLICITATION_NUMBER}}':   o.solicitation_number || '—',
    '{{AGENCY}}':                o.agency || '—',
    '{{NAICS}}':                 o.naics || '—',
    '{{PSC}}':                   o.psc || '—',
    '{{SET_ASIDE}}':             o.set_aside || 'Full and Open',
    '{{STATE}}':                 o.state || o.place_of_performance || '—',
    '{{VALUE}}':                 fmtMoney(o.value),
    '{{POSTED_DATE}}':           fmtDate(o.posted_date),
    '{{DEADLINE}}':              fmtDate(o.deadline || o.response_deadline),
    '{{NOTICE_URL}}':            o.notice_url || '—',
    '{{DESCRIPTION}}':           (o.description || '').slice(0, 1500) || '—',

    // Scoring (whichever applies — use {{SCORE}} as a generic alias)
    '{{PRIME_SCORE}}':           o.prime_score != null ? String(o.prime_score) : '—',
    '{{ACQ_SCORE}}':             o.acq_score   != null ? String(o.acq_score)   : '—',
    '{{LEASE_SCORE}}':           o.lease_score != null ? String(o.lease_score) : '—',
    '{{SCORE}}':                 String(o.prime_score || o.acq_score || o.lease_score || '—'),
    '{{TIER}}':                  o.tier || '—',
    '{{RECOMMENDATION}}':        o.recommendation || '—',
    '{{REASONING}}':             o.reasoning || 'JUDGE has not run on this opportunity yet.',

    // Pricing (from BID ENGINE)
    '{{PRICING_MODEL}}':         pricing.model || '—',
    '{{PRICING_SOURCE}}':        pricing.pricing_source || '—',
    '{{PRICING_BASE}}':          fmtMoney(pricing.base),
    '{{PRICING_ESCALATED}}':     fmtMoney(pricing.escalated || pricing.base),
    '{{PRICING_TOTAL}}':         fmtMoney(pricing.total_if_all_years),
    '{{PRICING_BREAKDOWN}}':     pricingBreakdown,
    '{{PRICING_NOTE}}':          pricing.note || '',
    '{{COMPETITOR_AVG}}':        fmtMoney(pricing.competitor_avg),

    // Compliance (from VAULT)
    '{{COMPLIANCE_STATUS}}':     bid.compliance_status || 'pending',
    '{{COMPLIANCE_TABLE}}':      complianceTable,

    // Suppliers / teaming
    '{{SUPPLIER_LIST}}':         supplierList,
    '{{SUPPLIER_COUNT}}':        String(suppliers.length),
  };
}

module.exports = {
  replacePlaceholders,
  getDocText,
  createDocFromTemplate,
  buildPlaceholderMap,
};
