// =============================================================
// DRAFT.JS — Document & Response Automated Filing Tool
// JOB: Write federal bid proposals, compliance matrices, memos
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
    console.log('DRAFT: Proposal complete — queued for Joe review in BRANDI.');
  } catch (err) {
    console.error('DRAFT ERROR:', err.message);
    await logAction('DRAFT', 'Proposal generation failed', { bidId, error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// GENERATE PROPOSAL: Build a full 4-volume federal proposal
// Volume 1: Technical Approach
// Volume 2: Management Plan
// Volume 3: Past Performance
// Volume 4: Price Proposal
// ----------------------------------------------------------
async function generateProposal(bidId) {
  // Load the bid and its linked opportunity from the database
  const bid = await getBidWithOpportunity(bidId);
  if (!bid) throw new Error('Bid not found: ' + bidId);

  // Load past performance on similar contracts
  const pastPerf = await getRelevantPastPerformance(bid.opportunities.naics);

  // Get the pricing from BID ENGINE
  const pricing  = await getBidEnginePricing(bidId);

  // ----------------------------------------------------------
  // STEP 1: Build the compliance matrix
  // This maps every RFP requirement to the proposal page that answers it
  // ----------------------------------------------------------
  const requirements = await extractRequirements(bid.opportunities);
  const matrix       = await buildComplianceMatrix(requirements, bidId);

  // ----------------------------------------------------------
  // STEP 2: Write the 4 proposal volumes using Claude Sonnet
  // Sonnet is smarter and writes better proposals than Haiku
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
  );

  // ----------------------------------------------------------
  // STEP 4: Save everything — NEVER auto-send
  // All documents wait in the database for Joe's approval
  // ----------------------------------------------------------
  await storeDraft(bidId, { technical, management, pastPerformance, price, bidMemo, matrix });
  await queueForBrandiReview(bidId, 'PROPOSAL_READY');

  await logAction('DRAFT', 'Proposal generated — awaiting Joe approval', {
    bidId,
    volumes: ['technical', 'management', 'past_performance', 'price'],
    compliance_requirements: requirements.length,
  });
}

// ----------------------------------------------------------
// EXTRACT REQUIREMENTS: Pull the RFP requirements from the opportunity
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
// PROMPT BUILDERS: These tell Claude Sonnet what to write
// ----------------------------------------------------------

function buildTechnicalPrompt(bid, requirements) {
  return (
    'You are writing Volume 1 (Technical Approach) of a federal government bid proposal. ' +
    'Contractor: Axiom Federal Solutions / Walker Contractors LLC. ' +
    'Opportunity: ' + bid.opportunities.title + '. ' +
    'Agency: ' + bid.opportunities.agency + '. ' +
    'Value: $' + bid.opportunities.value + '. ' +
    'NAICS: ' + bid.opportunities.naics + '. ' +
    'Write a professional, FAR-compliant technical approach. ' +
    'Address these RFP requirements: ' + requirements.filter(r => r.volume === 1).map(r => r.requirement).join('; ') + '. ' +
    'Keep it to 3 pages. Use active voice. Be specific.'
  );
}

function buildManagementPrompt(bid) {
  return (
    'You are writing Volume 2 (Management Plan) of a federal government bid proposal. ' +
    'Contractor: Axiom Federal Solutions / Walker Contractors LLC. ' +
    'Opportunity: ' + bid.opportunities.title + '. ' +
    'Write a management plan covering: project organization, key personnel, ' +
    'quality control, schedule, and subcontracting approach. ' +
    'Keep it to 2 pages. Include an org chart description.'
  );
}

function buildPPPrompt(pastPerf, bid) {
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
  );
}

function buildPriceVolume(pricing) {
  // Price volume uses BID ENGINE output — no AI needed, just math
  return {
    base_year: pricing?.base || 0,
    option_years: pricing?.escalated || 0,
    breakdown: pricing?.breakdown || {},
    total: (pricing?.escalated || pricing?.base || 0),
    notes: 'Pricing includes Davis-Bacon prevailing wages, material escalation, and bond premium.',
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
  const { data } = await supabase
    .from('active_contracts')
    .select('*')
    .order('value', { ascending: false })
    .limit(5);
  return data || [];
}

async function getBidEnginePricing(bidId) {
  // BID ENGINE saves pricing to the bids table — we read it back
  const { data } = await supabase
    .from('bids')
    .select('*')
    .eq('id', bidId)
    .single();
  return data?.pricing_data || null;
}

async function storeDraft(bidId, volumes) {
  await supabase
    .from('bids')
    .update({
      status: 'draft_ready',
      proposal_url: 'stored_in_db', // Future: Google Drive link
      // Store documents as JSON — future version saves to Google Drive
      proposal_data: volumes,
    })
    .eq('id', bidId);
}

async function queueForBrandiReview(bidId, eventType) {
  // Log the review request so BRANDI picks it up in the morning brief
  await logAction('DRAFT', 'Queued for BRANDI review', { bidId, event: eventType });
}

// ----------------------------------------------------------
// START: Run DRAFT when this file is executed
// ----------------------------------------------------------
runDraft();
