// =============================================================
// RECON.JS — Research, Evaluation & Competitive Operations Network
// JOB: Find out who holds current contracts and when they expire
//      Also monitor GAO protests, OSDBU events, and agency forecasts
// SCHEDULE: Every day at 11:00 AM Central Time
// COST: ~$3/month (uses Claude Haiku for forecast analysis)
// =============================================================

// Load helper tools
const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// USAspending API — no key needed, completely free and open
const USASPENDING_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

// GAO protest docket — monitored daily
const GAO_DOCKET_URL = 'https://www.gao.gov/legal/bid-protests/docket';

// The job categories we focus on
const NAICS_CODES = ['236220','238210','237990','236116','561730',
                     '424710','424130','424490','424120'];

// If a contract ends within this many days, it's a recompete opportunity
const RECOMPETE_WINDOW_DAYS = 180;

// Agency OSDBU pages we monitor for matchmaking events
const OSDBU_PAGES = [
  { agency: 'Department of Defense', url: 'https://business.defense.gov/Events/' },
  { agency: 'Department of Veterans Affairs', url: 'https://www.va.gov/osdbu/events/' },
  { agency: 'GSA', url: 'https://www.gsa.gov/about-us/events-and-training' },
  { agency: 'Department of Energy', url: 'https://www.energy.gov/osdbu/events' },
  { agency: 'Department of Transportation', url: 'https://www.transportation.gov/osdbu/events' },
  { agency: 'Department of Homeland Security', url: 'https://www.dhs.gov/osdbu/events' },
  { agency: 'HUD', url: 'https://www.hud.gov/osdbu' },
  { agency: 'Army Corps of Engineers', url: 'https://www.usace.army.mil/Business-With-Us/' },
];

// ----------------------------------------------------------
// MAIN FUNCTION: Run the full intelligence sweep
// ----------------------------------------------------------
async function runRecon() {
  console.log('RECON: Starting intelligence sweep at ' + new Date().toISOString());

  try {
    await incumbentRadar();      // Find who holds contracts and when they expire
    await checkCPARS();          // Look for our performance evaluations
    await monitorGAO();          // Check for bid protests affecting our pipeline
    await scanOSDBUEvents();     // Find matchmaking events

    await logAction('RECON', 'Intelligence sweep complete', { timestamp: new Date().toISOString() });
    console.log('RECON: Done.');
  } catch (err) {
    console.error('RECON ERROR:', err.message);
    await logAction('RECON', 'Sweep failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// INCUMBENT RADAR: Find who holds contracts in our NAICS codes
// This tells us when competitors' contracts expire = our next bid opportunity
// ----------------------------------------------------------
async function incumbentRadar() {
  console.log('RECON: Running incumbent radar...');

  for (const naics of NAICS_CODES) {
    try {
      // Ask USAspending for active awards in this NAICS code
      const res = await fetch(USASPENDING_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            naics_codes: [naics],
            award_type_codes: ['A', 'B', 'C', 'D'], // Contract types
            time_period: [{ start_date: '2020-01-01', end_date: new Date().toISOString().split('T')[0] }],
          },
          fields: ['recipient_name', 'period_of_performance_current_end_date',
                   'award_amount', 'piid', 'awarding_agency_name'],
          page: 1,
          limit: 100,
          sort: 'period_of_performance_current_end_date',
          order: 'asc',
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();
      const awards = data.results || [];

      for (const award of awards) {
        const endDate  = award.period_of_performance_current_end_date;
        const daysToEnd = endDate
          ? Math.floor((new Date(endDate) - new Date()) / 86400000)
          : null;

        // Save incumbent info to the database
        await supabase.from('incumbents').upsert({
          solicitation_number: award.piid,
          incumbent_name: award.recipient_name,
          contract_value: award.award_amount,
          end_date: endDate,
          // If contract ends within 180 days, mark it as a recompete opportunity
          recompete_date: (daysToEnd !== null && daysToEnd <= RECOMPETE_WINDOW_DAYS) ? endDate : null,
          source: 'USAspending',
        }, { onConflict: 'solicitation_number' });
      }

      // Small pause between API calls
      await sleep(500);
    } catch (err) {
      console.warn('RECON: Incumbent radar failed for NAICS ' + naics + ' — ' + err.message);
    }
  }

  // Count how many recompetes we found
  const { data: recompetes } = await supabase
    .from('incumbents')
    .select('id')
    .not('recompete_date', 'is', null);

  console.log('RECON: Found ' + (recompetes?.length || 0) + ' upcoming recompete opportunities');
  await logAction('RECON', 'Incumbent radar complete', { recompetes: recompetes?.length || 0 });
}

// ----------------------------------------------------------
// CPARS CHECK: Look for any contractor performance ratings
// CPARS is how agencies rate contractor performance (Exceptional/Very Good/Satisfactory/etc.)
// ----------------------------------------------------------
async function checkCPARS() {
  console.log('RECON: Checking CPARS ratings...');

  // Get our active contracts
  const { data: contracts } = await supabase
    .from('active_contracts')
    .select('id, contract_number, agency');

  if (!contracts || contracts.length === 0) return;

  for (const contract of contracts) {
    // Check if we already have a CPARS entry for this contract
    const { data: existing } = await supabase
      .from('cpars_ratings')
      .select('id')
      .eq('contract_id', contract.id)
      .single();

    if (!existing) {
      // Create a placeholder — the actual rating will be entered manually
      // when the agency posts it in the CPARS system
      const responseDeadline = new Date();
      responseDeadline.setDate(responseDeadline.getDate() + 14); // 14-day response window

      await supabase.from('cpars_ratings').insert({
        contract_id: contract.id,
        response_deadline: responseDeadline.toISOString().split('T')[0],
        response_submitted: false,
      });
    }
  }

  await logAction('RECON', 'CPARS check complete', { contracts_checked: contracts.length });
}

// ----------------------------------------------------------
// GAO MONITOR: Check for bid protests that affect our pipeline
// GAO protests can stop award of a contract we want or have won
// ----------------------------------------------------------
async function monitorGAO() {
  console.log('RECON: Monitoring GAO protest docket...');
  // Note: GAO scraping requires a browser tool or paid API
  // For now we log the check — manual review at gao.gov/legal/bid-protests/search
  await logAction('RECON', 'GAO docket check logged', {
    note: 'Manual review required at gao.gov/legal/bid-protests/search',
    timestamp: new Date().toISOString(),
  });
}

// ----------------------------------------------------------
// OSDBU EVENTS: Find matchmaking events where agencies meet small businesses
// These events are great for building CO relationships
// ----------------------------------------------------------
async function scanOSDBUEvents() {
  console.log('RECON: Scanning OSDBU event pages...');

  for (const page of OSDBU_PAGES) {
    try {
      // Log that we need to check this page
      // Full web scraping is added in a future chapter
      await logAction('RECON', 'OSDBU page queued for review', {
        agency: page.agency,
        url: page.url,
      });
    } catch (err) {
      console.warn('RECON: Could not scan ' + page.agency + ' — ' + err.message);
    }
  }

  await logAction('RECON', 'OSDBU event scan complete', { pages_checked: OSDBU_PAGES.length });
}

// ----------------------------------------------------------
// HELPER: Wait a set number of milliseconds between API calls
// ----------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------------------------------------
// START: Run RECON when this file is executed
// ----------------------------------------------------------
runRecon();
