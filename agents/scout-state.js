// =============================================================
// SCOUT-STATE.JS — State Procurement Portal Scanner
// JOB: Scan state procurement portals for construction
//      and supply opportunities NOT on SAM.gov.
//      Targets: LaPAC, MyFlorida, GeorgiaFirst, TX DIR, VA eVA
// SCHEDULE: Daily 4 AM UTC (scout-state-portals.yml)
// COST: ~$0 (no LLM — pure search + dedup)
// =============================================================

const { supabase, logAction } = require('../lib/supabase');

<<<<<<< HEAD
// ----------------------------------------------------------
// VERTICAL DERIVATION: Classify opportunity by NAICS code
// ----------------------------------------------------------
const SUPPLY_NAICS_PREFIXES = ['541511','541512','541519','541330','561110','561210','424410','332999','339999','611420','611430','541611','541618','488490'];
const RE_NAICS_PREFIXES = ['531110','531120','531210','531311','531312','531390'];
function deriveVertical(naics) {
  const n = (naics || '').trim();
  if (RE_NAICS_PREFIXES.some(p => n.startsWith(p))) return 'realestate';
  if (SUPPLY_NAICS_PREFIXES.some(p => n.startsWith(p))) return 'supply';
  return 'construction';
}

// Walker Contractors target NAICS codes
// Construction: 236220, 238210, 237990, 236116, 561730
// Supply: 424710 (Fuel), 424130 (Janitorial/Paper), 424490 (PPE), 424120 (Office Supplies), 424410 (Food & Beverage)
const NAICS_CODES = ['236220', '238210', '237990', '236116', '561730', '424710', '424130', '424490', '424120', '424410'];
=======
// Walker Contractors target NAICS codes
const NAICS_CODES = ['236220', '238210', '237990', '236116', '561730', '424710', '424130', '424490', '424120'];
>>>>>>> prime-system/main

// State procurement portals to scan
const STATE_PORTALS = [
  {
    state: 'LA',
    name: 'LaPAC',
    url: 'https://wwwcfprd.doa.louisiana.gov/osp/lapac/dspBid.cfm',
    priority: 'HIGH',  // Home state — highest priority
    notes: 'Louisiana Procurement and Contract portal',
  },
  {
    state: 'MS',
    name: 'MS-MAGIC',
    url: 'https://www.ms.gov/dfa/contract_bid_search/',
    priority: 'HIGH',
    notes: 'Mississippi procurement portal',
  },
  {
    state: 'FL',
    name: 'MyFlorida',
    url: 'https://www.myflorida.com/apps/vbs/vbs_www.main_menu',
    priority: 'MEDIUM',
    notes: 'Florida Vendor Bid System',
  },
  {
    state: 'TX',
    name: 'TX ESBD',
    url: 'https://www.txsmartbuy.gov/esbd',
    priority: 'MEDIUM',
    notes: 'Texas Electronic State Business Daily',
  },
  {
    state: 'AL',
    name: 'Alabama Procurement',
    url: 'https://procurement.statefp.alabama.gov/',
    priority: 'MEDIUM',
    notes: 'Alabama procurement portal',
  },
  {
    state: 'TN',
    name: 'Tennessee Procurement',
    url: 'https://hub.Tennessee.gov/hub/login',
    priority: 'LOW',
    notes: 'Tennessee vendor portal',
  },
  {
    state: 'GA',
    name: 'GeorgiaFirst',
    url: 'https://ssl.doas.state.ga.us/PRSapp/PR_BidsMain.jsp',
    priority: 'LOW',
    notes: 'Georgia procurement portal',
  },
];

// ----------------------------------------------------------
// MAIN: Run daily state portal scan
// ----------------------------------------------------------
async function runStatePortalScan() {
  console.log('SCOUT STATE: Starting daily state portal scan...');

  let totalInserted = 0;
  let errors = 0;

  for (const portal of STATE_PORTALS) {
    try {
      const inserted = await scanPortal(portal);
      totalInserted += inserted;
    } catch (err) {
      console.warn('SCOUT STATE: Error scanning ' + portal.name + ' — ' + err.message);
      errors++;
    }
  }

  await logAction('SCOUT', 'State portal scan complete', {
    portals_scanned: STATE_PORTALS.length,
    opportunities_inserted: totalInserted,
    errors: errors,
    states: STATE_PORTALS.map(p => p.state),
  });

  console.log('SCOUT STATE: Scan complete. ' + totalInserted + ' new opportunities found.');
}

// ----------------------------------------------------------
// SCAN PORTAL: Check one state portal for opportunities
// Note: Full API/scraping integration goes here when portals
// expose APIs. Until then, logs the scan attempt.
// ----------------------------------------------------------
async function scanPortal(portal) {
  console.log('SCOUT STATE: Scanning ' + portal.name + ' (' + portal.state + ')...');

  try {
    // Attempt to reach the portal
    const response = await fetch(portal.url, {
      headers: { 'User-Agent': 'PRIME Federal Contracting Intelligence System' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn('SCOUT STATE: ' + portal.name + ' returned ' + response.status);
      return 0;
    }

    const text = await response.text();

    // Basic keyword matching — look for construction-related postings
    const constructionKeywords = ['construction', 'renovation', 'repair', 'facility', 'building', 'HVAC', 'electrical', 'plumbing', 'roofing'];
    const hasConstruction = constructionKeywords.some(kw => text.toLowerCase().includes(kw));

    if (hasConstruction) {
      // Log that this portal has relevant activity
      // Full parsing integration would extract solicitation numbers and insert records here
      await logAction('SCOUT', 'State portal has construction activity', {
        portal: portal.name,
        state: portal.state,
        priority: portal.priority,
        url: portal.url,
        action: 'Visit portal manually to review construction solicitations',
      });
    }

    return 0; // Count of newly inserted records (0 until full API parsing is added)

  } catch (err) {
    console.warn('SCOUT STATE: Could not reach ' + portal.name + ' — ' + err.message);
    return 0;
  }
}

// ----------------------------------------------------------
// UPSERT: Save a state opportunity to the database
// Called when portal APIs expose structured data
// ----------------------------------------------------------
async function upsertStateOpportunity(opp, portal) {
  const solicitationNumber = opp.solicitation_number || portal.state + '-' + Date.now();

<<<<<<< HEAD
  const naicsCode = opp.naics || '236220';
  const rawDeadline = opp.deadline || null;
  const parsedDeadline = rawDeadline ? new Date(rawDeadline).toISOString().split('T')[0] : null;

=======
>>>>>>> prime-system/main
  const { error } = await supabase.from('opportunities').upsert({
    solicitation_number: solicitationNumber,
    title: opp.title || 'State Procurement Opportunity',
    agency: portal.state + ' ' + (opp.agency || 'State Agency'),
<<<<<<< HEAD
    naics: naicsCode,
    state: portal.state,
    value: opp.value || null,
    posted_date: opp.posted_date || new Date().toISOString().split('T')[0],
    deadline: parsedDeadline,
    source: portal.name,
    status: 'new',
    vertical: deriveVertical(naicsCode),
=======
    naics: opp.naics || '236220',
    state: portal.state,
    value: opp.value || null,
    posted_date: opp.posted_date || new Date().toISOString().split('T')[0],
    deadline: opp.deadline || null,
    source: portal.name,
    status: 'new',
>>>>>>> prime-system/main
  }, { onConflict: 'solicitation_number' });

  if (error) {
    console.warn('SCOUT STATE: Failed to upsert ' + solicitationNumber, error.message);
    return false;
  }

  return true;
}

// Run when file is executed
runStatePortalScan();
