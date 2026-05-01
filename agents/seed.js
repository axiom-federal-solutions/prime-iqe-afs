// ─────────────────────────────────────────────────────────────────────────────
// PRIME Seed Script — agents/seed.js
// Purpose: Populates prime-db with 10 realistic federal contract opportunities
//          so JUDGE and the rest of the pipeline can be tested WITHOUT a valid
//          SAM.gov API key.
// Run via: node agents/seed.js
// Needs:   SUPABASE_URL and SUPABASE_SERVICE_KEY env vars
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── Vertical classification — must stay in lockstep with agents/scout.js ───
// Without these, seed rows fall to DB DEFAULT 'construction' even when their
// NAICS clearly belongs to supply or realestate, and they show up under the
// wrong dashboard tab.
const SUPPLY_NAICS_PREFIXES = [
  // 2026-04-30: removed 541511/541512/541519/611430/541611 — IT/SAP/training out of scope
  '541330','561110','561210',
  '424410','332999','339999','611420','541618','488490',
  '424710','424720','561720','424130','339113','423440',
  '424120','453210','424490','311999','424690','423450','424310','315990',
];
const RE_NAICS_PREFIXES = [
  '531110','531120','531190','531210','531311','531312','531390','532120','532412',
];
function deriveVertical(naics) {
  const n = (naics || '').trim();
  if (RE_NAICS_PREFIXES.some(p => n.startsWith(p))) return 'realestate';
  if (SUPPLY_NAICS_PREFIXES.some(p => n.startsWith(p))) return 'supply';
  return 'construction';
}
// scout.js writes type='real_estate' (underscore) but vertical='realestate' (no underscore).
// Keep that convention here so dashboard filters match.
function deriveType(vertical) {
  return vertical === 'realestate' ? 'real_estate' : vertical;
}

// 2026-04-30: replaced legacy IT/SAP samples with realistic construction + supply +
// real estate test data using NAICS codes that SCOUT actually scans.
const opportunities = [
  // ── CONSTRUCTION (3 samples) ──────────────────────────────────────────
  {
    solicitation_number: 'W912EE-26-R-0014',
    title: 'Renovation of Building 5050 — Belle Chasse NSA',
    agency: 'Department of Defense',
    sub_office: 'U.S. Army Corps of Engineers — New Orleans District',
    naics: '236220',
    set_aside: 'SDB',
    location: 'Belle Chasse, LA',
    state: 'LA',
    value: 3200000,
    posted_date: '2026-04-22',
    deadline: '2026-05-22',
    description_url: 'https://sam.gov/opp/W912EE-26-R-0014',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'FA3030-26-R-0089',
    title: 'Electrical Distribution Upgrade — Keesler AFB Hangar 4',
    agency: 'Department of the Air Force',
    sub_office: 'Air Education and Training Command',
    naics: '238210',
    set_aside: 'Small Business',
    location: 'Biloxi, MS',
    state: 'MS',
    value: 1450000,
    posted_date: '2026-04-18',
    deadline: '2026-05-30',
    description_url: 'https://sam.gov/opp/FA3030-26-R-0089',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'VA256-26-R-0072',
    title: 'Interior Painting and Wall Repair — Houston VAMC',
    agency: 'Department of Veterans Affairs',
    sub_office: 'VISN 16 — South Central VA Health Care Network',
    naics: '238320',
    set_aside: 'SDVOSB',
    location: 'Houston, TX',
    state: 'TX',
    value: 380000,
    posted_date: '2026-04-25',
    deadline: '2026-05-26',
    description_url: 'https://sam.gov/opp/VA256-26-R-0072',
    source: 'SAM.gov',
    status: 'new',
  },

  // ── SUPPLY (3 samples) ────────────────────────────────────────────────
  {
    solicitation_number: 'SPE600-26-R-0210',
    title: 'Bulk Diesel Fuel Delivery — Barksdale AFB',
    agency: 'Defense Logistics Agency',
    sub_office: 'DLA Energy',
    naics: '424710',
    set_aside: 'SDB',
    location: 'Bossier City, LA',
    state: 'LA',
    value: 2750000,
    posted_date: '2026-04-15',
    deadline: '2026-05-12',
    description_url: 'https://sam.gov/opp/SPE600-26-R-0210',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'SPE300-26-R-0118',
    title: 'Janitorial Paper Products IDIQ — Gulf Coast Region',
    agency: 'Defense Logistics Agency',
    sub_office: 'DLA Troop Support',
    naics: '424130',
    set_aside: 'Small Business',
    location: 'Multiple — LA/MS/AL/FL',
    state: 'LA',
    value: 890000,
    posted_date: '2026-04-12',
    deadline: '2026-05-08',
    description_url: 'https://sam.gov/opp/SPE300-26-R-0118',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'SPE700-26-R-0047',
    title: 'Personal Protective Equipment — Surgical Masks & Gloves',
    agency: 'Defense Logistics Agency',
    sub_office: 'DLA Troop Support — Medical',
    naics: '339113',
    set_aside: 'HUBZone',
    location: 'Mechanicsburg, PA',
    state: 'PA',
    value: 540000,
    posted_date: '2026-04-20',
    deadline: '2026-05-18',
    description_url: 'https://sam.gov/opp/SPE700-26-R-0047',
    source: 'SAM.gov',
    status: 'new',
  },

  // ── REAL ESTATE & RENTAL (2 samples — proves dashboard cross-vertical) ─
  {
    solicitation_number: 'GS-07P-26-LSO-0042',
    title: 'GSA Office Lease — 12,000 RSF, New Orleans CBD',
    agency: 'General Services Administration',
    sub_office: 'GSA PBS Region 7',
    naics: '531120',
    set_aside: 'Small Business',
    location: 'New Orleans, LA',
    state: 'LA',
    value: 4200000,
    posted_date: '2026-04-19',
    deadline: '2026-06-02',
    description_url: 'https://sam.gov/opp/GS-07P-26-LSO-0042',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'VA257-26-Q-PM-0011',
    title: 'Property Management Services — VA Outpatient Clinic Mobile',
    agency: 'Department of Veterans Affairs',
    sub_office: 'VISN 16',
    naics: '531312',
    set_aside: 'SDVOSB',
    location: 'Mobile, AL',
    state: 'AL',
    value: 720000,
    posted_date: '2026-04-23',
    deadline: '2026-05-28',
    description_url: 'https://sam.gov/opp/VA257-26-Q-PM-0011',
    source: 'SAM.gov',
    status: 'new',
  },
];

async function seedOpportunities() {
  console.log('SEED: Inserting ' + opportunities.length + ' test opportunities into prime-db...');

  // Stamp vertical + type from NAICS so seed rows land in the correct dashboard tab.
  // Without this, every IT/training opp (NAICS 541xxx, 611xxx) defaults to 'construction'
  // because that's the DB column default — even though scout.js classifies them as 'supply'.
  const stamped = opportunities.map(opp => {
    const vertical = deriveVertical(opp.naics);
    return {
      ...opp,
      vertical,
      type: deriveType(vertical),
    };
  });

  // Quick visibility into what the seed will write
  const counts = stamped.reduce((acc, o) => {
    acc[o.vertical] = (acc[o.vertical] || 0) + 1;
    return acc;
  }, {});
  console.log('SEED: Vertical distribution —', counts);

  const { data, error } = await supabase
    .from('opportunities')
    .upsert(stamped, { onConflict: 'solicitation_number' })
    .select('id, solicitation_number, title');

  if (error) {
    console.error('SEED: Error inserting opportunities:', error.message);
    process.exit(1);
  }

  console.log('SEED: Successfully seeded ' + data.length + ' opportunities:');
  data.forEach(opp => {
    console.log('  [' + opp.solicitation_number + '] ' + opp.title.slice(0, 60));
  });

  const { error: logError } = await supabase
    .from('audit_log')
    .insert({
      agent: 'SEED',
      action: 'seeded_test_opportunities',
      details: { count: data.length, note: 'Test data — SAM.gov key pending System Account approval' },
      outcome: 'success',
    });

  if (logError) {
    console.warn('SEED: Could not write to audit_log:', logError.message);
  } else {
    console.log('SEED: Audit log entry created.');
  }

  console.log('SEED: Done. JUDGE will score these on next run.');
}

seedOpportunities().catch(err => {
  console.error('SEED: Fatal error:', err);
  process.exit(1);
});
