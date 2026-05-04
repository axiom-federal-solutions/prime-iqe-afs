// =============================================================
// DRAFT.JS — Document & Response Automated Filing Tool
// JOB: Write federal bid proposals, compliance matrices, memos
// SCHEDULE: On-demand only — triggered when Mr. Kemp approves a bid
// COST: ~$4/month (Claude Sonnet for proposals, Haiku for memos)
// SAFETY RULE: DRAFT NEVER sends anything automatically.
//   Everything goes to BRANDI for Mr. Kemp's review first.
// =============================================================

// Load helper tools
const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');
const { claudeSonnet, claudeHaiku } = require('../lib/claude');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, VerticalAlign,
  Header, Footer, PageNumber,
} = require('docx');

// Our company info — used in every proposal we write
const COMPANY = {
  legal_name: 'Walker Contractors LLC',
  dba: 'Axiom Federal Solutions',
  cage_code: process.env.CAGE_CODE || '7JKKO',           // Confirmed CAGE code (letter O, not zero)
  uei: process.env.SAM_UEI || 'USMQMFAGL9M4',           // Confirmed UEI
  naics_primary: '236220',
  certifications: 'SDB (Small Disadvantaged Business)',
  contact: 'Joseph Walker IV, Owner / CEO',
  email: 'PrimeOpps1@gmail.com',
  phone: process.env.COMPANY_PHONE || '504-975-5495',
  address: 'New Orleans, Louisiana 70114',
  specialty: 'federal construction, commercial building, civil infrastructure, and property management in the Gulf South region',
  teaming_partners: 'Trevor L. Monnie Landscape Services — Louisiana Licensed Landscape Horticulturist (License No. 26-5023)',
};

// Max proposals to draft per batch run — Sonnet calls are expensive
// (~$0.50/proposal). Cap at 3 to keep monthly spend predictable while
// still draining a normal day's approval queue in one cron tick.
const DRAFT_BATCH_LIMIT = 3;

// ----------------------------------------------------------
// MAIN FUNCTION: Generate a complete proposal package
//   CLI mode:   node agents/draft.js <bidId>
//   Batch mode: node agents/draft.js   (no arg)
//   In batch mode DRAFT looks for bids that Mr. Kemp has explicitly
//   approved — bids.status='approved' — never auto-drafts. This
//   preserves the human-in-the-loop rule from the system spec.
// 2026-05-01 BUG FIX: DRAFT was workflow_dispatch-only with required bid_id
// input. Once Mr. Kemp approves a bid in BRANDI, nothing actually triggered
// DRAFT — proposals never got written. Batch mode unblocks this when a
// scheduled workflow runs `node agents/draft.js` with no arg.
// ----------------------------------------------------------
async function runDraft() {
  const bidId = process.argv[2];

  // Per-agent kill switch
  const enabled = await isAgentEnabled('DRAFT');
  if (!enabled) process.exit(0);

  if (bidId) {
    // ── Single-bid mode (manual workflow_dispatch) ────────────────────
    console.log('DRAFT: Single mode — bid ' + bidId);
    try {
      await generateProposal(bidId);
      console.log('DRAFT: Proposal complete — queued for Mr. Kemp review in BRANDI.');
    } catch (err) {
      console.error('DRAFT ERROR:', err.message);
      await logAction('DRAFT', 'Proposal generation failed', { bidId, error: err.message });
      process.exit(1);
    }
    return;
  }

  // ── Batch mode: drain Mr. Kemp's approved-bid queue ───────────────
  console.log('DRAFT: Batch mode — checking for approved bids needing proposals (limit ' + DRAFT_BATCH_LIMIT + ')');

  const { data: queue, error: queueErr } = await supabase
    .from('bids')
    .select('id, opportunity_id, decision_date')
    .eq('status', 'approved')
    .order('decision_date', { ascending: true })
    .limit(DRAFT_BATCH_LIMIT);

  if (queueErr) {
    console.error('DRAFT: Queue read failed —', queueErr.message);
    await logAction('DRAFT', 'Batch queue read failed', { error: queueErr.message });
    process.exit(1);
  }

  if (!queue || queue.length === 0) {
    console.log('DRAFT: No approved bids waiting for proposal generation.');
    await logAction('DRAFT', 'Batch run — no approved bids', { checked_at: new Date().toISOString() });
    return;
  }

  console.log('DRAFT: ' + queue.length + ' approved bids in queue. Drafting now...');

  let drafted = 0;
  let failed  = 0;
  for (const row of queue) {
    try {
      // generateProposal() transitions status to 'draft_ready' (or
      // 'supply_quote_ready' on the supply branch) internally on success —
      // we don't overwrite it here. This keeps BRANDI's review queue
      // (`status IN ['draft_ready','supply_quote_ready','pending_review']`)
      // working as designed.
      await generateProposal(row.id);
      drafted++;
    } catch (err) {
      failed++;
      console.warn('DRAFT: Failed bid ' + row.id + ' —', err.message);
      await logAction('DRAFT', 'Proposal generation failed (batch)', {
        bidId: row.id,
        error: err.message,
      });
      // Park the bid so Mr. Kemp can see why it stalled, and so the next
      // batch run doesn't keep retrying the same broken bid.
      await supabase
        .from('bids')
        .update({ status: 'draft_failed' })
        .eq('id', row.id);
    }
  }

  await logAction('DRAFT', 'Batch run complete', {
    checked: queue.length,
    drafted,
    failed,
  });
  console.log('DRAFT: Batch done — ' + drafted + ' drafted, ' + failed + ' failed.');
}

// Supply NAICS codes — these get a short-form quote, not 4-volume
const SUPPLY_NAICS = ['424710', '424130', '424490', '424120', '424410'];

// Real Estate & Rental NAICS — lease offers, property mgmt proposals, rental agreements
const RE_NAICS = [
  '531110', '531120', '531190', '531210',
  '531311', '531312', '531390',
  '532120', '532412',
];

// ----------------------------------------------------------
// GENERATE PROPOSAL: Route to construction, supply, or real estate format
//   Construction: 4-volume federal proposal package
//   Supply:       1-2 page short-form quote + capability statement
//   Real Estate:  Lease offer + property mgmt plan + RE capability statement
// ----------------------------------------------------------
async function generateProposal(bidId) {
  // Load the bid and its linked opportunity from the database
  const bid = await getBidWithOpportunity(bidId);
  if (!bid) throw new Error('Bid not found: ' + bidId);
  // BUG FIX 2026-05-04: FK join can return null opportunities if record was deleted
  if (!bid.opportunities) throw new Error('Opportunity data missing for bid: ' + bidId + ' — re-link the bid or re-run SCOUT');

  const naics = bid.opportunities.naics || '';

  // Route to real estate format — lease offers follow GSA Form 1364 structure
  if (RE_NAICS.some(n => naics.startsWith(n))) {
    console.log('DRAFT: Real Estate opportunity detected — using lease/property mgmt template');
    return generateRealEstateProposal(bidId, bid);
  }

  // Route to supply short-form
  if (SUPPLY_NAICS.includes(naics)) {
    console.log('DRAFT: Supply opportunity detected — using short-form template');
    return generateSupplyProposal(bidId, bid);
  }

  console.log('DRAFT: Generating proposal for "' + bid.opportunities.title + '"');

  // Load past performance on similar contracts
  const pastPerf = await getRelevantPastPerformance(bid.opportunities.naics);

  // Get the pricing from BID ENGINE (already stored in the bid record)
  const pricing = await getBidEnginePricing(bidId);

  // ----------------------------------------------------------
  // STEP 1: Build the compliance matrix
  // This maps every RFP requirement to the proposal page that answers it
  // ----------------------------------------------------------
  const requirements = await extractRequirements(bid.opportunities);
  const matrix = await buildComplianceMatrix(requirements, bidId);

  // ----------------------------------------------------------
  // STEP 2: Write the 4 proposal volumes using Claude Sonnet
  // Sonnet writes higher-quality proposals than Haiku
  // ----------------------------------------------------------
  console.log('DRAFT: Writing Technical Approach (Volume 1)...');
  const technical = await claudeSonnet(buildTechnicalPrompt(bid, requirements));

  console.log('DRAFT: Writing Management Plan (Volume 2)...');
  const management = await claudeSonnet(buildManagementPrompt(bid));

  console.log('DRAFT: Writing Past Performance (Volume 3)...');
  const pastPerformance = await claudeSonnet(buildPPPrompt(pastPerf, bid));

  console.log('DRAFT: Building Price Proposal (Volume 4)...');
  const price = buildPriceVolume(pricing);

  // ----------------------------------------------------------
  // STEP 3: Write a bid/no-bid recommendation memo
  // Short summary for Mr. Kemp's morning review
  // ----------------------------------------------------------
  const bidMemo = await claudeHaiku(
    'Write a concise 3-paragraph bid/no-bid recommendation memo for a federal IT opportunity. ' +
    'Company: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
    'Specialty: ' + COMPANY.specialty + '. ' +
    'Opportunity details: ' + JSON.stringify({
      title: bid.opportunities.title,
      agency: bid.opportunities.agency,
      value: bid.opportunities.value,
      naics: bid.opportunities.naics,
      prime_score: bid.opportunities.prime_score,
      set_aside: bid.opportunities.set_aside,
    }) +
    '. Format: (1) Opportunity overview, (2) Why we are competitive, (3) Recommendation and key risks. Be direct.'
  );

  // ----------------------------------------------------------
  // STEP 4: Save everything — NEVER auto-send
  // All documents wait in the database for Mr. Kemp's approval
  // ----------------------------------------------------------
  await storeDraft(bidId, {
    technical,
    management,
    pastPerformance,
    price,
    bidMemo,
    matrix,
    // Pass opportunity context through so generateProposalDocx() can fill in cover page fields
    _opp: {
      title:           bid.opportunities.title || '',
      agency:          bid.opportunities.agency || '',
      naics:           bid.opportunities.naics || '',
      value:           bid.opportunities.value || 0,
      set_aside:       bid.opportunities.set_aside || 'Full and Open Competition',
      solicitation_id: bid.opportunities.solicitation_id || bid.opportunities.id || '',
      posted_date:     bid.opportunities.posted_date || '',
      deadline:        bid.opportunities.response_deadline || bid.opportunities.deadline || '',
      psc:             bid.opportunities.psc || '',
    },
  });

  await queueForBrandiReview(bidId, 'PROPOSAL_READY');

  await logAction('DRAFT', 'Proposal generated — awaiting Mr. Kemp approval', {
    bidId,
    opportunity: bid.opportunities.title,
    agency: bid.opportunities.agency,
    volumes: ['technical', 'management', 'past_performance', 'price'],
    compliance_requirements: requirements.length,
    pricing_available: !!pricing,
  });
}

// ----------------------------------------------------------
// GENERATE SUPPLY PROPOSAL: Short-form 1-2 page quote for supply contracts
// Supply contracts don't need 4 volumes — just a clean quote + cap statement
// Drop-ship model: Walker never touches the product, distributor ships direct
// ----------------------------------------------------------
async function generateSupplyProposal(bidId, bid) {
  const opp = bid.opportunities;
  console.log('DRAFT: Building supply quote for "' + opp.title + '"');

  // Get supply pricing from BID ENGINE (distributor cost + markup already calculated)
  const pricing = await getBidEnginePricing(bidId);

  // Build the short-form quote using Claude Haiku (fast, cheap — supply is simple)
  const supplyQuote = await claudeHaiku(
    'Write a 1-page federal supply quote for a government purchase order. ' +
    'Company: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
    'UEI: ' + COMPANY.uei + '. ' +
    'Certifications: ' + COMPANY.certifications + '. ' +
    'Opportunity: ' + opp.title + ' | Agency: ' + opp.agency + ' | NAICS: ' + opp.naics + '. ' +
    'Pricing: ' + JSON.stringify(pricing || { note: 'BID ENGINE pricing pending' }) + '. ' +
    'Include: (1) company header, (2) product/service line items with unit price and total, ' +
    '(3) delivery terms — drop-ship direct from distributor to government facility, ' +
    '(4) payment terms — net 30 per FAR 52.232-25, ' +
    '(5) certifications and set-aside eligibility, ' +
    '(6) vendor contact info. Keep it under 1 page. Be direct and professional.'
  );

  // Build a 1-page capability statement for OSDBU / pre-solicitation use
  const capStatement = await claudeHaiku(
    'Write a 1-page capability statement for supply contracting. ' +
    'Company: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
    'Certifications: ' + COMPANY.certifications + '. ' +
    'Supply categories: Petroleum/Fuel (424710), Janitorial/Paper (424130), ' +
    'PPE (424490), Office Supplies (424120), Food & Beverage (424410). ' +
    'Model: Drop-ship direct to government facility — no warehousing required. ' +
    'Include: core competencies, past performance summary, contact info. ' +
    'Keep it to 1 page max.'
  );

  // Save — still goes through BRANDI review, never auto-sent
  await storeDraft(bidId, {
    supplyQuote,
    capStatement,
    pricing,
    type: 'supply',
  });

  await queueForBrandiReview(bidId, 'SUPPLY_QUOTE_READY');

  await logAction('DRAFT', 'Supply quote generated — awaiting Mr. Kemp approval', {
    bidId,
    opportunity: opp.title,
    agency: opp.agency,
    naics: opp.naics,
    format: 'short-form supply quote + capability statement',
    pricing_available: !!pricing,
  });
}

// ----------------------------------------------------------
// GENERATE REAL ESTATE PROPOSAL: Lease offer + property mgmt plan + RE cap statement
//
// Federal real estate contracting has two main forms:
//   1. Lease offers (NAICS 531120) — GSA Form 1364 format, offered by property owners
//   2. Property management contracts (531311/531312) — operational management proposals
//   3. Other RE services (531190/531210/531390) — advisory, brokerage, appraisal
//   4. Equipment/vehicle rental (532120/532412) — FEMA/USACE surge support
//
// Key differentiator: Trevor Monnie (LA Licensed Landscape Horticulturist #26-5023)
// enables compliant grounds/landscape maintenance on federal or regulated properties —
// a credential most competing property managers cannot match in Louisiana.
// ----------------------------------------------------------
async function generateRealEstateProposal(bidId, bid) {
  const opp = bid.opportunities;
  const naics = opp.naics || '';
  const value = opp.value || 0;

  console.log('DRAFT: Building real estate proposal for "' + opp.title + '" (NAICS ' + naics + ')');

  // Determine sub-type based on NAICS to tailor the proposal correctly
  const isLease     = naics.startsWith('531110') || naics.startsWith('531120') || naics.startsWith('531190');
  const isPropMgmt  = naics.startsWith('531311') || naics.startsWith('531312');
  const isRental    = naics.startsWith('532120') || naics.startsWith('532412');
  const isOtherRE   = naics.startsWith('531210') || naics.startsWith('531390');

  // Get past performance from our records
  const pastPerf = await getRelevantPastPerformance(naics);

  // ── BID/NO-BID MEMO ─────────────────────────────────────────────────────
  const bidMemo = await claudeHaiku(
    'Write a concise 3-paragraph bid/no-bid recommendation memo for a federal real estate opportunity. ' +
    'Company: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
    'Location: New Orleans, Louisiana — Gulf South region specialist. ' +
    'Certifications: ' + COMPANY.certifications + '. ' +
    'Key differentiator: Teaming partner Trevor L. Monnie, Louisiana Licensed Landscape Horticulturist ' +
    '(License No. 26-5023), enabling compliant grounds maintenance on regulated/government properties. ' +
    'Opportunity: ' + opp.title + ' | Agency: ' + (opp.agency || 'Federal Agency') +
    ' | NAICS: ' + naics + ' | Value: $' + value.toLocaleString() + '. ' +
    'Paragraphs: (1) Opportunity overview and why it fits our profile, ' +
    '(2) Our competitive advantage — location, certifications, teaming partner credential, ' +
    '(3) Go/No-Go recommendation and key risk factors. Be direct and specific.'
  );

  // ── LEASE OFFER (for 531110/531120/531190 — property owner offering space to agency) ──
  let leaseOffer = null;
  if (isLease) {
    leaseOffer = await claudeSonnet(
      'You are writing a federal lease offer in response to a GSA or agency solicitation for real property. ' +
      'Company/Offeror: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
      'UEI: ' + COMPANY.uei + ' | CAGE: ' + COMPANY.cage_code + '. ' +
      'Opportunity: ' + opp.title + ' | Agency: ' + (opp.agency || 'Agency') +
      ' | NAICS: ' + naics + ' | Estimated Value: $' + value.toLocaleString() + '. ' +
      'Write a professional federal lease offer document following GSA Form 1364 structure. Include: ' +
      '(1) Offeror identification and SAM registration confirmation, ' +
      '(2) Property description — location, square footage, building class, year built, ADA compliance, ' +
      '(3) Offered rental rate ($/RSF/year) and total annual rent, ' +
      '(4) Lease term offered (initial term + options), ' +
      '(5) Space configuration — office layout, parking, loading, security features, ' +
      '(6) Building systems — HVAC, electrical capacity, fire suppression, IT infrastructure, ' +
      '(7) Tenant improvement allowance offered, ' +
      '(8) Energy efficiency certifications (LEED, ENERGY STAR) if applicable, ' +
      '(9) ADA and ABAAS compliance statement, ' +
      '(10) Proximity to federal buildings, transit, and amenities. ' +
      'Use [BRACKET PLACEHOLDERS] for specifics to be filled in before submission. ' +
      'Tone: formal, FAR-compliant, professional. Target length: 3-4 pages.'
    );
  }

  // ── PROPERTY MANAGEMENT PROPOSAL (for 531311/531312) ──────────────────
  let propMgmtPlan = null;
  if (isPropMgmt) {
    propMgmtPlan = await claudeSonnet(
      'You are writing a property management proposal for a federal government contract. ' +
      'Company: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
      'UEI: ' + COMPANY.uei + ' | CAGE: ' + COMPANY.cage_code + '. ' +
      'Certifications: ' + COMPANY.certifications + '. ' +
      'Key differentiator: Teaming partner ' + COMPANY.teaming_partners + ' — ' +
      'enables compliant landscape and grounds maintenance on government-adjacent and regulated properties. ' +
      'Opportunity: ' + opp.title + ' | Agency: ' + (opp.agency || 'Agency') +
      ' | NAICS: ' + naics + ' | Value: $' + value.toLocaleString() + '. ' +
      'Write a federal property management proposal. Include: ' +
      '(1) Management approach — daily operations, preventive maintenance schedule, work order system, ' +
      '(2) Staffing plan — property manager qualifications, on-site staff, 24/7 emergency contact, ' +
      '(3) Maintenance programs — HVAC, plumbing, electrical, roofing inspection schedule, ' +
      '(4) Grounds & landscape maintenance — explain the Louisiana Licensed Landscape Horticulturist credential ' +
      '    (Trevor L. Monnie, License No. 26-5023) and why it ensures compliant turf/plant care on federal properties, ' +
      '(5) Tenant relations and federal agency coordination protocol, ' +
      '(6) Reporting — monthly property condition reports, financial statements, work order logs, ' +
      '(7) Security and access control procedures, ' +
      '(8) Emergency response and business continuity plan. ' +
      'Tone: professional, FAR-compliant. Target length: 4 pages.'
    );
  }

  // ── RENTAL/EQUIPMENT CAPABILITY (for 532120/532412) ───────────────────
  let rentalQuote = null;
  if (isRental) {
    rentalQuote = await claudeHaiku(
      'Write a federal equipment/vehicle rental quote in response to a FEMA or USACE solicitation. ' +
      'Company: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
      'NAICS: ' + naics + '. ' +
      'Certifications: ' + COMPANY.certifications + '. Gulf South region specialist. ' +
      'Opportunity: ' + opp.title + ' | Agency: ' + (opp.agency || 'Agency') + '. ' +
      'Include: (1) equipment/vehicle list with daily/weekly/monthly rates, ' +
      '(2) delivery capability to Gulf South states (LA, MS, TX, AL, FL), ' +
      '(3) operator availability if required, ' +
      '(4) insurance and bonding confirmation, ' +
      '(5) surge capacity for disaster response. Target: 1-2 pages.'
    );
  }

  // ── RE CAPABILITY STATEMENT (all RE types) ────────────────────────────
  const reCapStatement = await claudeHaiku(
    'Write a 1-page capability statement for federal real estate contracting. ' +
    'Company: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
    'UEI: ' + COMPANY.uei + ' | CAGE: ' + COMPANY.cage_code + '. ' +
    'Certifications: ' + COMPANY.certifications + '. ' +
    'Location: New Orleans, Louisiana — serving Gulf South region (LA, MS, TX, AL, FL). ' +
    'Real estate services: property leasing (531120), property management (531311/531312), ' +
    'grounds/landscape maintenance via licensed teaming partner ' + COMPANY.teaming_partners + '. ' +
    'Key credential: Louisiana Licensed Landscape Horticulturist on teaming team — ' +
    'enables compliant grounds maintenance on federal and regulated properties. ' +
    'Include: (1) company overview, (2) federal RE service capabilities, (3) certifications, ' +
    '(4) Gulf South market knowledge, (5) past performance summary, (6) contact info. ' +
    'Keep to 1 page. Be specific about federal real estate experience.'
  );

  // ── SAVE ALL GENERATED CONTENT ────────────────────────────────────────
  await storeDraft(bidId, {
    type: 'realestate',
    bidMemo,
    leaseOffer,       // populated for 531110/531120/531190
    propMgmtPlan,     // populated for 531311/531312
    rentalQuote,      // populated for 532120/532412
    reCapStatement,   // always generated
    naicsSubtype: isLease ? 'lease' : isPropMgmt ? 'property_mgmt' : isRental ? 'rental' : 'other_re',
  });

  await queueForBrandiReview(bidId, 'RE_PROPOSAL_READY');

  await logAction('DRAFT', 'Real estate proposal generated — awaiting Mr. Kemp approval', {
    bidId,
    opportunity: opp.title,
    agency: opp.agency,
    naics,
    subtype: isLease ? 'lease_offer' : isPropMgmt ? 'property_management' : isRental ? 'equipment_rental' : 'other_re',
    sections_generated: [
      'bidMemo',
      isLease ? 'leaseOffer' : null,
      isPropMgmt ? 'propMgmtPlan' : null,
      isRental ? 'rentalQuote' : null,
      'reCapStatement',
    ].filter(Boolean),
  });
}

// ----------------------------------------------------------
// EXTRACT REQUIREMENTS: Pull the RFP requirements from the opportunity
// These are the items the proposal must address
// ----------------------------------------------------------
async function extractRequirements(opportunity) {
  // Future version: fetch and parse actual RFP PDF from SAM.gov
  // For now, return the standard federal construction RFP structure (Sections L & M)
  const baseReqs = [
    { section: 'L.1', requirement: 'Technical Approach — construction methodology, phasing, safety plan (EM 385-1-1)', volume: 1 },
    { section: 'L.2', requirement: 'Management Plan — key personnel, QC plan (3-phase), CPM schedule', volume: 2 },
    { section: 'L.3', requirement: 'Past Performance — 3 similar federal construction projects', volume: 3 },
    { section: 'L.4', requirement: 'Price Proposal — complete bid schedule with unit prices', volume: 4 },
    { section: 'M.1', requirement: 'Technical evaluation — soundness of approach and understanding of scope', volume: 1 },
    { section: 'M.2', requirement: 'Management evaluation — superintendent qualifications, QC plan quality', volume: 2 },
    { section: 'M.3', requirement: 'Past performance evaluation — relevance and CPARS ratings', volume: 3 },
    { section: 'M.4', requirement: 'Price evaluation — lowest price technically acceptable', volume: 4 },
  ];

  // Add bond requirement section for contracts over $150K
  const naics = opportunity.naics || '';
  const value = opportunity.value || 0;
  if (value > 150000) {
    baseReqs.push(
      { section: 'L.5', requirement: 'Bid Bond — 20% of bid amount per FAR 52.228-1', volume: 4 },
      { section: 'L.6', requirement: 'Performance & Payment Bond commitment letter from surety', volume: 4 }
    );
  }

  return baseReqs;
}

// ----------------------------------------------------------
// BUILD COMPLIANCE MATRIX: Map each requirement to proposal sections
// ----------------------------------------------------------
async function buildComplianceMatrix(requirements, bidId) {
  const matrixRows = requirements.map(req => ({
    section: req.section,
    requirement: req.requirement,
    volume: req.volume,
    page_reference: 'Volume ' + req.volume + ', Section ' + req.section,
    addressed_by: COMPANY.legal_name,
    compliant: true,
  }));

  const compliancePct = (matrixRows.filter(r => r.compliant).length / matrixRows.length) * 100;

  // Save compliance matrix to database
  await supabase.from('compliance_matrices').insert({
    bid_id: bidId,
    solicitation_id: bidId,
    requirements: matrixRows,
    compliance_pct: compliancePct,
  });

  return requirements;
}

// ----------------------------------------------------------
// PROMPT BUILDERS: Instructions for Claude Sonnet on what to write
// ----------------------------------------------------------

// ----------------------------------------------------------
// PROMPT BUILDERS — all return JSON so generateProposalDocx() can
// populate tables, checkboxes, and structured sections directly.
// Each prompt instructs Claude to return ONLY valid JSON — no markdown,
// no prose outside the JSON object.
// ----------------------------------------------------------

function buildTechnicalPrompt(bid, requirements) {
  const opp = bid.opportunities;
  return (
    'You are a federal proposal writer for ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
    'NAICS specialty: ' + COMPANY.specialty + '.\n\n' +
    'OPPORTUNITY:\n' +
    '  Title: ' + opp.title + '\n' +
    '  Agency: ' + (opp.agency || 'Federal Agency') + '\n' +
    '  Value: $' + (opp.value ? opp.value.toLocaleString() : 'TBD') + '\n' +
    '  NAICS: ' + (opp.naics || '') + '\n' +
    '  Set-Aside: ' + (opp.set_aside || 'Full and Open Competition') + '\n\n' +
    'Return ONLY a JSON object — no markdown, no extra text. Schema:\n' +
    '{\n' +
    '  "exec_overview": "2-3 sentence opportunity overview",\n' +
    '  "value_proposition": "2-3 sentence competitive advantage statement",\n' +
    '  "qualifications": "2-3 sentence summary of relevant qualifications",\n' +
    '  "scope_description": "2-3 paragraph description of the work scope",\n' +
    '  "methodology": "2-3 paragraph technical methodology",\n' +
    '  "milestones": [\n' +
    '    {"task": "Task name", "start_week": "Week 1", "end_week": "Week 2", "deliverable": "Deliverable name"}\n' +
    '  ],\n' +
    '  "deliverables": "Paragraph listing key deliverables",\n' +
    '  "sow_compliance": "Statement that our approach addresses all SOW requirements"\n' +
    '}\n\n' +
    'The milestones array must have 5–8 realistic project milestones for a federal ' +
    (opp.naics || 'construction') + ' contract. ' +
    'Be specific to this opportunity. Use professional FAR-compliant language. ' +
    'Requirements addressed: ' + requirements.filter(r => r.volume === 1).map(r => r.requirement).join('; ')
  );
}

function buildManagementPrompt(bid) {
  const opp = bid.opportunities;
  return (
    'You are a federal proposal writer for ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + ').\n\n' +
    'OPPORTUNITY: ' + opp.title + ' | Agency: ' + (opp.agency || 'Federal Agency') + '\n\n' +
    'Return ONLY a JSON object — no markdown, no extra text. Schema:\n' +
    '{\n' +
    '  "approach": "2-3 paragraph management approach narrative",\n' +
    '  "personnel": [\n' +
    '    {"name": "string", "title": "string", "responsibility": "string", "years_exp": number}\n' +
    '  ]\n' +
    '}\n\n' +
    'The personnel array MUST include:\n' +
    '  1. Joseph Walker IV — Owner/CEO — Program oversight, contract authority\n' +
    '  2. A Project Manager (placeholder name OK)\n' +
    '  3. A Site Superintendent (for construction) or Technical Lead\n' +
    '  4. A Quality Control Manager\n' +
    '  5. Trevor L. Monnie — Landscape Horticulturist (License No. 26-5023) — if grounds/exterior work involved\n\n' +
    'Each entry: realistic years_exp (10–25), specific responsibility relevant to this opportunity. ' +
    'Professional, FAR-compliant tone.'
  );
}

function buildPPPrompt(pastPerf, bid) {
  const opp = bid.opportunities;
  const examples = pastPerf.length > 0
    ? pastPerf.slice(0, 3).map(c =>
        (c.title || 'Federal Contract') + ' — ' + (c.agency || 'Agency') +
        ' — $' + ((c.value || 0).toLocaleString())
      ).join('; ')
    : 'Federal construction and facilities contracts in the Gulf South region';

  return (
    'You are a federal proposal writer for ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + ').\n\n' +
    'OPPORTUNITY: ' + opp.title + ' | Agency: ' + (opp.agency || 'Federal Agency') + '\n' +
    'Known past performance: ' + examples + '\n\n' +
    'Return ONLY a JSON object — no markdown, no extra text. Schema:\n' +
    '{\n' +
    '  "narrative": "1-2 paragraph past performance summary",\n' +
    '  "projects": [\n' +
    '    {\n' +
    '      "project_name": "string",\n' +
    '      "client": "string",\n' +
    '      "contract_value": "$XXX,XXX",\n' +
    '      "period": "MM/YYYY – MM/YYYY",\n' +
    '      "scope": "1-2 sentence scope description",\n' +
    '      "reference": "Reference Name, Title, Phone"\n' +
    '    }\n' +
    '  ]\n' +
    '}\n\n' +
    'Include 2–3 projects. If past performance data is limited, create realistic placeholder entries ' +
    'for Gulf South federal construction contracts. Mark placeholders with [VERIFY BEFORE SUBMISSION]. ' +
    'Professional CPARS-compliant tone.'
  );
}

function buildPriceVolume(pricing) {
  // Price volume comes from BID ENGINE output — just format it
  if (!pricing) {
    return {
      note: 'BID ENGINE pricing not yet available — run bidengine.js first',
      placeholder: true,
    };
  }

  return {
    model: pricing.model,
    base_year: pricing.base_year,
    total_all_years: pricing.total_all_years,
    option_years: pricing.option_years,
    yearly_breakdown: pricing.yearly,
    labor_categories: pricing.team,
    odcs: pricing.odcs,
    indirect_rates: pricing.indirect_rates,
    notes: 'Pricing includes fully burdened labor rates per FAR 52.215-2. ODCs itemized separately.',
  };
}

// ----------------------------------------------------------
// HELPERS: Database operations
// ----------------------------------------------------------

async function getBidWithOpportunity(bidId) {
  const { data } = await supabase
    .from('bids')
    .select('*, opportunities(*)')
    .eq('id', bidId)
    .single();
  return data;
}

async function getRelevantPastPerformance(naics) {
  // BUG FIX 2026-05-04: was reading from active_contracts (wrong table).
  // past_performance is the curated CPARS-style table — same one loaded as PAST_PERF in dashboard.
  const { data } = await supabase
    .from('past_performance')
    .select('*')
    .order('performance_end', { ascending: false })
    .limit(5);
  // Fall back to active_contracts if past_performance table is empty
  if (data && data.length > 0) return data;
  const { data: contracts } = await supabase
    .from('active_contracts')
    .select('*')
    .order('value', { ascending: false })
    .limit(5);
  return contracts || [];
}

async function getBidEnginePricing(bidId) {
  const { data } = await supabase
    .from('bids')
    .select('pricing_data')
    .eq('id', bidId)
    .single();
  return data?.pricing_data || null;
}

async function storeDraft(bidId, volumes) {
  // Attach metadata so dashboard can display and name the Google Doc properly
  const payload = {
    ...volumes,
    _meta: {
      generated_at:  new Date().toISOString(),
      generated_by:  'DRAFT agent (Claude Sonnet)',
      company:       COMPANY.legal_name,
      dba:           COMPANY.dba,
      cage:          COMPANY.cage_code,
      uei:           COMPANY.uei,
      certifications: COMPANY.certifications,
    },
  };

  // Generate a real .docx file and store it base64-encoded in the JSONB payload.
  // Dashboard "Download DOCX" button decodes and downloads this directly.
  try {
    const docxBuf = await generateProposalDocx(volumes);
    payload._docx_b64 = docxBuf.toString('base64');
    console.log('DRAFT: .docx generated — ' + Math.round(docxBuf.length / 1024) + ' KB');
  } catch (docxErr) {
    console.warn('DRAFT: .docx generation failed (non-fatal) —', docxErr.message);
    // Proposal text is still stored — download button will be disabled in dashboard
  }

  // BUG FIX 2026-05-04: check Supabase update error — silent failure left bids stuck in 'approved'
  const { error: updateErr } = await supabase
    .from('bids')
    .update({
      status:       'draft_ready',
      proposal_url: 'stored_in_db',
      proposal_data: payload,
    })
    .eq('id', bidId);
  if (updateErr) {
    throw new Error('storeDraft: Supabase update failed — ' + updateErr.message);
  }
}

// ----------------------------------------------------------
// GENERATE PROPOSAL DOCX: Build an 11-section Word document matching the
// WalkerContractors_BidTemplate structure. Uses the `docx` npm package.
// Returns a Buffer.
//
// SECTION MAP:
//   Cover Page | TOC | §1 Executive Summary | §2 Bidder Info | §3 Scope of Work
//   §4 Past Performance | §5 Management & Staffing | §6 Pricing
//   §7 Required Certifications | §8 Compliance & Legal | §9 Docs Checklist
//   §10 Addenda Acknowledgment | §11 Attachments/Exhibits
// ----------------------------------------------------------
async function generateProposalDocx(volumes) {

  // ── CONSTANTS ──────────────────────────────────────────────────────────────
  const PAGE_WIDTH    = 9360;  // content width in DXA (US Letter 12240 - 2x1440 margins)
  const BLUE_DARK     = '1a3a6b';
  const BLUE_HEADER   = '2E5FA3';
  const GRAY_ROW      = 'E8ECF1';
  const TODAY         = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  // Opportunity info (passed through from generateProposal)
  const opp = volumes._opp || {};
  const SOL_NUM   = opp.solicitation_id || '[SOLICITATION #]';
  const OPP_TITLE = opp.title           || '[OPPORTUNITY TITLE]';
  const AGENCY    = opp.agency          || '[AGENCY]';
  const PSC       = opp.psc             || '[PSC CODE]';
  const POSTED    = opp.posted_date     ? new Date(opp.posted_date).toLocaleDateString('en-US') : '[DATE POSTED]';
  const DEADLINE  = opp.deadline        ? new Date(opp.deadline).toLocaleDateString('en-US')    : '[RESPONSE DEADLINE]';
  const SET_ASIDE = opp.set_aside       || 'Full and Open Competition';

  // ── SAFE JSON PARSER ───────────────────────────────────────────────────────
  // Claude returns JSON strings — parse gracefully, return {} on failure
  function parseVolume(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
      // Strip possible markdown code fences
      const clean = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(clean);
    } catch (_) {
      return { _raw: String(raw) };
    }
  }

  const tech = parseVolume(volumes.technical);
  const mgmt = parseVolume(volumes.management);
  const pp   = parseVolume(volumes.pastPerformance);

  // Pricing: BID ENGINE supplies line_items array; fall back to a placeholder row
  const pricingData  = volumes.price || {};
  const lineItems    = Array.isArray(pricingData.line_items) ? pricingData.line_items : [
    { line: '001', description: 'Base Contract — All work as described in SOW', qty: 1, unit_price: pricingData.total_all_years || 0, total: pricingData.total_all_years || 0 },
  ];
  const grandTotal   = pricingData.total_all_years || lineItems.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const totalWritten = pricingData.total_written || '$' + grandTotal.toLocaleString();
  const costAssumps  = pricingData.cost_assumptions || 'All costs are fully burdened and include overhead, G&A, and profit. ODCs itemized separately.';
  const payTerms     = pricingData.payment_terms    || 'Net 30 days per FAR 52.232-25.';

  // ── TABLE HELPERS ──────────────────────────────────────────────────────────
  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' };
  const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  // Header cell — dark blue background, white bold text
  function hdrCell(txt, widthDxa) {
    return new TableCell({
      width:   { size: widthDxa, type: WidthType.DXA },
      borders: allBorders,
      shading: { fill: BLUE_HEADER, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children:  [new TextRun({ text: txt, bold: true, size: 20, color: 'FFFFFF', font: 'Arial' })],
      })],
    });
  }

  // Data cell — optional alternate row shading
  function dataCell(txt, widthDxa, opts = {}) {
    return new TableCell({
      width:           { size: widthDxa, type: WidthType.DXA },
      borders:         allBorders,
      shading:         opts.shade ? { fill: GRAY_ROW, type: ShadingType.CLEAR } : undefined,
      verticalAlign:   VerticalAlign.CENTER,
      margins:         { top: 60, bottom: 60, left: 120, right: 120 },
      children: [new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children:  [new TextRun({ text: String(txt || ''), size: 20, font: 'Arial' })],
      })],
    });
  }

  // Section heading paragraph
  function secHead(num, title) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 360, after: 120 },
      children: [new TextRun({ text: 'SECTION ' + num + ': ' + title.toUpperCase(), bold: true, size: 28, font: 'Arial', color: BLUE_DARK })],
    });
  }

  // Sub-heading paragraph
  function subHead(code, title) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: code + '  ' + title, bold: true, size: 24, font: 'Arial', color: BLUE_DARK })],
    });
  }

  // Body paragraph
  function body(txt) {
    if (!txt) return new Paragraph({ children: [new TextRun({ text: '', font: 'Arial', size: 22 })] });
    return new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [new TextRun({ text: String(txt), font: 'Arial', size: 22 })],
    });
  }

  // Checkbox line — uses text [ ] / [X]
  function checkbox(label, checked = false) {
    return new Paragraph({
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: (checked ? '[X]  ' : '[ ]  ') + label, font: 'Arial', size: 22 })],
    });
  }

  // Spacer paragraph
  const spacer = () => new Paragraph({ children: [new TextRun({ text: ' ', size: 22 })] });

  // Signature block helper
  function sigBlock(role) {
    return [
      spacer(),
      new Paragraph({ children: [new TextRun({ text: 'Signature: ___________________________________    Date: ________________', font: 'Arial', size: 22 })] }),
      new Paragraph({ children: [new TextRun({ text: 'Printed Name: _______________________________    Title: ' + role, font: 'Arial', size: 22 })] }),
      spacer(),
    ];
  }

  // ── COVER PAGE ─────────────────────────────────────────────────────────────
  const coverSection = [
    spacer(), spacer(),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480, after: 120 }, children: [
      new TextRun({ text: COMPANY.dba.toUpperCase(), font: 'Arial', bold: true, size: 56, color: BLUE_DARK }),
    ]}),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [
      new TextRun({ text: COMPANY.legal_name, font: 'Arial', size: 30, color: '444444' }),
    ]}),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: 'FEDERAL PROPOSAL SUBMISSION', font: 'Arial', bold: true, size: 36 }),
    ]}),
    spacer(), spacer(),

    // Solicitation info table
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [2500, 6860],
      rows: [
        new TableRow({ children: [
          new TableCell({ width: { size: 2500, type: WidthType.DXA }, borders: allBorders, shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Solicitation #', bold: true, color: 'FFFFFF', font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6860, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: SOL_NUM, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 2500, type: WidthType.DXA }, borders: allBorders, shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Title', bold: true, color: 'FFFFFF', font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6860, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: OPP_TITLE, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 2500, type: WidthType.DXA }, borders: allBorders, shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Issuing Agency', bold: true, color: 'FFFFFF', font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6860, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: AGENCY, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 2500, type: WidthType.DXA }, borders: allBorders, shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'PSC Code', bold: true, color: 'FFFFFF', font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6860, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: PSC, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 2500, type: WidthType.DXA }, borders: allBorders, shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Date Posted', bold: true, color: 'FFFFFF', font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6860, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: POSTED, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 2500, type: WidthType.DXA }, borders: allBorders, shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Response Deadline', bold: true, color: 'FFFFFF', font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6860, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: DEADLINE, font: 'Arial', size: 22 })] })] }),
        ]}),
      ],
    }),

    spacer(), spacer(),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: 'Submitted By', font: 'Arial', size: 22, bold: true }),
    ]}),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: COMPANY.legal_name + '  |  DBA: ' + COMPANY.dba, font: 'Arial', size: 22 }),
    ]}),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: 'UEI: ' + COMPANY.uei + '   |   CAGE: ' + COMPANY.cage_code + '   |   ' + COMPANY.certifications, font: 'Arial', size: 22 }),
    ]}),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: COMPANY.address + '   |   ' + COMPANY.phone + '   |   ' + COMPANY.email, font: 'Arial', size: 22 }),
    ]}),
    spacer(),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: 'Authorized Representative: ' + COMPANY.contact, font: 'Arial', size: 22, bold: true }),
    ]}),
    ...sigBlock('Owner / CEO'),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: 'Prepared: ' + TODAY, font: 'Arial', size: 20, color: '888888', italics: true }),
    ]}),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── TABLE OF CONTENTS (manual — Word updates fields on open) ───────────────
  const tocSection = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [
      new TextRun({ text: 'TABLE OF CONTENTS', bold: true, font: 'Arial', size: 32, color: BLUE_DARK }),
    ]}),
    ...[
      ['Section 1', 'Executive Summary'],
      ['Section 2', 'Bidder Information'],
      ['Section 3', 'Scope of Work'],
      ['Section 4', 'Past Performance'],
      ['Section 5', 'Management & Staffing'],
      ['Section 6', 'Pricing'],
      ['Section 7', 'Required Certifications'],
      ['Section 8', 'Compliance & Legal Acknowledgments'],
      ['Section 9', 'Required Documents Checklist'],
      ['Section 10', 'Addenda Acknowledgment'],
      ['Section 11', 'Attachments / Exhibits'],
    ].map(([sec, title]) =>
      new Paragraph({ spacing: { before: 60, after: 60 }, children: [
        new TextRun({ text: sec + '  —  ' + title, font: 'Arial', size: 22 }),
      ]})
    ),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 1: EXECUTIVE SUMMARY ───────────────────────────────────────────
  const sec1 = [
    secHead('1', 'Executive Summary'),
    subHead('1.1', 'Overview'),
    body(tech.exec_overview || 'Walker Contractors LLC / Axiom Federal Solutions presents this proposal in response to the referenced solicitation. Our team brings proven federal contracting expertise to deliver compliant, high-quality results on time and within budget.'),
    subHead('1.2', 'Value Proposition'),
    body(tech.value_proposition || 'As a certified Small Disadvantaged Business with Gulf South regional expertise, we offer competitive pricing, experienced personnel, and a demonstrated track record of successful federal performance.'),
    subHead('1.3', 'Summary of Qualifications'),
    body(tech.qualifications || 'Walker Contractors LLC holds active SAM registration (UEI: ' + COMPANY.uei + ', CAGE: ' + COMPANY.cage_code + ') with all required certifications current. Our leadership team combines over 15 years of federal contracting experience.'),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 2: BIDDER INFORMATION ─────────────────────────────────────────
  const sec2 = [
    secHead('2', 'Bidder Information'),
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [3000, 6360],
      rows: [
        new TableRow({ children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: allBorders, shading: { fill: GRAY_ROW, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Legal Business Name', bold: true, font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6360, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: COMPANY.legal_name, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: allBorders, shading: { fill: GRAY_ROW, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'DBA / Trade Name', bold: true, font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6360, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: COMPANY.dba, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: allBorders, shading: { fill: GRAY_ROW, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'UEI', bold: true, font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6360, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: COMPANY.uei, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: allBorders, shading: { fill: GRAY_ROW, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'CAGE Code', bold: true, font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6360, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: COMPANY.cage_code, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: allBorders, shading: { fill: GRAY_ROW, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'EIN', bold: true, font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6360, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: '[EIN — ENTER BEFORE SUBMISSION]', font: 'Arial', size: 22, color: 'AA0000' })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: allBorders, shading: { fill: GRAY_ROW, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'SAM.gov Status', bold: true, font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6360, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Active Registration — Verified', font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: allBorders, shading: { fill: GRAY_ROW, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Business Structure', bold: true, font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6360, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Limited Liability Company (LLC)', font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: allBorders, shading: { fill: GRAY_ROW, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Set-Aside Designation', bold: true, font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6360, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: COMPANY.certifications, font: 'Arial', size: 22 })] })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: allBorders, shading: { fill: GRAY_ROW, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Point of Contact', bold: true, font: 'Arial', size: 22 })] })] }),
          new TableCell({ width: { size: 6360, type: WidthType.DXA }, borders: allBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: COMPANY.contact + '  |  ' + COMPANY.phone + '  |  ' + COMPANY.email, font: 'Arial', size: 22 })] })] }),
        ]}),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 3: SCOPE OF WORK ───────────────────────────────────────────────
  const milestones = Array.isArray(tech.milestones) && tech.milestones.length > 0
    ? tech.milestones
    : [
        { task: 'Project Kickoff / Site Mobilization', start_week: 'Week 1',  end_week: 'Week 2',  deliverable: 'Kickoff Meeting Minutes, Mobilization Plan' },
        { task: 'Design / Planning Review',            start_week: 'Week 2',  end_week: 'Week 4',  deliverable: 'Approved Design Documents' },
        { task: 'Phase 1 Construction / Execution',    start_week: 'Week 5',  end_week: 'Week 12', deliverable: 'Phase 1 Completion Report' },
        { task: 'Phase 2 Construction / Execution',    start_week: 'Week 13', end_week: 'Week 20', deliverable: 'Phase 2 Completion Report' },
        { task: 'Quality Control Inspections',         start_week: 'Week 8',  end_week: 'Week 22', deliverable: 'QC Inspection Logs, Punch List' },
        { task: 'Closeout / Final Inspection',         start_week: 'Week 22', end_week: 'Week 24', deliverable: 'As-Builts, O&M Manuals, Final Report' },
      ];

  const sec3 = [
    secHead('3', 'Scope of Work'),
    subHead('3.1', 'Project Description'),
    body(tech.scope_description || 'Walker Contractors LLC will furnish all labor, materials, equipment, and supervision necessary to complete all work as described in the Statement of Work (SOW) for ' + OPP_TITLE + '.'),
    subHead('3.2', 'Methodology'),
    body(tech.methodology || 'Our approach is phased to minimize disruption to ongoing agency operations while maintaining full compliance with all applicable federal standards including EM 385-1-1, FAR Part 36, and agency-specific requirements.'),
    subHead('3.3', 'Project Milestones'),
    spacer(),
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [3200, 1500, 1500, 3160],
      rows: [
        new TableRow({ children: [
          hdrCell('Task / Milestone', 3200),
          hdrCell('Start', 1500),
          hdrCell('End', 1500),
          hdrCell('Key Deliverable', 3160),
        ]}),
        ...milestones.map((m, i) => new TableRow({ children: [
          dataCell(m.task, 3200, { shade: i % 2 === 1 }),
          dataCell(m.start_week, 1500, { shade: i % 2 === 1, center: true }),
          dataCell(m.end_week, 1500, { shade: i % 2 === 1, center: true }),
          dataCell(m.deliverable, 3160, { shade: i % 2 === 1 }),
        ]})),
      ],
    }),
    spacer(),
    subHead('3.4', 'Deliverables'),
    body(tech.deliverables || 'Deliverables include: project schedule, quality control plan, safety plan, progress reports, inspection documentation, closeout package, as-built drawings, and operation and maintenance manuals.'),
    subHead('3.5', 'SOW Compliance'),
    body(tech.sow_compliance || 'Walker Contractors LLC has reviewed the complete SOW and confirms full compliance with all stated requirements. Any areas requiring clarification will be addressed via formal RFI prior to proposal submission.'),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 4: PAST PERFORMANCE ───────────────────────────────────────────
  const projects = Array.isArray(pp.projects) && pp.projects.length > 0
    ? pp.projects
    : [
        { project_name: '[Project Name]', client: '[Agency Name]', contract_value: '[Value]', period: '[MM/YYYY – MM/YYYY]', scope: '[Scope description — verify before submission]', reference: '[Reference Name, Title, Phone]' },
      ];

  const sec4 = [
    secHead('4', 'Past Performance'),
    body(pp.narrative || 'Walker Contractors LLC has successfully performed similar federal contracts demonstrating our ability to deliver quality work on schedule and within budget. The following table summarizes our most relevant past performance.'),
    spacer(),
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [2000, 1800, 1400, 1500, 2660],
      rows: [
        new TableRow({ children: [
          hdrCell('Project Name', 2000),
          hdrCell('Client / Agency', 1800),
          hdrCell('Value', 1400),
          hdrCell('Period', 1500),
          hdrCell('Scope Summary', 2660),
        ]}),
        ...projects.map((p, i) => new TableRow({ children: [
          dataCell(p.project_name, 2000, { shade: i % 2 === 1 }),
          dataCell(p.client, 1800, { shade: i % 2 === 1 }),
          dataCell(p.contract_value, 1400, { shade: i % 2 === 1, center: true }),
          dataCell(p.period, 1500, { shade: i % 2 === 1, center: true }),
          dataCell(p.scope, 2660, { shade: i % 2 === 1 }),
        ]})),
      ],
    }),
    spacer(),
    subHead('4.1', 'References'),
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [2000, 7360],
      rows: [
        new TableRow({ children: [hdrCell('Project', 2000), hdrCell('Reference Contact', 7360)] }),
        ...projects.map((p, i) => new TableRow({ children: [
          dataCell(p.project_name, 2000, { shade: i % 2 === 1 }),
          dataCell(p.reference || '[Reference — verify before submission]', 7360, { shade: i % 2 === 1 }),
        ]})),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 5: MANAGEMENT & STAFFING ─────────────────────────────────────
  const personnel = Array.isArray(mgmt.personnel) && mgmt.personnel.length > 0
    ? mgmt.personnel
    : [
        { name: 'Joseph Walker IV', title: 'Owner / CEO', responsibility: 'Contract authority, executive oversight, client relations', years_exp: 15 },
        { name: '[Project Manager]', title: 'Project Manager', responsibility: 'Day-to-day project execution, schedule management, reporting', years_exp: 10 },
        { name: '[Superintendent]', title: 'Site Superintendent', responsibility: 'Field operations, quality control, safety compliance', years_exp: 12 },
        { name: '[QC Manager]', title: 'Quality Control Manager', responsibility: '3-phase QC inspection per USACE standards', years_exp: 8 },
      ];

  const sec5 = [
    secHead('5', 'Management & Staffing'),
    subHead('5.1', 'Management Approach'),
    body(mgmt.approach || 'Walker Contractors LLC employs a flat, responsive management structure with direct executive accountability. Joseph Walker IV maintains personal oversight of all federal contracts to ensure compliance, communication, and performance.'),
    spacer(),
    subHead('5.2', 'Key Personnel'),
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [2000, 2000, 3760, 1600],
      rows: [
        new TableRow({ children: [
          hdrCell('Name', 2000),
          hdrCell('Title', 2000),
          hdrCell('Primary Responsibility', 3760),
          hdrCell('Years Exp.', 1600),
        ]}),
        ...personnel.map((p, i) => new TableRow({ children: [
          dataCell(p.name, 2000, { shade: i % 2 === 1 }),
          dataCell(p.title, 2000, { shade: i % 2 === 1 }),
          dataCell(p.responsibility, 3760, { shade: i % 2 === 1 }),
          dataCell(String(p.years_exp || ''), 1600, { shade: i % 2 === 1, center: true }),
        ]})),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 6: PRICING ─────────────────────────────────────────────────────
  const sec6 = [
    secHead('6', 'Pricing'),
    subHead('6.1', 'Itemized Price Schedule'),
    spacer(),
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [800, 4260, 1000, 1600, 1700],
      rows: [
        new TableRow({ children: [
          hdrCell('Line #', 800),
          hdrCell('Description', 4260),
          hdrCell('Qty', 1000),
          hdrCell('Unit Price', 1600),
          hdrCell('Total', 1700),
        ]}),
        ...lineItems.map((li, i) => new TableRow({ children: [
          dataCell(String(li.line || (i + 1)), 800, { shade: i % 2 === 1, center: true }),
          dataCell(li.description || '', 4260, { shade: i % 2 === 1 }),
          dataCell(String(li.qty || 1), 1000, { shade: i % 2 === 1, center: true }),
          dataCell('$' + Number(li.unit_price || 0).toLocaleString(), 1600, { shade: i % 2 === 1, center: true }),
          dataCell('$' + Number(li.total || 0).toLocaleString(), 1700, { shade: i % 2 === 1, center: true }),
        ]})),
        // Totals row
        new TableRow({ children: [
          new TableCell({ columnSpan: 4, width: { size: 7660, type: WidthType.DXA }, borders: allBorders, shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'TOTAL BID AMOUNT', bold: true, font: 'Arial', size: 22, color: 'FFFFFF' })] })] }),
          new TableCell({ width: { size: 1700, type: WidthType.DXA }, borders: allBorders, shading: { fill: BLUE_DARK, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '$' + grandTotal.toLocaleString(), bold: true, font: 'Arial', size: 22, color: 'FFFFFF' })] })] }),
        ]}),
      ],
    }),
    spacer(),
    subHead('6.2', 'Total Bid Amount'),
    body('Total Bid Price: ' + totalWritten + '  ($' + grandTotal.toLocaleString() + ')'),
    subHead('6.3', 'Cost Assumptions'),
    body(costAssumps),
    subHead('6.4', 'Payment Terms'),
    body(payTerms),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 7: REQUIRED CERTIFICATIONS ────────────────────────────────────
  const sec7 = [
    secHead('7', 'Required Certifications'),
    body('The undersigned hereby certifies on behalf of ' + COMPANY.legal_name + ':'),
    spacer(),
    checkbox('Non-Collusion Affidavit — This bid has been prepared independently and without collusion.', true),
    checkbox('Equal Opportunity / EEO Compliance — We comply with all applicable EEO requirements per FAR 52.222-26.', true),
    checkbox('Debarment & Suspension Certification — The offeror is not currently debarred, suspended, or excluded from federal contracts per FAR 52.209-6.', true),
    checkbox('Buy American Act Compliance — Where applicable, domestic construction materials will be used per FAR 52.225-9.', true),
    checkbox('Davis-Bacon Act Compliance — Prevailing wage rates will be paid to all laborers and mechanics as required.', true),
    checkbox('FAR Part 31 Cost Principles Compliance — All proposed costs are allowable, allocable, and reasonable.', true),
    checkbox('Drug-Free Workplace — The offeror maintains a drug-free workplace program per FAR 52.223-6.', true),
    checkbox('Truth in Negotiations Act (TINA) — Cost or pricing data is current, accurate, and complete.', true),
    checkbox('Anti-Kickback — No kickbacks, gratuities, or contingent fees have been paid per FAR 52.203-7.', true),
    spacer(),
    ...sigBlock('Authorized Signatory — ' + COMPANY.contact),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 8: COMPLIANCE & LEGAL ACKNOWLEDGMENTS ─────────────────────────
  const sec8 = [
    secHead('8', 'Compliance & Legal Acknowledgments'),
    body('Walker Contractors LLC acknowledges and agrees to comply with all terms, conditions, representations, and certifications set forth in the solicitation ' + SOL_NUM + ' issued by ' + AGENCY + '.'),
    spacer(),
    body('We confirm that:'),
    checkbox('All representations and certifications in SAM.gov are current, accurate, and complete.', true),
    checkbox('We have read and understand all sections of the solicitation, including the Statement of Work, Contract Terms, and Evaluation Criteria.', true),
    checkbox('We accept all terms and conditions as written, with no exceptions or qualifications.', true),
    checkbox('We agree to maintain required bonds, insurance, and licenses throughout the contract period.', true),
    checkbox('We understand that submission of a false statement is a violation of federal law (18 U.S.C. 1001).', true),
    spacer(),
    ...sigBlock('Authorized Signatory — ' + COMPANY.contact),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 9: REQUIRED DOCUMENTS CHECKLIST ────────────────────────────────
  const sec9 = [
    secHead('9', 'Required Documents Checklist'),
    body('The following documents are included with or will accompany this proposal submission:'),
    spacer(),
    ...[
      'Completed Proposal (this document)',
      'SF 1442 — Solicitation, Offer, and Award (Construction)',
      'SF 24 — Bid Bond (if required)',
      'SF 25 — Performance Bond commitment letter',
      'SF 25A — Payment Bond commitment letter',
      'SAM.gov Registration Confirmation (active status printout)',
      'Business License / State Contractor License',
      'Certificate of Insurance (COI) — meeting solicitation requirements',
      'Subcontracting Plan (if applicable per FAR 52.219-9)',
      'VETS 4212 Report (if applicable)',
      'Representations and Certifications (SAM.gov)',
      'Key Personnel Resumes',
      'Past Performance References',
      'Teaming Agreement (if applicable) — Trevor L. Monnie Landscape Services',
    ].map(doc => checkbox(doc, true)),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 10: ADDENDA ACKNOWLEDGMENT ────────────────────────────────────
  const sec10 = [
    secHead('10', 'Addenda Acknowledgment'),
    body('Acknowledge all amendments and addenda to the solicitation issued before proposal submission:'),
    spacer(),
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [2000, 2500, 4860],
      rows: [
        new TableRow({ children: [hdrCell('Addendum #', 2000), hdrCell('Date Issued', 2500), hdrCell('Description', 4860)] }),
        new TableRow({ children: [dataCell('[#]', 2000, { shade: false }), dataCell('[Date]', 2500, { shade: false }), dataCell('[Description — complete before submission]', 4860, { shade: false })] }),
        new TableRow({ children: [dataCell('[#]', 2000, { shade: true }), dataCell('[Date]', 2500, { shade: true }), dataCell('[Description — complete before submission]', 4860, { shade: true })] }),
      ],
    }),
    spacer(),
    checkbox('No addenda were issued for this solicitation.', false),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  // ── SECTION 11: ATTACHMENTS / EXHIBITS ────────────────────────────────────
  const sec11 = [
    secHead('11', 'Attachments / Exhibits'),
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [1400, 4000, 3960],
      rows: [
        new TableRow({ children: [hdrCell('Exhibit', 1400), hdrCell('Title', 4000), hdrCell('Description', 3960)] }),
        new TableRow({ children: [dataCell('A', 1400, { shade: false }), dataCell('Company Capability Statement', 4000, { shade: false }), dataCell('1-page overview of ' + COMPANY.legal_name + ' capabilities', 3960, { shade: false })] }),
        new TableRow({ children: [dataCell('B', 1400, { shade: true }), dataCell('Key Personnel Resumes', 4000, { shade: true }), dataCell('Resumes for all key personnel listed in Section 5', 3960, { shade: true })] }),
        new TableRow({ children: [dataCell('C', 1400, { shade: false }), dataCell('Past Performance References', 4000, { shade: false }), dataCell('Signed reference letters or CPARS ratings', 3960, { shade: false })] }),
        new TableRow({ children: [dataCell('D', 1400, { shade: true }), dataCell('License & Certification Documents', 4000, { shade: true }), dataCell('SDB certification, contractor license, SAM confirmation', 3960, { shade: true })] }),
        new TableRow({ children: [dataCell('E', 1400, { shade: false }), dataCell('Teaming Agreement', 4000, { shade: false }), dataCell('Trevor L. Monnie Landscape Services — License No. 26-5023', 3960, { shade: false })] }),
      ],
    }),
  ];

  // ── ASSEMBLE FULL DOCUMENT ────────────────────────────────────────────────
  // Supply and Real Estate proposals use a simpler format; the 11-section template
  // is for construction / services bids only. Supply/RE still get cover + content.
  function textToParas(text) {
    if (!text || typeof text !== 'string') return [];
    return text.split('\n').filter(l => l.trim()).map(line =>
      new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun({ text: line.replace(/^[#*-]+\s*/, ''), font: 'Arial', size: 22 })] })
    );
  }

  // Supply format fallback
  const supplySection = volumes.supplyQuote ? [
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 }, children: [new TextRun({ text: 'SUPPLY QUOTE', bold: true, font: 'Arial', size: 32, color: BLUE_DARK })] }),
    ...textToParas(typeof volumes.supplyQuote === 'string' ? volumes.supplyQuote : JSON.stringify(volumes.supplyQuote, null, 2)),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 }, children: [new TextRun({ text: 'CAPABILITY STATEMENT', bold: true, font: 'Arial', size: 32, color: BLUE_DARK })] }),
    ...textToParas(typeof volumes.capStatement === 'string' ? volumes.capStatement : ''),
  ] : [];

  const isSupply = supplySection.length > 0;

  const allChildren = isSupply
    ? [...coverSection, ...supplySection]
    : [
        ...coverSection,
        ...tocSection,
        ...sec1, ...sec2, ...sec3, ...sec4, ...sec5,
        ...sec6, ...sec7, ...sec8, ...sec9, ...sec10, ...sec11,
      ];

  const doc = new Document({
    creator:     COMPANY.legal_name,
    title:       'Proposal — ' + OPP_TITLE,
    description: 'Federal proposal generated by PRIME DRAFT agent | ' + AGENCY,
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { font: 'Arial', size: 28, bold: true, color: BLUE_DARK },
          paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { font: 'Arial', size: 24, bold: true, color: BLUE_DARK },
          paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 1 } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size:   { width: 12240, height: 15840 },               // US Letter
          margin: { top: 1440, right: 1440, bottom: 1080, left: 1440 }, // 1" margins, 0.75" bottom for footer
        },
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: BLUE_DARK, space: 4 } },
          children: [
            new TextRun({ text: COMPANY.legal_name + ' / ' + COMPANY.dba + '   |   CAGE: ' + COMPANY.cage_code + '   |   Page ', font: 'Arial', size: 18, color: '555555' }),
            new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: '555555' }),
            new TextRun({ text: ' of ', font: 'Arial', size: 18, color: '555555' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 18, color: '555555' }),
          ],
        })] }),
      },
      children: allChildren,
    }],
  });

  return Packer.toBuffer(doc);
}

async function queueForBrandiReview(bidId, eventType) {
  // Log the review request — BRANDI picks it up in the morning briefing
  await logAction('DRAFT', 'Queued for BRANDI review', {
    bidId,
    event: eventType,
    reviewer: 'Mr. Kemp',
    next_step: 'Approve or reject in morning briefing email',
  });
}

// ----------------------------------------------------------
// GET SUBS FOR PLAN: Pull real matched suppliers for sub plans (L5-09)
// Called when generating small business subcontracting plans
// Replaces placeholder names with actual matched suppliers from the DB
// ----------------------------------------------------------
async function getSubsForPlan(opportunityId) {
  try {
    const { data: matches } = await supabase
      .from('supplier_matches')
      .select('*, suppliers(name, state, certifications, naics_codes, avg_contract_value, federal_contract_count)')
      .eq('opportunity_id', opportunityId)
      .in('match_type', ['sub', 'teaming'])
      .gte('match_score', 50)
      .order('match_score', { ascending: false })
      .limit(5);

    if (!matches || matches.length === 0) {
      // Fallback to generic text if no suppliers matched yet
      return [{
        name: 'TBD — Run RECON supplier scan to populate matches',
        type: 'Subcontractor',
        naics: 'TBD',
        cert: 'TBD',
        estimated_value: 0,
      }];
    }

    return matches.map(m => ({
      name:             m.suppliers?.name || 'Unknown',
      state:            m.suppliers?.state || '',
      certifications:   (m.suppliers?.certifications || []).join(', '),
      naics:            (m.suppliers?.naics_codes || []).slice(0, 2).join(', '),
      match_score:      m.match_score,
      match_type:       m.match_type,
      avg_contract_val: m.suppliers?.avg_contract_value ? '$' + Math.round(m.suppliers.avg_contract_value / 1000) + 'K' : 'N/A',
      federal_history:  m.suppliers?.federal_contract_count || 0,
    }));
  } catch (err) {
    console.warn('DRAFT: getSubsForPlan failed —', err.message);
    return [];
  }
}

// Export so other modules can call getSubsForPlan
module.exports = { getSubsForPlan };

// ----------------------------------------------------------
// START: Run DRAFT when this file is executed
// ----------------------------------------------------------
runDraft();
