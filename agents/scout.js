// =============================================================
// SCOUT.JS — Federal Opportunity Scanner (SAM.gov + DLA DIBBS)
// JOB: Find construction, supply, and real estate contracts that match our targets
//      Runs 4x daily — 6 AM, 12 PM, 6 PM, 11 PM Central Time
//      Triggers JUDGE automatically when new opportunities are found
// SCHEDULE: scout-sam.yml GitHub Actions workflow
// COST: ~$0/month (no AI — pure search, filter, and save)
// SAFETY RULE: Rate limit at 1,000 SAM.gov calls/day — alert at 80% (800)
//              32 codes × ~4 state groups = ~128 calls/scan × 4 scans = ~512/day (49% headroom)
// VERTICALS: Construction (PRIME Score), Supply (ACQ Score), Real Estate & Rental (LEASE Score)
// =============================================================

const { supabase, logAction, isAgentEnabled, getConfig, setConfig } = require('../lib/supabase');
const { fetchJSON, fetchText, sleep } = require('../lib/fetch-retry');

// Our company info — used in user-agent headers and set-aside filtering
const COMPANY = {
  uei:            'USMQMFAGL9M4',
  cage_code:      process.env.CAGE_CODE || '7JKKO',
  certifications: ['SDB'],              // Small Disadvantaged Business
  state:          'LA',                 // Home state
  service_states: ['LA','MS','TX','AL','GA','FL','TN'],  // Gulf South footprint
};

// ---- CONSTRUCTION NAICS (Tier 1 Active + Tier 2 Growth + Tier 3 Watch) ----
const CONSTRUCTION_NAICS = [
  // Tier 1 Active — compete now (PRIME Score)
  '236220',  // Commercial & Institutional Building — primary code
  '238210',  // Electrical Contractors
  '237990',  // Other Heavy & Civil Engineering
  '236116',  // New Multifamily Housing
  '561730',  // Landscaping Services
  '236210',  // Industrial Building — warehouses, depots
  '238320',  // Painting — Joe already won VA paint contract
  '238910',  // Site Preparation — excavation, grading, demo
  '238990',  // All Other Specialty Trade — catches misclassified renovations
  '238220',  // Plumbing, Heating, AC — subbed on every commercial job
  // Tier 2 Growth — add as capacity builds
  '238310',  // Drywall & Insulation
  '238330',  // Flooring
  '238110',  // Poured Concrete Foundation
  '238160',  // Roofing — huge recurring federal volume
  '237310',  // Highway, Street & Bridge
  '237110',  // Water & Sewer Line
  '562910',  // Remediation — fastest growing federal category
  // Tier 3 Watch — requires business expansion
  '541330',  // Engineering Services — enables design-build
  '561720',  // Janitorial Services — recurring base ops
  '561210',  // Facilities Support — multi-year management contracts
  '238350',  // Finish Carpentry — millwork in federal buildings
];

// ---- SUPPLY NAICS (Active + Tier 1/2 Add-ons) ----
// Drop-ship model — Walker holds contract, distributor ships
const SUPPLY_NAICS = [
  '424710',  // Petroleum — highest value supply
  '424130',  // Industrial & Personal Service Paper — janitorial
  '424490',  // Other Grocery & Related Products — PPE classification
  '424120',  // Stationery & Office Supplies
  '424690',  // Other Chemical Merchant — cleaning chemicals, degreasers
  '423440',  // Other Commercial Equipment — safety equipment, alt PPE
  '424310',  // Piece Goods Merchant — uniforms, work clothing, linens
];

// ---- REAL ESTATE & RENTAL NAICS (New 3rd Vertical — LEASE Score) ----
// Asset-dependent: VAULT checks asset ownership before allowing bid
const REAL_ESTATE_NAICS = [
  '531110',  // Lessors of Residential Buildings — military housing privatization
  '531120',  // Lessors of Nonresidential Buildings — GSA office/warehouse leases
  '532412',  // Construction/Mining Equipment Rental — DLA, USACE
  '532120',  // Truck, Utility Trailer & RV Rental — FEMA/military disaster response
];

// All 32 NAICS codes we search
const ALL_NAICS = [...CONSTRUCTION_NAICS, ...SUPPLY_NAICS, ...REAL_ESTATE_NAICS];

// Set-aside types we qualify for
const SET_ASIDE_TYPES = ['SBA', 'SBP', 'SDVOSBC', 'HZC', 'WOSB', '8A', 'SDB'];

// SAM.gov API base URL
const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search';
const SAM_API_KEY  = process.env.SAM_API_KEY;

// DLA DIBBS API for supply opportunities
const DLA_API_BASE = 'https://www.dibbs.bsm.dla.mil/rfq/rqstlst.aspx';

// Daily scan limit on SAM.gov (free tier)
const SAM_DAILY_LIMIT = 1000;
const SAM_ALERT_THRESHOLD = 800;  // Warn at 80%

// ----------------------------------------------------------
// MAIN: Run the SCOUT scan across all 3 verticals
// ----------------------------------------------------------
async function runScout() {
  console.log('SCOUT: Starting opportunity scan across 3 verticals (32 NAICS codes)...');

  // Check per-agent enable flag — T.E.S.T. can disable SCOUT via system_config
  const enabled = await isAgentEnabled('SCOUT');
  if (!enabled) process.exit(0);

  // Check how many SAM.gov API calls we've used today
  const callsToday = parseInt(await getConfig('SAM_CALLS_TODAY', '0'), 10);
  if (callsToday >= SAM_DAILY_LIMIT) {
    console.warn('SCOUT: SAM.gov daily limit reached (' + callsToday + '/' + SAM_DAILY_LIMIT + '). Skipping scan.');
    await logAction('SCOUT', 'Skipped — SAM.gov daily limit reached', { calls_today: callsToday });
    process.exit(0);
  }

  let totalNew   = 0;
  let samCalls   = callsToday;

  try {
    // --- PHASE 1: Scan SAM.gov for federal construction contracts ---
    console.log('SCOUT: Scanning SAM.gov for construction contracts (21 NAICS codes)...');
    const constructionNew = await scanSAMGov('construction', CONSTRUCTION_NAICS);
    totalNew += constructionNew.count;
    samCalls += constructionNew.apiCalls;

    // --- PHASE 2: Scan SAM.gov for federal supply contracts ---
    console.log('SCOUT: Scanning SAM.gov for supply contracts (7 NAICS codes)...');
    const supplyNew = await scanSAMGov('supply', SUPPLY_NAICS);
    totalNew += supplyNew.count;
    samCalls += supplyNew.apiCalls;

    // --- PHASE 3: Scan SAM.gov for Real Estate & Rental contracts (NEW) ---
    console.log('SCOUT: Scanning SAM.gov for real estate & rental contracts (4 NAICS codes)...');
    const realEstateNew = await scanSAMGov('real_estate', REAL_ESTATE_NAICS);
    totalNew += realEstateNew.count;
    samCalls += realEstateNew.apiCalls;

    // --- PHASE 4: Scan DLA DIBBS for supply/distribution contracts ---
    console.log('SCOUT: Scanning DLA DIBBS for supply contracts...');
    const dibbs = await scanDLADIBBS();
    totalNew += dibbs;

    // Update the daily call counter so we don't exceed the limit
    await setConfig('SAM_CALLS_TODAY', samCalls);
    await setConfig('SCOUT_LAST_RUN', new Date().toISOString());

    // Alert if we're getting close to the daily limit
    if (samCalls >= SAM_ALERT_THRESHOLD) {
      console.warn('SCOUT: SAM.gov API usage warning — ' + samCalls + '/' + SAM_DAILY_LIMIT + ' calls used today.');
      await logAction('SCOUT', 'SAM.gov API usage warning', { calls_today: samCalls, limit: SAM_DAILY_LIMIT });
    }

    await logAction('SCOUT', 'Scan complete', {
      new_opportunities: totalNew,
      sam_calls_used:    samCalls,
      scan_time:         new Date().toISOString(),
    });

    console.log('SCOUT: Scan complete — ' + totalNew + ' new opportunities found.');

    // Trigger JUDGE to score everything that needs scoring
    if (totalNew > 0) {
      console.log('SCOUT: Triggering JUDGE to score new opportunities...');
      await triggerJudge();
    }

  } catch (err) {
    console.error('SCOUT ERROR:', err.message);
    await logAction('SCOUT', 'Scan failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// SCAN SAM.GOV: Search for contracts by NAICS code
// Returns { count: number of new opps saved, apiCalls: number of API calls made }
// ----------------------------------------------------------
async function scanSAMGov(type, naicsCodes) {
  if (!SAM_API_KEY) {
    console.warn('SCOUT: SAM_API_KEY not set — skipping SAM.gov scan');
    return { count: 0, apiCalls: 0 };
  }

  let totalInserted = 0;
  let totalApiCalls = 0;
  const today       = new Date().toISOString().split('T')[0];
  const weekAgo     = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  for (const naics of naicsCodes) {
    try {
      // Build the SAM.gov API query
      const params = new URLSearchParams({
        api_key:         SAM_API_KEY,
        naicsCode:       naics,
        postedFrom:      weekAgo,
        postedTo:        today,
        limit:           '50',
        offset:          '0',
        active:          'true',
        typeOfSetAside:  SET_ASIDE_TYPES.join(','),
      });

      const url  = SAM_API_BASE + '?' + params.toString();
      const data = await fetchJSON(url, {
        headers: { 'Accept': 'application/json' },
      });

      totalApiCalls++;

      const opps = data?.opportunitiesData || [];
      console.log('SCOUT: SAM.gov NAICS ' + naics + ' — ' + opps.length + ' opportunities found');

      for (const opp of opps) {
        const inserted = await upsertOpportunity(opp, type, naics);
        if (inserted) totalInserted++;
      }

      // Pause between NAICS requests to avoid rate limits
      await sleep(500);

    } catch (err) {
      console.warn('SCOUT: SAM.gov error for NAICS ' + naics + ' —', err.message);
      totalApiCalls++;  // Still count the failed call
    }
  }

  return { count: totalInserted, apiCalls: totalApiCalls };
}

// ----------------------------------------------------------
// UPSERT OPPORTUNITY: Save a SAM.gov opportunity to the database
// If it already exists (same solicitation number), update it instead of duplicating
// ----------------------------------------------------------
async function upsertOpportunity(opp, type, naics) {
  const solNum   = opp.solicitationNumber || opp.noticeId || ('SAM-' + Date.now());
  const deadline = opp.responseDeadLine || opp.archiveDate || null;
  const value    = parseValue(opp.award?.amount || opp.placeOfPerformance?.state || null);
  const agency   = opp.fullParentPathName || opp.organizationHierarchy?.[0]?.name || 'Unknown Agency';
  const state    = extractState(opp);

  // Calculate rough pre-score based on vertical — JUDGE will overwrite with full analysis
  let primeScore;
  if (type === 'supply') {
    primeScore = calcPreAcqScore(opp, naics);
  } else if (type === 'real_estate') {
    primeScore = calcPreLeaseScore(opp, naics, state);
  } else {
    primeScore = calcPrePrimeScore(opp, naics, state);
  }

  const { error } = await supabase.from('opportunities').upsert({
    solicitation_number: solNum,
    title:               opp.title || 'Federal Opportunity',
    agency,
    naics,
    type:                type,
    value:               value,
    posted_date:         opp.postedDate ? opp.postedDate.split('T')[0] : new Date().toISOString().split('T')[0],
    deadline:            deadline ? deadline.split('T')[0] : null,
    set_aside:           opp.typeOfSetAside || null,
    place_of_performance: state || null,
    description:         opp.description || null,
    source:              'SAM.gov',
    prime_score:         primeScore,
    status:              'new',
    raw_data:            opp,
  }, { onConflict: 'solicitation_number' });

  if (error) {
    console.warn('SCOUT: Failed to upsert ' + solNum + ' —', error.message);
    return false;
  }

  return true;
}

// ----------------------------------------------------------
// SCAN DLA DIBBS: Check DLA's DIBBS platform for supply/distribution RFQs
// DLA buys billions in supplies annually — great for the drop-ship model
// ----------------------------------------------------------
async function scanDLADIBBS() {
  let inserted = 0;

  try {
    // DLA DIBBS uses a web interface — we fetch the page and look for RFQ data
    // Full structured API integration requires DLA vendor account
    // For now: fetch the page, detect if there are relevant items, log for manual review
    const html = await fetchText(DLA_API_BASE + '?qryType=NSN&NSNType=FLIS&btnSearch=Search', {
      headers: { 'User-Agent': 'PRIME Federal Contracting Intelligence System — Axiom Federal Solutions' },
    });

    // Keywords that indicate supply opportunities relevant to our NAICS
    const supplyKeywords = ['petroleum', 'fuel', 'lubricant', 'janitorial', 'paper', 'ppe', 'office supplies', 'food', 'beverage'];
    const found = supplyKeywords.some(kw => html.toLowerCase().includes(kw));

    if (found) {
      await logAction('SCOUT', 'DLA DIBBS has relevant supply activity — manual review recommended', {
        url:    DLA_API_BASE,
        action: 'Visit DLA DIBBS to review current RFQs matching supply NAICS',
      });
    }

  } catch (err) {
    console.warn('SCOUT: DLA DIBBS scan error —', err.message);
  }

  return inserted;
}

// ----------------------------------------------------------
// TRIGGER JUDGE: Tell JUDGE to score all unscored opportunities
// In production: this is done via a GitHub Actions workflow_dispatch call
// In local dev: we call judge.js directly
// ----------------------------------------------------------
async function triggerJudge() {
  try {
    // Mark unscored opportunities so JUDGE picks them up on its next run
    await supabase
      .from('opportunities')
      .update({ needs_scoring: true })
      .eq('status', 'new')
      .is('prime_score', null);

    await logAction('SCOUT', 'JUDGE trigger set — new opportunities marked for scoring', {});
  } catch (err) {
    console.warn('SCOUT: Could not trigger JUDGE —', err.message);
  }
}

// ----------------------------------------------------------
// PRE-SCORE HELPERS: Quick rough scores before JUDGE does the full analysis
// These get overwritten when JUDGE runs — just used to flag high-interest opps
// ----------------------------------------------------------
function calcPrePrimeScore(opp, naics, state) {
  let score = 50;  // Start at 50 (middle of the road)

  // Boost for Gulf South location
  if (state && COMPANY.service_states.includes(state)) score += 15;

  // Boost for set-aside we qualify for
  if (opp.typeOfSetAside && SET_ASIDE_TYPES.includes(opp.typeOfSetAside)) score += 10;

  // Boost for primary NAICS match
  if (naics === '236220') score += 10;  // Commercial construction — our sweet spot

  // Cap at 90 — JUDGE will do the real scoring
  return Math.min(score, 90);
}

function calcPreAcqScore(opp, naics) {
  let score = 50;

  // Supply scoring is simpler — mostly about set-aside match and competition
  if (opp.typeOfSetAside && SET_ASIDE_TYPES.includes(opp.typeOfSetAside)) score += 20;
  if (naics === '424710') score += 10;  // Fuel — high volume repeat business

  return Math.min(score, 85);
}

// Pre-score for Real Estate & Rental opportunities
// JUDGE will run the full LEASE Score — this just flags high-interest opps for Brandi
function calcPreLeaseScore(opp, naics, state) {
  let score = 40;  // Start lower — asset ownership is the real gating factor

  // Gulf Coast state = higher opportunity for disaster response (532120 truck rental)
  if (state && COMPANY.service_states.includes(state)) score += 20;

  // GSA leases are the most lucrative passive income stream
  if (naics === '531120') score += 15;

  // Set-aside boost
  if (opp.typeOfSetAside && SET_ASIDE_TYPES.includes(opp.typeOfSetAside)) score += 10;

  // Cap lower than construction — asset ownership must be confirmed by VAULT
  return Math.min(score, 75);
}

// ----------------------------------------------------------
// HELPERS: Parse value and extract state from SAM.gov data
// ----------------------------------------------------------
function parseValue(raw) {
  if (!raw) return null;
  const num = parseFloat(String(raw).replace(/[$,]/g, ''));
  return isNaN(num) ? null : num;
}

function extractState(opp) {
  return (
    opp.placeOfPerformance?.state?.code ||
    opp.placeOfPerformance?.state ||
    opp.officeAddress?.state ||
    null
  );
}

// Run SCOUT when this file is executed
runScout();
