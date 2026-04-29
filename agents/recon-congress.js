// =============================================================
// RECON-CONGRESS.JS — Congressional Appropriations Intel
// JOB: Scan Congress.gov for appropriations bills affecting
//      federal construction and supply budgets.
<<<<<<< HEAD
//      Gives Walker Contractors 12-18 month early warning
//      of budget changes in target agencies.
=======
//      Gives Walker Contractors 12-18 month early warning.
>>>>>>> prime-system/main
// SCHEDULE: Monday 8 AM UTC (recon-congressional.yml)
// COST: ~$0.50/month (Haiku for bill parsing)
// =============================================================

const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

<<<<<<< HEAD
// Congress.gov API (free, no key required for basic searches)
const CONGRESS_API = 'https://api.congress.gov/v3';

// Keywords we watch for in bills — construction and supply related
const WATCH_KEYWORDS = [
  'military construction',
  'MILCON',
  'civil works',
  'Army Corps of Engineers',
  'VA construction',
  'Veterans Affairs construction',
  'DHS facilities',
  'GSA public buildings',
  'janitorial',
  'fuel supply',
  'maintenance and repair',
];

// Target agencies for Walker Contractors
const TARGET_AGENCIES = ['Army', 'Navy', 'Air Force', 'VA', 'GSA', 'DHS', 'USACE'];

=======
const CONGRESS_API = 'https://api.congress.gov/v3';

const WATCH_KEYWORDS = [
  'military construction', 'MILCON', 'civil works',
  'Army Corps of Engineers', 'VA construction',
  'Veterans Affairs construction', 'DHS facilities',
  'GSA public buildings', 'janitorial', 'fuel supply',
  'maintenance and repair',
];

>>>>>>> prime-system/main
// ----------------------------------------------------------
// MAIN: Run weekly congressional intel scan
// ----------------------------------------------------------
async function runCongressionalIntel() {
  console.log('RECON CONGRESS: Scanning Congress.gov for appropriations activity...');

  try {
<<<<<<< HEAD
    // Search for recent appropriations bills
=======
>>>>>>> prime-system/main
    const bills = await searchAppropriationsBills();
    console.log('RECON CONGRESS: Found ' + bills.length + ' relevant bills.');

    let flagged = 0;
    for (const bill of bills) {
      const relevant = await analyzeBill(bill);
      if (relevant) flagged++;
    }

    await logAction('RECON', 'Congressional intel scan complete', {
      bills_reviewed: bills.length,
      flagged_for_review: flagged,
      keywords_monitored: WATCH_KEYWORDS.length,
    });

    console.log('RECON CONGRESS: Scan complete. ' + flagged + ' bills flagged.');

  } catch (err) {
    console.error('RECON CONGRESS ERROR:', err.message);
    await logAction('RECON', 'Congressional intel scan failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// SEARCH: Find recent appropriations bills on Congress.gov
// ----------------------------------------------------------
async function searchAppropriationsBills() {
  try {
<<<<<<< HEAD
    // Congress.gov v3 API — search for appropriations legislation
    const url = CONGRESS_API + '/bill?congress=119&type=hr&subject=Appropriations&limit=20';
    const response = await fetch(url);

=======
    const url = CONGRESS_API + '/bill?congress=119&type=hr&subject=Appropriations&limit=20';
    const response = await fetch(url);
>>>>>>> prime-system/main
    if (!response.ok) {
      console.warn('RECON CONGRESS: Congress.gov API returned ' + response.status + ' — using fallback');
      return getStaticBillList();
    }
<<<<<<< HEAD

    const data = await response.json();
    return data.bills || [];

=======
    const data = await response.json();
    return data.bills || [];
>>>>>>> prime-system/main
  } catch (err) {
    console.warn('RECON CONGRESS: Could not reach Congress.gov — ' + err.message);
    return getStaticBillList();
  }
}

<<<<<<< HEAD
// Fallback: notable bills to monitor if API is unavailable
=======
>>>>>>> prime-system/main
function getStaticBillList() {
  return [
    { title: 'Military Construction Appropriations Act', status: 'monitor', session: '119th' },
    { title: 'VA Medical Facility Construction Fund', status: 'monitor', session: '119th' },
    { title: 'Energy and Water Development Appropriations Act', status: 'monitor', session: '119th' },
  ];
}

// ----------------------------------------------------------
// ANALYZE: Check if a bill impacts Walker Contractors pipeline
// ----------------------------------------------------------
async function analyzeBill(bill) {
  const billText = JSON.stringify(bill);
<<<<<<< HEAD
  const isRelevant = WATCH_KEYWORDS.some(kw =>
    billText.toLowerCase().includes(kw.toLowerCase())
  );

  if (!isRelevant) return false;

  // Use Haiku to summarize the impact
=======
  const isRelevant = WATCH_KEYWORDS.some(kw => billText.toLowerCase().includes(kw.toLowerCase()));
  if (!isRelevant) return false;

>>>>>>> prime-system/main
  const analysis = await claudeHaiku(
    'Analyze this federal appropriations bill and summarize its impact on a small business ' +
    'federal construction contractor (Walker Contractors LLC) based in New Orleans, LA. ' +
    'They specialize in: military construction, VA facilities, civil works, and government supply. ' +
    'Bill data: ' + JSON.stringify(bill) +
    '. In 2-3 sentences: What does this bill fund? How much? When would contracts flow? ' +
    'Is this an opportunity or a risk?'
  );

  await logAction('RECON', 'Congressional appropriations alert', {
    bill_title: bill.title || 'Unknown',
    bill_number: bill.number || 'Unknown',
    session: bill.session || '119th',
    analysis: analysis,
    action: 'Review in Brandi brief — potential 12-18 month pipeline opportunity',
  });

  return true;
}

// Run when file is executed
runCongressionalIntel();
