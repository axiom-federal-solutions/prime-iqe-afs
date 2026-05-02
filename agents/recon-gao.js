// =============================================================
// RECON-GAO.JS — GAO Bid Protest Docket Scanner
// JOB: Scan the GAO bid protest docket for decisions that
//      affect Walker Contractors' pipeline.
//      Alert on: won contracts being protested,
//                lost contracts eligible for protest.
// SCHEDULE: Daily 10 AM UTC (gao-protest-scan.yml)
// COST: ~$0.50/month (Haiku for protest analysis)
// NOTE: GAO protest deadline is 10 days after contract award
//       or 10 days after when basis of protest known
// =============================================================

const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// GAO public docket search
// GAO protest database: https://www.gao.gov/legal/bid-protests/search
const GAO_BASE_URL = 'https://www.gao.gov';

// Days after award to file a protest (typical deadline)
const PROTEST_DEADLINE_DAYS = 10;

// Target agencies where Walker Contractors is active
const TARGET_AGENCIES = [
  'Army', 'Navy', 'Air Force', 'USACE', 'VA',
  'GSA', 'DHS', 'DLA', 'Marines', 'Coast Guard',
];

// ----------------------------------------------------------
// MAIN: Run daily GAO protest scan
// ----------------------------------------------------------
async function runGAOScan() {
  console.log('RECON GAO: Scanning GAO protest docket...');

  try {
    // Get recent protest decisions from database
    const recentProtests = await getRecentProtests();
    console.log('RECON GAO: Found ' + recentProtests.length + ' tracked protests.');

    // Check our own bids for protest opportunities (within 10-day window)
    const protestOpportunities = await findProtestableAwards();
    console.log('RECON GAO: Found ' + protestOpportunities.length + ' protestable awards.');

    // Check if any of our won contracts have active protests
    const activeProtests = await checkForProtestsOnOurContracts();

    await logAction('RECON', 'GAO protest scan complete', {
      tracked_protests: recentProtests.length,
      protestable_awards: protestOpportunities.length,
      protests_on_our_contracts: activeProtests.length,
      action: activeProtests.length > 0
        ? 'URGENT: Review protests against Walker Contractors awards'
        : 'No active protests against our awards',
    });

    console.log('RECON GAO: Scan complete.');

  } catch (err) {
    console.error('RECON GAO ERROR:', err.message);
    await logAction('RECON', 'GAO protest scan failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// PROTESTABLE AWARDS: Find recent losses still within protest window
// ----------------------------------------------------------
async function findProtestableAwards() {
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - PROTEST_DEADLINE_DAYS);

  const { data: recentLosses } = await supabase
    .from('bids')
    .select('*, opportunities(*)')
    .eq('result', 'lost')
    .gte('decision_date', tenDaysAgo.toISOString().split('T')[0]);

  // 2026-05-02: log empty input so dashboard distinguishes
  // "RECON ran but had nothing to chew on" from "RECON never ran".
  if (!recentLosses || recentLosses.length === 0) {
    await logAction('RECON', 'No recent losses in protest window', {
      window_days: PROTEST_DEADLINE_DAYS,
      checked_at: new Date().toISOString(),
    });
    return [];
  }

  const protestable = recentLosses.filter(bid => {
    const decisionDate = new Date(bid.decision_date);
    const daysAgo = Math.floor((new Date() - decisionDate) / 86400000);
    return daysAgo <= PROTEST_DEADLINE_DAYS;
  });

  if (protestable.length > 0) {
    for (const bid of protestable) {
      const decisionDate = new Date(bid.decision_date);
      const daysLeft = PROTEST_DEADLINE_DAYS - Math.floor((new Date() - decisionDate) / 86400000);

      // Analyze whether a protest is worth filing
      const analysis = await claudeHaiku(
        'A small business federal construction contractor (Walker Contractors LLC, SDB certified) ' +
        'lost a bid. Analyze whether a GAO bid protest is worth filing. ' +
        'Opportunity: ' + JSON.stringify({
          title: bid.opportunities?.title,
          agency: bid.opportunities?.agency,
          value: bid.opportunities?.value,
          prime_score: bid.opportunities?.prime_score,
          set_aside: bid.opportunities?.set_aside,
        }) +
        '. In 2 sentences: (1) Is there a plausible protest ground? ' +
        '(2) Is the contract value worth the protest cost (~$3,500 attorney fees)?'
      );

      await logAction('RECON', 'Protestable award identified', {
        solicitation: bid.opportunities?.solicitation_number,
        agency: bid.opportunities?.agency,
        value: bid.opportunities?.value,
        days_left_to_protest: daysLeft,
        analysis: analysis,
        action: 'Review protest analysis in Brandi brief. Decide within ' + daysLeft + ' days.',
      });
    }
  }

  return protestable;
}

// ----------------------------------------------------------
// CHECK OWN CONTRACTS: Look for protests against Walker awards
// ----------------------------------------------------------
async function checkForProtestsOnOurContracts() {
  const { data: protests } = await supabase
    .from('gao_protests')
    .select('*')
    .eq('impacts_walker', true)
    .is('outcome', null); // No outcome yet = active protest

  if (protests && protests.length > 0) {
    for (const protest of protests) {
      await logAction('RECON', 'ACTIVE PROTEST on Walker Contractors award', {
        gao_case: protest.gao_case_number,
        protester: protest.protester,
        agency: protest.agency,
        action: 'URGENT: Contact legal counsel. GAO typically resolves in 100 days.',
      });
    }
  }

  return protests || [];
}

// ----------------------------------------------------------
// GET RECENT: Load tracked protests from database
// ----------------------------------------------------------
async function getRecentProtests() {
  const { data } = await supabase
    .from('gao_protests')
    .select('*')
    .order('filed_date', { ascending: false })
    .limit(20);
  return data || [];
}

// Run when file is executed
runGAOScan();
