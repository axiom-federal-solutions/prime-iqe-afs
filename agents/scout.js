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

// NAICS prefix lists used by deriveVertical() to tag each opportunity's vertical
// Covers all 8 supply categories + IT/training/logistics catch-alls
const SUPPLY_NAICS_PREFIXES = [
  '541511','541512','541519','541330','561110','561210',
  '424410','332999','339999','611420','611430','541611','541618','488490',
  // Supply category codes (matches SUPPLY_CATS in the dashboard)
  '424710','424720',         // Fuel
  '561720','424130',         // Janitorial
  '339113','423440',         // PPE
  '424120','453210',         // Office
  '424490','311999',         // Food
  '424690',                  // Chemicals
  '423450',                  // Safety equipment
  '424310','315990',         // Uniforms
];
const RE_NAICS_PREFIXES = ['531110','531120','531210','531311','531312','531390'];
function deriveVertical(naics) {
  const n = (naics || '').trim();
  if (RE_NAICS_PREFIXES.some(p => n.startsWith(p))) return 'realestate';
  if (SUPPLY_NAICS_PREFIXES.some(p => n.startsWith(p))) return 'supply';
  return 'construction';
}

// Supply sub-category map — mirrors SUPPLY_CATS in the dashboard
// SCOUT stamps supply_category so dashboard can filter without client-side NAICS math
const SUPPLY_CAT_MAP = [
  { key: 'fuel',     naics: ['424710','424720'] },
  { key: 'jan',      naics: ['561720','424130'] },
  { key: 'ppe',      naics: ['339113','423440'] },
  { key: 'office',   naics: ['424120','453210'] },
  { key: 'food',     naics: ['424490','311999'] },
  { key: 'chem',     naics: ['424690'] },
  { key: 'safety',   naics: ['423450'] },
  { key: 'uni',      naics: ['424310','315990'] },
];
function deriveSupplyCategory(naics) {
  const n = (naics || '').trim();
  const match = SUPPLY_CAT_MAP.find(c => c.naics.some(p => n.startsWith(p)));
  return match ? match.key : null;  // null = IT/logistics/training catch-all
}

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

// Set-aside types we qualify for — SDB-eligible + unrestricted (full & open) only
// Narrowed from broad list to conserve SAM.gov API quota and focus on winnable opps
const SET_ASIDE_TYPES = ['SDB', ''];

// SAM.gov API base URL
const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search';
const SAM_API_KEY  = process.env.SAM_API_KEY;

// DLA DIBBS API for supply opportunities
const DLA_API_BASE = 'https://www.dibbs.bsm.dla.mil/rfq/rqstlst.aspx';

// Daily scan limit on SAM.gov (free tier)
const SAM_DAILY_LIMIT = 1000;
const SAM_ALERT_THRESHOLD = 800;  // Warn at 80%
const SAM_QUOTA_SOFT_CAP  = 600;  // At 60%: skip Tier 3 + low-value NAICS to preserve quota

// Low-priority NAICS codes skipped when quota >600 — high cost, low win probability
// High-value codes (236220, 541511) always run regardless of quota
const LOW_PRIORITY_NAICS = new Set([
  '238350', // Finish Carpentry
  '237110', // Water & Sewer Line
  '238160', // Roofing
  '238110', // Poured Concrete Foundation
  '562910', // Remediation
  '424310', // Piece Goods/Uniforms
  '424120', // Office Supplies
]);

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
    const constructionNew = await scanSAMGov('construction', CONSTRUCTION_NAICS, samCalls);
    totalNew += constructionNew.count;
    samCalls += constructionNew.apiCalls;

    // --- PHASE 2: Scan SAM.gov for federal supply contracts ---
    console.log('SCOUT: Scanning SAM.gov for supply contracts (7 NAICS codes)...');
    const supplyNew = await scanSAMGov('supply', SUPPLY_NAICS, samCalls);
    totalNew += supplyNew.count;
    samCalls += supplyNew.apiCalls;

    // --- PHASE 3: Scan SAM.gov for Real Estate & Rental contracts (NEW) ---
    console.log('SCOUT: Scanning SAM.gov for real estate & rental contracts (4 NAICS codes)...');
    const realEstateNew = await scanSAMGov('real_estate', REAL_ESTATE_NAICS, samCalls);
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
async function scanSAMGov(type, naicsCodes, globalCallsUsed = 0) {
  if (!SAM_API_KEY) {
    console.warn('SCOUT: SAM_API_KEY not set — skipping SAM.gov scan');
    return { count: 0, apiCalls: 0 };
  }

  let totalApiCalls = 0;
  const today   = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Phase 1: Collect all raw opportunities from SAM.gov, deduplicated by solicitation number
  // Collecting first then deduping prevents JUDGE from scoring the same opp twice
  const rawBySOL = new Map(); // solicitation_number → { opp, naics }

  for (const naics of naicsCodes) {
    // Quota soft cap: skip low-priority NAICS when >600 calls used today
    const callsSoFar = globalCallsUsed + totalApiCalls;
    if (callsSoFar >= SAM_QUOTA_SOFT_CAP && LOW_PRIORITY_NAICS.has(naics)) {
      console.log('SCOUT: Quota soft cap (' + callsSoFar + '/' + SAM_DAILY_LIMIT + ') — skipping low-priority NAICS ' + naics);
      continue;
    }

    try {
      const params = new URLSearchParams({
        api_key:        SAM_API_KEY,
        naicsCode:      naics,
        postedFrom:     weekAgo,
        postedTo:       today,
        limit:          '50',
        offset:         '0',
        active:         'true',
        typeOfSetAside: SET_ASIDE_TYPES.join(','),
      });

      const data = await fetchJSON(SAM_API_BASE + '?' + params.toString(), {
        headers: { 'Accept': 'application/json' },
      });

      totalApiCalls++;

      const opps = data?.opportunitiesData || [];
      console.log('SCOUT: NAICS ' + naics + ' — ' + opps.length + ' raw results (quota: ' + (globalCallsUsed + totalApiCalls) + '/' + SAM_DAILY_LIMIT + ')');

      for (const opp of opps) {
        // Deduplicate: same solicitation number across multiple NAICS — keep first occurrence
        const key = opp.solicitationNumber || opp.noticeId;
        if (key && !rawBySOL.has(key)) {
          rawBySOL.set(key, { opp, naics });
        }
      }

      await sleep(500); // Rate limit buffer

    } catch (err) {
      console.warn('SCOUT: SAM.gov error for NAICS ' + naics + ' —', err.message);
      totalApiCalls++;
    }
  }

  // Phase 2: Upsert deduplicated results
  let totalInserted = 0;
  console.log('SCOUT: ' + type + ' — ' + rawBySOL.size + ' unique opps after dedup (from ' + totalApiCalls + ' API calls)');

  for (const { opp, naics } of rawBySOL.values()) {
    const inserted = await upsertOpportunity(opp, type, naics);
    if (inserted) totalInserted++;
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

  // NOTE: 'status' is intentionally omitted from this payload.
  // The DB column has DEFAULT 'new' so new rows start as 'new' automatically.
  // Updates must never overwrite a status set by the user (passed, pursuing, reviewing).
  const { error } = await supabase.from('opportunities').upsert({
    solicitation_number: solNum,
    title:               opp.title || 'Federal Opportunity',
    agency,
    naics,
    type:                type,
    value:               value,
    posted_date:         opp.postedDate ? opp.postedDate.split('T')[0] : new Date().toISOString().split('T')[0],
    deadline:            deadline ? new Date(deadline).toISOString().split('T')[0] : null,
    set_aside:           opp.typeOfSetAside || null,
    place_of_performance: state || null,
    description:         opp.description || null,
    source:              'SAM.gov',
    vertical:            deriveVertical(naics),
    supply_category:     deriveSupplyCategory(naics),  // Stamped here so dashboard can filter without client-side NAICS routing
    pre_prime_score:     primeScore,   // SCOUT rough estimate — JUDGE overwrites prime_score
    raw_data:            opp,
  }, { onConflict: 'solicitation_number' });

  if (error) {
    console.warn('SCOUT: Failed to upsert ' + solNum + ' —', error.message);
    return false;
  }

  // Auto-expire: if the deadline has already passed, mark as expired
  // (only affects rows with status='new' — never touch passed/pursuing/reviewing)
  if (deadline && new Date(deadline) < new Date()) {
    await supabase.from('opportunities')
      .update({ status: 'expired' })
      .eq('solicitation_number', solNum)
      .eq('status', 'new'); // Only expire if user hasn't taken action
  }

  return true;
}

// ----------------------------------------------------------
// SCAN DLA DIBBS: Pull active RFQs via the DIBBS solicitation XML/RSS feed
// DLA DIBBS publishes solicitations at a structured feed endpoint —
// no vendor account required for read access.
// Feed returns XML; we parse <item> entries matching our supply NAICS codes.
// ----------------------------------------------------------
async function scanDLADIBBS() {
  // DIBBS solicitation RSS feed — publicly available, updated nightly
  const DIBBS_RSS = 'https://www.dibbs.bsm.dla.mil/solicitations/rss/';
  let inserted = 0;

  // Supply NAICS codes we target on DIBBS (petroleum, janitorial, PPE, food, office)
  const TARGET_NAICS = new Set(['424710','424130','424490','424120','424410','424690','423440','424310']);

  try {
    const xml = await fetchText(DIBBS_RSS, {
      headers: { 'Accept': 'application/rss+xml, text/xml, */*' },
    });

    if (!xml || xml.length < 200) {
      console.warn('SCOUT: DLA DIBBS feed returned empty response');
      return 0;
    }

    // Parse <item> blocks from RSS XML — no external parser needed
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
    console.log('SCOUT: DLA DIBBS RSS — ' + items.length + ' items in feed');

    for (const item of items) {
      // Extract fields from XML tags
      const title   = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
      const link    = (item.match(/<link>(.*?)<\/link>/))?.[1]?.trim() || '';
      const solNum  = (item.match(/<guid>(.*?)<\/guid>/))?.[1]?.trim() || link || ('DIBBS-' + Date.now());
      const desc    = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/))?.[1]?.trim() || '';
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/))?.[1]?.trim() || null;

      // Extract NAICS from description if present (DLA sometimes includes it)
      const naicsMatch = desc.match(/\b(424\d{3}|423\d{3})\b/);
      const naics = naicsMatch ? naicsMatch[1] : '424490'; // Default to PPE if not found

      // Only save items matching our target supply NAICS or generic supply keywords
      const isTargeted = TARGET_NAICS.has(naics) ||
        /fuel|petroleum|janitorial|ppe|office supply|food|beverage|uniform|lubricant/i.test(title + ' ' + desc);

      if (!isTargeted) continue;

      const deadlineRaw = pubDate ? new Date(new Date(pubDate).getTime() + 30 * 24 * 60 * 60 * 1000) : null;
      const deadline    = deadlineRaw ? deadlineRaw.toISOString().split('T')[0] : null;
      const primeScore  = 55; // Default pre-score for DIBBS items — JUDGE will re-score

      // NOTE: 'status' omitted — DB DEFAULT 'new' handles new rows,
      // updates must never overwrite user-set status (passed/pursuing/reviewing)
      const { error } = await supabase.from('opportunities').upsert({
        solicitation_number: solNum,
        title:               title || 'DLA DIBBS Supply Solicitation',
        agency:              'Defense Logistics Agency',
        naics,
        vertical:            'supply',
        source:              'DLA DIBBS',
        pre_prime_score:     primeScore,
        deadline,
        description:         desc || null,
        posted_date:         pubDate ? new Date(pubDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      }, { onConflict: 'solicitation_number' });

      if (!error) inserted++;
    }

    console.log('SCOUT: DLA DIBBS — ' + inserted + ' supply opportunities saved');
    if (inserted > 0) {
      await logAction('SCOUT', 'DLA DIBBS scan complete', { inserted, items_in_feed: items.length });
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
