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
  // 2026-04-30: removed 541511/541512/541519/611430/541611 — IT/SAP/training out of scope
  '541330','561110','561210',
  '424410','332999','339999','611420','541618','488490',
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
const RE_NAICS_PREFIXES = ['531110','531120','531190','531210','531311','531312','531390','532120','532412'];
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
// 2026-05-02: expanded from 7 → 14 codes so dashboard TAXONOMY headings
// (Food, Office, PPE, Safety, Uniforms, Petroleum) actually populate.
// Previously six categories in the filter UI showed zero opps because
// SCOUT never queried their NAICS codes. The dashboard's getVertical()
// already routes these correctly to the supply tab via SUPPLY_NAICS_PREFIXES.
const SUPPLY_NAICS = [
  // Original 7 (Tier 1 — proven categories)
  '424710',  // Petroleum — highest value supply
  '424130',  // Industrial & Personal Service Paper — janitorial
  '424490',  // Other Grocery & Related Products — PPE classification
  '424120',  // Stationery & Office Supplies
  '424690',  // Other Chemical Merchant — cleaning chemicals, degreasers
  '423440',  // Other Commercial Equipment — safety equipment, alt PPE
  '424310',  // Piece Goods Merchant — uniforms, work clothing, linens
  // 2026-05-02 expansion (Tier 2 — fill gaps in dashboard taxonomy)
  '424720',  // Petroleum bulk stations — bulk fuel deliveries (paired with 424710)
  '339113',  // Surgical & medical instruments — PPE manufacturing source
  '423450',  // Medical/professional equipment — safety equipment retail (was empty bucket)
  '424410',  // General-line grocery — federal dining services
  '311999',  // Other food manufacturing — bulk food contracts
  '453210',  // Office supplies & stationery stores — small office contracts
  '315990',  // Apparel accessories & other apparel — uniform accessories
];

// ---- REAL ESTATE & RENTAL NAICS (3rd Vertical — LEASE Score) ----
// Pulled from SAM.gov using federal leasing & property management criteria.
// GSA is the #1 federal real estate buyer — over $6B/yr in leases.
// Priority NAICS are 531120 (GSA office leases) and 531312 (property mgmt for small biz).
const REAL_ESTATE_NAICS = [
  '531110',  // Lessors of Residential Buildings — military housing, family housing privatization
  '531120',  // Lessors of Nonresidential Buildings — GSA office/warehouse/industrial leases (HIGHEST VALUE)
  '531190',  // Lessors of Other Real Estate Property — land, parking, special-use federal sites
  '531210',  // Offices of Real Estate Agents & Brokers — GSA broker representation contracts
  '531311',  // Residential Property Managers — BAH-eligible military housing management
  '531312',  // Nonresidential Property Managers — federal property management (HIGH WIN RATE small biz)
  '531390',  // Other Real Estate Activities — appraisal, title, real estate advisory services
  '532120',  // Truck, Utility Trailer & RV Rental — FEMA/military disaster response
  '532412',  // Construction/Mining Equipment Rental — DLA, USACE construction support
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
// High-value codes (236220, 424710) always run regardless of quota
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
    console.log(`SCOUT: Scanning SAM.gov for real estate & rental contracts (${REAL_ESTATE_NAICS.length} NAICS codes — 531xxx + rental)...`);
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

    // L6-03: Check for NAICS coverage gaps across newly found opportunities
    // If an opp's NAICS isn't in our list but a teaming partner covers it,
    // SCOUT tags the opp as 'teaming_candidate' so JUDGE can still score it
    await checkTeamingGaps();

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
// SAM.gov API v2 requires dates in MM/dd/yyyy format — ISO (YYYY-MM-DD) returns HTTP 200 with 0 results
function toSAMDate(d) {
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}/${day}/${d.getFullYear()}`;
}

// ─── RESOLVE DESCRIPTION ────────────────────────────────────────────────
// SAM.gov sometimes returns a noticedesc API URL as the description instead
// of inline text. This fetches the actual synopsis text using our API key
// so the dashboard can display it without requiring authentication.
async function resolveDescription(desc) {
  if (!desc) return null;
  // Check if it's a SAM.gov noticedesc API URL
  const isNoticeUrl = typeof desc === 'string' && desc.includes('api.sam.gov') && desc.includes('noticedesc');
  if (!isNoticeUrl) return desc; // Already plain text — return as-is
  if (!SAM_API_KEY) return desc; // No API key — return the URL as fallback

  try {
    // Append the API key and fetch the description text
    const separator = desc.includes('?') ? '&' : '?';
    const url = `${desc}${separator}api_key=${SAM_API_KEY}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return desc; // On failure, fall back to storing the URL

    const text = await res.text();
    // SAM.gov returns either JSON with a description field, or raw HTML/text
    try {
      const json = JSON.parse(text);
      const fetched = json.description || json.opportunityDescription || json.content || null;
      if (fetched) return String(fetched).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (_) {
      // Not JSON — strip HTML tags from raw text response
      return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
    }
    return desc; // Fallback
  } catch (err) {
    console.warn('SCOUT: Could not fetch noticedesc — storing URL as fallback:', err.message);
    return desc;
  }
}

async function scanSAMGov(type, naicsCodes, globalCallsUsed = 0) {
  if (!SAM_API_KEY) {
    console.warn('SCOUT: SAM_API_KEY not set — skipping SAM.gov scan');
    return { count: 0, apiCalls: 0 };
  }

  let totalApiCalls = 0;
  // SAM.gov v2 requires MM/dd/yyyy — NOT ISO YYYY-MM-DD
  const today   = toSAMDate(new Date());
  const weekAgo = toSAMDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  console.log('SCOUT: Date range for SAM.gov query — ' + weekAgo + ' to ' + today);

  // Probe call: verify API key + response shape before full scan
  // Uses a single known-active NAICS (236220) to confirm data flows end-to-end
  try {
    // 2026-04-30 BUG FIX: SAM.gov v2 uses 'ncode' for NAICS filter.
    // Old 'naicsCode' was silently ignored, returning the unfiltered ~7166-opp
    // pool for every query — diagnosed via Q2 totalRecords=7166 identical for
    // all 9 real estate NAICS codes. Real estate appeared to work only because
    // it ran last and overwrote prior verticals' stamps via upsert.
    const probeParams = new URLSearchParams({
      api_key:    SAM_API_KEY,
      ncode:      '236220',
      postedFrom: weekAgo,
      postedTo:   today,
      limit:      '3',
      offset:     '0',
    });
    const probe = await fetchJSON(SAM_API_BASE + '?' + probeParams.toString(), {
      headers: { 'Accept': 'application/json' },
    });
    totalApiCalls++;
    const probeKeys   = probe ? Object.keys(probe) : [];
    const probeCount  = probe?.opportunitiesData?.length ?? probe?.data?.length ?? 0;
    const probeTotal  = probe?.totalRecords ?? probe?.total ?? 0;
    console.log('SCOUT PROBE: top-level keys =', JSON.stringify(probeKeys));
    console.log('SCOUT PROBE: totalRecords =', probeTotal, '| opportunitiesData sample count =', probeCount);
    // 2026-04-30: surface probe results to agent_logs so we can diagnose without CI logs
    await logAction('SCOUT', 'SAM.gov probe', {
      vertical:        type,
      probe_naics:     '236220',
      total_records:   probeTotal,
      sample_count:    probeCount,
      response_keys:   probeKeys,
    });
    if (probeCount === 0 && probeTotal === 0) {
      console.warn('SCOUT PROBE: API returned 0 results for 236220 — check API key validity and date range');
    }
    await sleep(500);
  } catch (probeErr) {
    console.warn('SCOUT PROBE: Failed —', probeErr.message);
    await logAction('SCOUT', 'SAM.gov probe failed', { vertical: type, error: probeErr.message });
    totalApiCalls++;
  }

  // Phase 1: Collect all raw opportunities from SAM.gov, deduplicated by solicitation number
  // Collecting first then deduping prevents JUDGE from scoring the same opp twice
  const rawBySOL = new Map(); // solicitation_number → { opp, naics }
  const naicsCounts = {};     // 2026-04-30: per-NAICS result counts for diagnostic logging

  for (const naics of naicsCodes) {
    // Quota soft cap: skip low-priority NAICS when >600 calls used today
    const callsSoFar = globalCallsUsed + totalApiCalls;
    if (callsSoFar >= SAM_QUOTA_SOFT_CAP && LOW_PRIORITY_NAICS.has(naics)) {
      console.log('SCOUT: Quota soft cap (' + callsSoFar + '/' + SAM_DAILY_LIMIT + ') — skipping low-priority NAICS ' + naics);
      naicsCounts[naics] = 'skipped_quota';
      continue;
    }

    try {
      // NOTE: typeOfSetAside is intentionally excluded — 'SDB,' trailing comma returns 0 results.
      // NOTE: 'active: true' is NOT a valid SAM.gov v2 parameter — omitted to avoid silent filtering.
      // Active opportunities are the default when no status filter is specified.
      // 2026-04-30 BUG FIX: 'ncode' not 'naicsCode' for SAM.gov v2 NAICS filter
      const params = new URLSearchParams({
        api_key:    SAM_API_KEY,
        ncode:      naics,
        postedFrom: weekAgo,   // MM/dd/yyyy — required by SAM.gov v2
        postedTo:   today,     // MM/dd/yyyy — required by SAM.gov v2
        limit:      '50',
        offset:     '0',
      });

      const data = await fetchJSON(SAM_API_BASE + '?' + params.toString(), {
        headers: { 'Accept': 'application/json' },
      });

      totalApiCalls++;

      // Support both field names in case SAM.gov API changes key names
      const opps = data?.opportunitiesData || data?.data || [];
      const total = data?.totalRecords ?? data?.total ?? opps.length;
      naicsCounts[naics] = { returned: opps.length, total };
      console.log('SCOUT: NAICS ' + naics + ' — ' + opps.length + ' raw results (totalRecords=' + total + ', quota: ' + (globalCallsUsed + totalApiCalls) + '/' + SAM_DAILY_LIMIT + ')');

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
      naicsCounts[naics] = { error: err.message };
      totalApiCalls++;
    }
  }

  // 2026-04-30: log per-NAICS counts so SAM.gov coverage is visible from the dashboard
  // This is the row that proves whether construction/supply NAICS return zero from SAM.gov
  await logAction('SCOUT', 'SAM.gov NAICS scan results', {
    vertical:       type,
    naics_counts:   naicsCounts,
    total_unique:   rawBySOL.size,
    api_calls:      totalApiCalls,
  });

  // Phase 2: Upsert deduplicated results
  let totalInserted = 0;
  let failStreak    = 0;   // consecutive upsert failures — throw if 3 in a row
  let totalFailures = 0;
  console.log('SCOUT: ' + type + ' — ' + rawBySOL.size + ' unique opps after dedup (from ' + totalApiCalls + ' API calls)');

  for (const { opp, naics } of rawBySOL.values()) {
    const inserted = await upsertOpportunity(opp, type, naics);
    if (inserted) {
      totalInserted++;
      failStreak = 0;  // reset streak on any success
    } else {
      failStreak++;
      totalFailures++;
      if (failStreak >= 3) {
        // Three in a row = systemic write breakage. Stop pretending we're fine.
        await logAction('SCOUT', 'Aborted — consecutive upsert failures', {
          vertical:      type,
          fail_streak:   failStreak,
          total_failures: totalFailures,
          inserted_so_far: totalInserted,
        });
        throw new Error('SCOUT: 3 consecutive upsert failures in vertical=' + type + ' — aborting to fail loud');
      }
    }
  }

  // Summary log so we can see per-vertical insert success rate without digging in CI
  await logAction('SCOUT', 'Vertical scan complete', {
    vertical:        type,
    unique_opps:     rawBySOL.size,
    inserted:        totalInserted,
    failures:        totalFailures,
    api_calls_used:  totalApiCalls,
  });

  return { count: totalInserted, apiCalls: totalApiCalls };
}

// ----------------------------------------------------------
// UPSERT OPPORTUNITY: Save a SAM.gov opportunity to the database
// If it already exists (same solicitation number), update it instead of duplicating
// ----------------------------------------------------------
async function upsertOpportunity(opp, type, naics) {
  const solNum   = opp.solicitationNumber || opp.noticeId || ('SAM-' + Date.now());
  const deadline = opp.responseDeadLine || opp.archiveDate || null;
  // BUG FIX (2026-04-30): old code mistakenly fell through to opp.placeOfPerformance?.state,
  // passing a state code/object to parseValue and forcing every open solicitation to insert
  // with value=NULL. Use real SAM.gov v2 value fields in priority order: actual award amount
  // first, then base+options ceiling, then pre-award estimate, then IDIQ ceiling.
  const value    = parseValue(
    opp.award?.amount ||
    opp.baseAndAllOptionsValue ||
    opp.estimatedTotalValue ||
    opp.awardCeiling ||
    null
  );
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
  // 2026-05-02: capture PSC (Product Service Code) so the dashboard's unified
  // filter system can prefer PSC > NAICS for classification. SAM.gov returns
  // it as `classificationCode`; FPDS sometimes uses `productOrServiceCode`.
  const psc = opp.classificationCode || opp.productOrServiceCode || opp.psc || null;

  const { error } = await supabase.from('opportunities').upsert({
    solicitation_number: solNum,
    title:               opp.title || 'Federal Opportunity',
    agency,
    naics,
    psc,                                       // 2026-05-02: NEW — see SQL migration in sql/add-psc-column.sql
    type:                type,
    value:               value,
    posted_date:         opp.postedDate ? opp.postedDate.split('T')[0] : new Date().toISOString().split('T')[0],
    deadline:            deadline ? new Date(deadline).toISOString().split('T')[0] : null,
    set_aside:           opp.typeOfSetAside || null,
    place_of_performance: state || null,
    state:               state || null,        // 2026-04-30 BUG FIX: dashboard's 50-state map filters on `state` column, not `place_of_performance`. Without this, SAM.gov opps never appeared on the map.
    description:         await resolveDescription(opp.description),
    source:              'SAM.gov',
    vertical:            deriveVertical(naics),
    supply_category:     deriveSupplyCategory(naics),  // Stamped here so dashboard can filter without client-side NAICS routing
    pre_prime_score:     primeScore,   // SCOUT rough estimate — JUDGE overwrites prime_score
    raw_data:            opp,
  }, { onConflict: 'solicitation_number' });

  if (error) {
    // HARDENED 2026-04-30: was console.warn (stderr only, invisible after CI run completes).
    // Now writes to agent_logs so dashboard surfaces the failure.
    console.warn('SCOUT: Failed to upsert ' + solNum + ' —', error.message);
    await logAction('SCOUT', 'Upsert failed', {
      solicitation_number: solNum,
      vertical:            type,
      naics:               naics,
      error:               error.message,
      error_code:          error.code || null,
      error_hint:          error.hint || null,
    });
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

      if (error) {
        // HARDENED 2026-04-30: surface DIBBS upsert failures to agent_logs
        await logAction('SCOUT', 'DIBBS upsert failed', {
          solicitation_number: solNum,
          naics:               naics,
          error:               error.message,
        });
      } else {
        inserted++;
      }
    }

    console.log('SCOUT: DLA DIBBS — ' + inserted + ' supply opportunities saved');
    if (inserted > 0) {
      await logAction('SCOUT', 'DLA DIBBS scan complete', { inserted, items_in_feed: items.length });
    }

  } catch (err) {
    // HARDENED 2026-04-30: was console.warn (invisible after run); now to agent_logs
    console.warn('SCOUT: DLA DIBBS scan error —', err.message);
    await logAction('SCOUT', 'DLA DIBBS scan error', { error: err.message });
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

// Pre-score for Real Estate & Rental opportunities pulled from SAM.gov
// Scoring criteria: location match, NAICS priority tier, set-aside, contract value, agency
// JUDGE will run the full LEASE Score — this just flags high-interest opps for BRANDI
function calcPreLeaseScore(opp, naics, state) {
  let score = 40;  // Base — asset ownership is the real gating factor; JUDGE confirms

  // ── LOCATION — Gulf Coast / LA service area is home turf ────────────────
  if (state && COMPANY.service_states.includes(state)) score += 20;
  if (state === 'LA') score += 5;  // Home state bonus

  // ── NAICS PRIORITY TIERS ────────────────────────────────────────────────
  // Tier 1 — GSA leasing (highest $ opportunity)
  if (['531120','531110'].includes(naics)) score += 15;
  // Tier 2 — Property management (best win rate for small biz SDB)
  if (['531311','531312'].includes(naics)) score += 12;
  // Tier 3 — Other leasing/advisory
  if (['531190','531210','531390'].includes(naics)) score += 8;
  // Tier 4 — Equipment/vehicle rental (FEMA disaster response surge)
  if (['532120','532412'].includes(naics)) score += 10;

  // ── AGENCY BONUS — GSA is the primary federal real estate buyer ─────────
  const agency = (opp.departmentName || opp.subtierName || '').toUpperCase();
  if (agency.includes('GSA') || agency.includes('GENERAL SERVICES')) score += 10;
  if (agency.includes('HUD') || agency.includes('HOUSING')) score += 8;
  if (agency.includes('VA') || agency.includes('VETERANS')) score += 6;

  // ── SET-ASIDE — SDB, HUBZone, WOSB, SDVOSB all worth pursuing ───────────
  if (opp.typeOfSetAside && SET_ASIDE_TYPES.includes(opp.typeOfSetAside)) score += 10;

  // ── VALUE RANGE — Sweet spot for small business: $50K–$5M ───────────────
  const val = parseValue(opp.award?.amount || opp.estimatedTotalValue);
  if (val && val >= 50000 && val <= 5000000) score += 5;

  // ── KEYWORD SIGNALS — lease, property management, facilities ─────────────
  const title = (opp.title || '').toLowerCase();
  if (title.includes('lease') || title.includes('leasing')) score += 5;
  if (title.includes('property management') || title.includes('facility management')) score += 5;
  if (title.includes('grounds') || title.includes('landscape')) score += 5; // Monnie teaming advantage

  return Math.min(score, 85);
}

// ----------------------------------------------------------
// HELPERS: Parse value and extract state from SAM.gov data
// ----------------------------------------------------------
function parseValue(raw) {
  if (!raw) return null;
  const num = parseFloat(String(raw).replace(/[$,]/g, ''));
  return isNaN(num) ? null : num;
}

// 2026-04-30 BUG FIX: SAM.gov returns state in inconsistent formats —
// sometimes { code: 'LA', name: 'Louisiana' }, sometimes 'Louisiana' (full name),
// sometimes 'LA' already. Normalize to 2-letter uppercase code so the dashboard's
// STATE_META map can bucket the row. Anything we can't recognize returns null
// (better to drop than to mis-bucket).
const _STATE_NAME_TO_CODE = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','district of columbia':'DC',
  'florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID','illinois':'IL',
  'indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA',
  'maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN',
  'mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV',
  'new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY',
  'north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK','oregon':'OR',
  'pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',
  'tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA',
  'washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY','dc':'DC',
};
function normalizeState(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') {
    if (raw.code && /^[A-Za-z]{2}$/.test(raw.code)) return raw.code.toUpperCase();
    if (raw.name) raw = raw.name;
    else return null;
  }
  const s = String(raw).trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const cleaned = s.replace(/[,\s]+(USA|United States|U\.S\.)$/i, '').trim().toLowerCase();
  return _STATE_NAME_TO_CODE[cleaned] || null;
}

function extractState(opp) {
  const raw =
    opp.placeOfPerformance?.state?.code ||
    opp.placeOfPerformance?.state ||
    opp.officeAddress?.state ||
    null;
  return normalizeState(raw);
}

// ----------------------------------------------------------
// L6-03: NAICS GAP DETECTION — Teaming Intelligence
// Checks recent opportunities against our own NAICS list.
// If an opp's NAICS isn't covered by us but IS covered by a teaming
// partner in teaming_agreements, tags it 'teaming_candidate' and
// records which partner could fill the gap.
// This means JUDGE scores it instead of silently ignoring it.
// ----------------------------------------------------------
async function checkTeamingGaps() {
  // Only run if L6-03 is active (at least 1 teaming partner on file)
  const teamingActive = await getConfig('L6_03_TEAMING_ACTIVE', 'false');
  if (teamingActive !== 'true') {
    // Check if we now have at least 1 active partner — if so, auto-activate
    const { count } = await supabase
      .from('teaming_agreements')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);

    if (count && count > 0) {
      await setConfig('L6_03_TEAMING_ACTIVE', 'true');
      console.log('SCOUT L6-03: Teaming intelligence activated — ' + count + ' active partners on file');
    } else {
      return; // No partners yet — nothing to check against
    }
  }

  // Pull all active teaming partners and their NAICS codes
  const { data: partners } = await supabase
    .from('teaming_agreements')
    .select('id, partner_name, naics_codes, role, set_aside_certs')
    .eq('active', true);

  if (!partners || partners.length === 0) return;

  // Get recent unscored opportunities that may be outside our direct coverage
  const { data: recentOpps } = await supabase
    .from('opportunities')
    .select('id, naics, title, agency, set_aside')
    .eq('status', 'new')
    .not('naics', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!recentOpps || recentOpps.length === 0) return;

  // Our own full NAICS list — flattened from all verticals
  const ourNaics = new Set([
    ...CONSTRUCTION_NAICS,
    ...SUPPLY_NAICS,
    ...REAL_ESTATE_NAICS,
  ]);

  let gapsFound = 0;

  for (const opp of recentOpps) {
    const naics = (opp.naics || '').trim();
    if (!naics) continue;

    // Check if we cover this NAICS directly (first 6 digits)
    const directlyCovered = [...ourNaics].some(n => naics.startsWith(n) || n.startsWith(naics));
    if (directlyCovered) continue; // We're good — no gap

    // Find which teaming partners cover this NAICS
    const coveringPartners = partners.filter(p =>
      (p.naics_codes || []).some(pn => naics.startsWith(pn) || pn.startsWith(naics))
    );

    if (coveringPartners.length === 0) continue; // Nobody covers it — true gap

    // Tag the opportunity as a teaming candidate so it stays visible
    await supabase
      .from('opportunities')
      .update({
        status:           'teaming_candidate',
        teaming_partner:  coveringPartners[0].partner_name,
        teaming_note:     coveringPartners.map(p => p.partner_name + ' (' + p.role + ')').join(', '),
      })
      .eq('id', opp.id);

    gapsFound++;
  }

  if (gapsFound > 0) {
    await logAction('SCOUT', 'L6-03 teaming gaps resolved', {
      opportunities_tagged: gapsFound,
      partners_checked:     partners.length,
    });
    console.log('SCOUT L6-03: ' + gapsFound + ' opportunities tagged as teaming candidates');
  }
}

// Run SCOUT when this file is executed
runScout();
