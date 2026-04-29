// =============================================================
// DRAFT.JS — Document & Response Automated Filing Tool
// JOB: Write federal bid proposals, compliance matrices, memos
<<<<<<< HEAD
// SCHEDULE: On-demand only — triggered when Mr. Kemp approves a bid
// COST: ~$4/month (Claude Sonnet for proposals, Haiku for memos)
// SAFETY RULE: DRAFT NEVER sends anything automatically.
//   Everything goes to BRANDI for Mr. Kemp's review first.
// =============================================================

// Load helper tools
const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');
const { claudeSonnet, claudeHaiku } = require('../lib/claude');

// Our company info — used in every proposal we write
const COMPANY = {
  legal_name: 'Walker Contractors LLC',
  dba: 'Axiom Federal Solutions',
  cage_code: process.env.CAGE_CODE || 'TBD',
  uei: process.env.SAM_UEI || 'TBD',
  naics_primary: '236220',
  certifications: 'SDB',
  contact: 'Mr. Kemp, Managing Member',
  email: 'PrimeOpps1@gmail.com',
  specialty: 'federal construction, commercial building, and civil infrastructure in the Gulf South region',
};

// ----------------------------------------------------------
// MAIN FUNCTION: Generate a complete proposal package
// Called when Mr. Kemp approves a bid in the morning briefing
=======
// SCHEDULE: On-demand only — triggered when Joe approves a bid
// COST: ~$4/month (Claude Sonnet for proposals, Haiku for memos)
// SAFETY RULE: DRAFT NEVER sends anything automatically.
//              Everything goes to BRANDI for Joe's review first.
// =============================================================

// Load helper tools
const { supabase, logAction } = require('../lib/supabase');
const { claudeSonnet, claudeHaiku } = require('../lib/claude');

// ----------------------------------------------------------
// MAIN FUNCTION: Generate a complete proposal package
// Called when Joe approves a bid in the morning briefing
>>>>>>> prime-system/main
// ----------------------------------------------------------
async function runDraft() {
  // Get the bid ID from the command line argument
  // Example: node agents/draft.js BID-UUID-HERE
  const bidId = process.argv[2];

  if (!bidId) {
    console.error('DRAFT: No bid ID provided. Usage: node agents/draft.js <bidId>');
    process.exit(1);
  }

  console.log('DRAFT: Starting proposal generation for bid ' + bidId);

  try {
    await generateProposal(bidId);
<<<<<<< HEAD
    console.log('DRAFT: Proposal complete — queued for Mr. Kemp review in BRANDI.');
=======
    console.log('DRAFT: Proposal complete — queued for Joe review in BRANDI.');
>>>>>>> prime-system/main
  } catch (err) {
    console.error('DRAFT ERROR:', err.message);
    await logAction('DRAFT', 'Proposal generation failed', { bidId, error: err.message });
    process.exit(1);
  }
}

<<<<<<< HEAD
// Supply NAICS codes — these get a short-form proposal, not 4-volume
const SUPPLY_NAICS = ['424710', '424130', '424490', '424120', '424410'];

// ----------------------------------------------------------
// GENERATE PROPOSAL: Route to construction or supply format
//   Construction: 4-volume federal proposal package
//   Supply: 1-2 page short-form quote + capability statement
=======
// ----------------------------------------------------------
// GENERATE PROPOSAL: Build a full 4-volume federal proposal
// Volume 1: Technical Approach
// Volume 2: Management Plan
// Volume 3: Past Performance
// Volume 4: Price Proposal
>>>>>>> prime-system/main
// ----------------------------------------------------------
async function generateProposal(bidId) {
  // Load the bid and its linked opportunity from the database
  const bid = await getBidWithOpportunity(bidId);
  if (!bid) throw new Error('Bid not found: ' + bidId);

<<<<<<< HEAD
  // Route to supply short-form if this is a supply NAICS
  if (SUPPLY_NAICS.includes(bid.opportunities.naics)) {
    console.log('DRAFT: Supply opportunity detected — using short-form template');
    return generateSupplyProposal(bidId, bid);
  }

  console.log('DRAFT: Generating proposal for "' + bid.opportunities.title + '"');

  // Load past performance on similar contracts
  const pastPerf = await getRelevantPastPerformance(bid.opportunities.naics);

  // Get the pricing from BID ENGINE (already stored in the bid record)
  const pricing = await getBidEnginePricing(bidId);
=======
  // Load past performance on similar contracts
  const pastPerf = await getRelevantPastPerformance(bid.opportunities.naics);

  // Get the pricing from BID ENGINE
  const pricing  = await getBidEnginePricing(bidId);
>>>>>>> prime-system/main

  // ----------------------------------------------------------
  // STEP 1: Build the compliance matrix
  // This maps every RFP requirement to the proposal page that answers it
  // ----------------------------------------------------------
  const requirements = await extractRequirements(bid.opportunities);
<<<<<<< HEAD
  const matrix = await buildComplianceMatrix(requirements, bidId);

  // ----------------------------------------------------------
  // STEP 2: Write the 4 proposal volumes using Claude Sonnet
  // Sonnet writes higher-quality proposals than Haiku
=======
  const matrix       = await buildComplianceMatrix(requirements, bidId);

  // ----------------------------------------------------------
  // STEP 2: Write the 4 proposal volumes using Claude Sonnet
  // Sonnet is smarter and writes better proposals than Haiku
>>>>>>> prime-system/main
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
<<<<<<< HEAD
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
=======
  // STEP 3: Also write a bid/no-bid memo
  // This is a short document explaining why we should bid
  // ----------------------------------------------------------
  const bidMemo = await claudeHaiku(
    'Write a brief 3-paragraph bid/no-bid recommendation memo for this opportunity. ' +
    'Be concise and business-like. Opportunity: ' + JSON.stringify({
      title: bid.opportunities.title,
      agency: bid.opportunities.agency,
      value: bid.opportunities.value,
      prime_score: bid.opportunities.prime_score,
    })
>>>>>>> prime-system/main
  );

  // ----------------------------------------------------------
  // STEP 4: Save everything — NEVER auto-send
<<<<<<< HEAD
  // All documents wait in the database for Mr. Kemp's approval
  // ----------------------------------------------------------
  await storeDraft(bidId, {
    technical,
    management,
    pastPerformance,
    price,
    bidMemo,
    matrix,
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
=======
  // All documents wait in the database for Joe's approval
  // ----------------------------------------------------------
  await storeDraft(bidId, { technical, management, pastPerformance, price, bidMemo, matrix });
  await queueForBrandiReview(bidId, 'PROPOSAL_READY');

  await logAction('DRAFT', 'Proposal generated — awaiting Joe approval', {
    bidId,
    volumes: ['technical', 'management', 'past_performance', 'price'],
    compliance_requirements: requirements.length,
>>>>>>> prime-system/main
  });
}

// ----------------------------------------------------------
// EXTRACT REQUIREMENTS: Pull the RFP requirements from the opportunity
<<<<<<< HEAD
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
=======
// These are the things the proposal must address
// ----------------------------------------------------------
async function extractRequirements(opportunity) {
  // In a full implementation this would fetch and parse the actual PDF
  // For now we return a standard federal RFP structure
  return [
    { section: 'L.1', requirement: 'Technical Approach — describe methodology', volume: 1 },
    { section: 'L.2', requirement: 'Management Plan — staffing and timeline', volume: 2 },
    { section: 'L.3', requirement: 'Past Performance — 3 relevant examples', volume: 3 },
    { section: 'L.4', requirement: 'Price Proposal — fully loaded cost breakdown', volume: 4 },
    { section: 'M.1', requirement: 'Technical evaluation factor', volume: 1 },
    { section: 'M.2', requirement: 'Past performance evaluation', volume: 3 },
    { section: 'M.3', requirement: 'Price — lowest price technically acceptable', volume: 4 },
  ];
>>>>>>> prime-system/main
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
<<<<<<< HEAD
    addressed_by: COMPANY.legal_name,
=======
>>>>>>> prime-system/main
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
<<<<<<< HEAD
// PROMPT BUILDERS: Instructions for Claude Sonnet on what to write
=======
// PROMPT BUILDERS: These tell Claude Sonnet what to write
>>>>>>> prime-system/main
// ----------------------------------------------------------

function buildTechnicalPrompt(bid, requirements) {
  return (
<<<<<<< HEAD
    'You are writing Volume 1 (Technical Approach) of a federal government IT proposal. ' +
    'Contractor: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
    'Specialty: ' + COMPANY.specialty + '. ' +
    'Opportunity: ' + bid.opportunities.title + '. ' +
    'Agency: ' + bid.opportunities.agency + '. ' +
    'Contract Value: $' + (bid.opportunities.value || 'TBD') + '. ' +
    'NAICS: ' + bid.opportunities.naics + '. ' +
    'Set-Aside: ' + (bid.opportunities.set_aside || 'Full and Open') + '. ' +
    'Write a professional, FAR-compliant technical approach for a federal construction contract. Use active voice. Be specific and concise. ' +
    'Address these RFP requirements: ' +
    requirements.filter(r => r.volume === 1).map(r => r.requirement).join('; ') +
    '. Target length: 3 pages. Include: construction methodology, safety plan (EM 385-1-1), ' +
    'phasing approach, quality control plan, understanding of the facility mission, ' +
    'and why ' + COMPANY.legal_name + ' is uniquely qualified for federal construction in the Gulf South.'
=======
    'You are writing Volume 1 (Technical Approach) of a federal government bid proposal. ' +
    'Contractor: Axiom Federal Solutions / Walker Contractors LLC. ' +
    'Opportunity: ' + bid.opportunities.title + '. ' +
    'Agency: ' + bid.opportunities.agency + '. ' +
    'Value: $' + bid.opportunities.value + '. ' +
    'NAICS: ' + bid.opportunities.naics + '. ' +
    'Write a professional, FAR-compliant technical approach. ' +
    'Address these RFP requirements: ' + requirements.filter(r => r.volume === 1).map(r => r.requirement).join('; ') + '. ' +
    'Keep it to 3 pages. Use active voice. Be specific.'
>>>>>>> prime-system/main
  );
}

function buildManagementPrompt(bid) {
  return (
<<<<<<< HEAD
    'You are writing Volume 2 (Management Plan) of a federal government IT proposal. ' +
    'Contractor: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
    'Opportunity: ' + bid.opportunities.title + '. ' +
    'Agency: ' + bid.opportunities.agency + '. ' +
    'Write a management plan covering: project organization structure, superintendent and key personnel ' +
    'roles and qualifications, quality control plan (3-phase QC per USACE standards), ' +
    'project schedule methodology (CPM schedule), safety program (EM 385-1-1 compliance), ' +
    'risk management, and small business subcontracting approach. ' +
    'Target length: 2 pages. Include an org chart description. Reference relevant federal construction standards.'
=======
    'You are writing Volume 2 (Management Plan) of a federal government bid proposal. ' +
    'Contractor: Axiom Federal Solutions / Walker Contractors LLC. ' +
    'Opportunity: ' + bid.opportunities.title + '. ' +
    'Write a management plan covering: project organization, key personnel, ' +
    'quality control, schedule, and subcontracting approach. ' +
    'Keep it to 2 pages. Include an org chart description.'
>>>>>>> prime-system/main
  );
}

function buildPPPrompt(pastPerf, bid) {
<<<<<<< HEAD
  const examples = pastPerf.length > 0
    ? pastPerf.slice(0, 3).map(c =>
        (c.title || 'Federal IT Contract') +
        ' — ' + (c.agency || 'Federal Agency') +
        ' — $' + ((c.value || 0).toLocaleString())
      ).join('; ')
    : 'Similar IT consulting and SAP training engagements (details to be added as contracts are awarded)';

  return (
    'You are writing Volume 3 (Past Performance) of a federal government IT proposal. ' +
    'Contractor: ' + COMPANY.legal_name + ' (DBA: ' + COMPANY.dba + '). ' +
    'Specialty: ' + COMPANY.specialty + '. ' +
    'This opportunity is: ' + bid.opportunities.title + ' with ' + bid.opportunities.agency + '. ' +
    'Past performance examples: ' + examples + '. ' +
    'For each example, describe: project scope, customer name and POC title, dollar value, ' +
    'period of performance, relevance to this opportunity, and performance outcomes. ' +
    'Use CPARS-style format. If limited past performance, emphasize key personnel experience ' +
    'and relevant commercial/state/local government work. Target length: 2 pages.'
=======
  const examples = pastPerf.slice(0, 3).map(c =>
    c.title + ' — ' + c.agency + ' — $' + c.value
  ).join('; ');

  return (
    'You are writing Volume 3 (Past Performance) of a federal government bid proposal. ' +
    'Contractor: Axiom Federal Solutions / Walker Contractors LLC. ' +
    'List and describe these 3 relevant past contracts: ' + examples + '. ' +
    'For each, include: project description, customer, dollar value, period of performance, ' +
    'and relevance to this opportunity (' + bid.opportunities.title + '). ' +
    'Use the CPARS-style format.'
>>>>>>> prime-system/main
  );
}

function buildPriceVolume(pricing) {
<<<<<<< HEAD
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
=======
  // Price volume uses BID ENGINE output — no AI needed, just math
  return {
    base_year: pricing?.base || 0,
    option_years: pricing?.escalated || 0,
    breakdown: pricing?.breakdown || {},
    total: (pricing?.escalated || pricing?.base || 0),
    notes: 'Pricing includes Davis-Bacon prevailing wages, material escalation, and bond premium.',
>>>>>>> prime-system/main
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
<<<<<<< HEAD
  // Pull our own past contracts as past performance examples
=======
>>>>>>> prime-system/main
  const { data } = await supabase
    .from('active_contracts')
    .select('*')
    .order('value', { ascending: false })
    .limit(5);
  return data || [];
}

async function getBidEnginePricing(bidId) {
<<<<<<< HEAD
  const { data } = await supabase
    .from('bids')
    .select('pricing_data')
=======
  // BID ENGINE saves pricing to the bids table — we read it back
  const { data } = await supabase
    .from('bids')
    .select('*')
>>>>>>> prime-system/main
    .eq('id', bidId)
    .single();
  return data?.pricing_data || null;
}

async function storeDraft(bidId, volumes) {
  await supabase
    .from('bids')
    .update({
      status: 'draft_ready',
<<<<<<< HEAD
      proposal_url: 'stored_in_db',
=======
      proposal_url: 'stored_in_db', // Future: Google Drive link
      // Store documents as JSON — future version saves to Google Drive
>>>>>>> prime-system/main
      proposal_data: volumes,
    })
    .eq('id', bidId);
}

async function queueForBrandiReview(bidId, eventType) {
<<<<<<< HEAD
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
=======
  // Log the review request so BRANDI picks it up in the morning brief
  await logAction('DRAFT', 'Queued for BRANDI review', { bidId, event: eventType });
}

// ----------------------------------------------------------
>>>>>>> prime-system/main
// START: Run DRAFT when this file is executed
// ----------------------------------------------------------
runDraft();
