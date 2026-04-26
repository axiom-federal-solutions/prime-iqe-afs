// =============================================================
// SCOUT.JS — Strategic Contract Observation & Unified Tracker
// JOB: Find federal contracts on SAM.gov 4 times a day
// SCHEDULE: 12:00 AM, 6:00 AM, 12:00 PM, 6:00 PM (Central Time)
// COST: ~$2/month (API calls only — no AI needed)
// =============================================================

// Load helper tools from the lib folder
const { supabase, logAction } = require('../lib/supabase');

// SAM.gov API address — this is where all federal contracts live
const SAM_API = 'https://api.sam.gov/opportunities/v2/search';

// These are the job categories PRIME looks for
// NAICS codes are like job type codes the government uses
const NAICS_CODES = [
  '236220', // Commercial and Institutional Building Construction
  '238210', // Electrical Contractors
  '237990', // Other Heavy and Civil Engineering Construction
  '236116', // New Multifamily Housing Construction
  '561730', // Landscaping Services
  '424710', // Petroleum and Petroleum Products (Supply)
  '424130', // Industrial and Personal Service Paper (Supply)
  '424490', // Other Grocery and Related Products (Supply)
  '424120', // Stationery and Office Supplies (Supply)
];

// Keywords that mean a site visit is required
// If these words appear in the contract, we flag it
const SITE_VISIT_KEYWORDS = [
  'mandatory site visit',
  'mandatory pre-bid',
  'site visit required',
  'pre-proposal conference',
  'mandatory attendance',
  'pre-bid conference',
];

// Keywords that mean a bid bond is required
const BID_BOND_KEYWORDS = [
  'bid bond',
  'bid guarantee',
  'bid security',
  '20 percent',
  '20%',
];

// Count how many new opportunities we found this run
let inserted = 0;

// ----------------------------------------------------------
// MAIN FUNCTION: Run the full SAM.gov scan
// Called by GitHub Actions 4 times a day
// ----------------------------------------------------------
async function runScout() {
  console.log('SCOUT: Starting SAM.gov scan at ' + new Date().toISOString());

  try {
    // Scan for each job category one at a time
    await scanSAM();

    // Write a log entry so we know it ran
    await logAction('SCOUT', 'SAM scan complete', { count: inserted, timestamp: new Date().toISOString() });
    console.log('SCOUT: Done. Found ' + inserted + ' new opportunities.');
  } catch (err) {
    console.error('SCOUT ERROR:', err.message);
    await logAction('SCOUT', 'SAM scan failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// SCAN SAM.GOV: Loop through each NAICS code and fetch jobs
// ----------------------------------------------------------
async function scanSAM() {
  for (const naics of NAICS_CODES) {
    console.log('SCOUT: Scanning NAICS ' + naics + '...');

    // Build the search URL with filters
    const params = new URLSearchParams({
      api_key: process.env.SAM_API_KEY,   // Your SAM API key (stored in GitHub Secrets)
      naicsCode: naics,
      postedFrom: getYesterdayISO(),       // Only get jobs posted since yesterday
      limit: 100,                          // Get up to 100 results per request
      offset: 0,
    });

    try {
      const res = await fetch(SAM_API + '?' + params);

      // If the request failed, skip this NAICS and keep going
      if (!res.ok) {
        console.warn('SCOUT: SAM API returned ' + res.status + ' for NAICS ' + naics);
        continue;
      }

      const data = await res.json();
      const opportunities = data.opportunitiesData || [];
      console.log('SCOUT: Found ' + opportunities.length + ' results for NAICS ' + naics);

      // Save each opportunity to the database
      for (const opp of opportunities) {
        await upsertOpportunity(opp);
        await detectSiteVisit(opp);
        await detectBidBond(opp);
      }
    } catch (err) {
      console.warn('SCOUT: Failed to fetch NAICS ' + naics + ' — ' + err.message);
    }

    // Wait 1 second between requests so we don't hit rate limits
    await sleep(1000);
  }
}

// ----------------------------------------------------------
// SAVE OPPORTUNITY: Add or update a contract in the database
// "Upsert" means: add it if new, update it if we already have it
// ----------------------------------------------------------
async function upsertOpportunity(opp) {
  // Pull out the fields we care about from the SAM.gov response
  const record = {
    solicitation_number: opp.solicitationNumber || opp.noticeId,
    title: opp.title || 'Untitled',
    agency: opp.department || opp.subtierName || null,
    sub_office: opp.subtierName || null,
    naics: opp.naicsCode || null,
    set_aside: opp.typeOfSetAsideDescription || null,
    location: opp.placeOfPerformance?.city?.name || null,
    state: opp.placeOfPerformance?.state?.code || null,
    value: parseFloat(opp.baseAndAllOptionsValue) || null,
    posted_date: opp.postedDate ? opp.postedDate.split('T')[0] : null,
    deadline: opp.responseDeadLine ? opp.responseDeadLine.split('T')[0] : null,
    description_url: opp.uiLink || null,
    source: 'SAM',
    status: 'new',
  };

  // Skip if there's no solicitation number — we can't track it without one
  if (!record.solicitation_number) return;

  // Save to database — if it already exists, update it
  const { error } = await supabase
    .from('opportunities')
    .upsert(record, { onConflict: 'solicitation_number' });

  if (error) {
    console.warn('SCOUT: Failed to save opportunity ' + record.solicitation_number + ' — ' + error.message);
  } else {
    inserted++;
  }
}

// ----------------------------------------------------------
// DETECT SITE VISIT: Check if the contract requires a site visit
// If yes, flag it in the database so BRANDI can warn Joe
// ----------------------------------------------------------
async function detectSiteVisit(opp) {
  const text = (opp.description || opp.title || '').toLowerCase();
  const required = SITE_VISIT_KEYWORDS.some(kw => text.includes(kw));

  if (required && opp.solicitationNumber) {
    await supabase
      .from('opportunities')
      .update({ site_visit_required: true })
      .eq('solicitation_number', opp.solicitationNumber || opp.noticeId);
  }
}

// ----------------------------------------------------------
// DETECT BID BOND: Check if the contract requires a bid bond
// Bid bonds are financial guarantees needed for large construction jobs
// ----------------------------------------------------------
async function detectBidBond(opp) {
  const text = (opp.description || opp.title || '').toLowerCase();
  const required = BID_BOND_KEYWORDS.some(kw => text.includes(kw));

  if (required && opp.solicitationNumber) {
    // Tell VAULT to track a bid bond for this opportunity
    await supabase
      .from('bid_bonds')
      .upsert({
        solicitation_id: opp.solicitationNumber || opp.noticeId,
        bid_id: opp.solicitationNumber || opp.noticeId,
        bond_pct: 20.0,
        request_sent: false,
        bond_received: false,
        bid_deadline: opp.responseDeadLine ? opp.responseDeadLine.split('T')[0] : null,
      }, { onConflict: 'solicitation_id' });
  }
}

// ----------------------------------------------------------
// HELPER: Get yesterday's date in ISO format (YYYY-MM-DD)
// SAM.gov uses this format for date filters
// ----------------------------------------------------------
function getYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ----------------------------------------------------------
// HELPER: Wait a set number of milliseconds
// Used to slow down API requests so we don't get blocked
// ----------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------------------------------------
// START: Run SCOUT when this file is executed
// ----------------------------------------------------------
runScout();
