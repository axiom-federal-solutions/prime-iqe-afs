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

const opportunities = [
  {
    solicitation_number: 'W912ER-26-R-0042',
    title: 'IT Systems Integration and SAP Configuration Support — Fort Bragg',
    agency: 'Department of Defense',
    sub_office: 'U.S. Army Corps of Engineers',
    naics: '541512',
    set_aside: 'Small Business',
    location: 'Fayetteville, NC',
    state: 'NC',
    value: 2400000,
    posted_date: '2026-04-10',
    deadline: '2026-05-15',
    description_url: 'https://sam.gov/opp/W912ER-26-R-0042',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'N00189-26-R-Z001',
    title: 'SAP ERP Implementation and Training Services — NAVSUP',
    agency: 'Department of the Navy',
    sub_office: 'Naval Supply Systems Command',
    naics: '541519',
    set_aside: 'SDVOSB',
    location: 'Mechanicsburg, PA',
    state: 'PA',
    value: 5800000,
    posted_date: '2026-04-08',
    deadline: '2026-05-20',
    description_url: 'https://sam.gov/opp/N00189-26-R-Z001',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'GS-00F-0026W-Q0099',
    title: 'Enterprise Software Training and Instructional Design Services',
    agency: 'General Services Administration',
    sub_office: 'Federal Acquisition Service',
    naics: '611430',
    set_aside: '8(a)',
    location: 'Washington, DC',
    state: 'DC',
    value: 1200000,
    posted_date: '2026-04-15',
    deadline: '2026-05-10',
    description_url: 'https://sam.gov/opp/GS-00F-0026W-Q0099',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'FA8726-26-R-0055',
    title: 'IT Consulting and Systems Administration — Air Force Materiel Command',
    agency: 'Department of the Air Force',
    sub_office: 'Air Force Materiel Command',
    naics: '541511',
    set_aside: 'Small Business',
    location: 'Wright-Patterson AFB, OH',
    state: 'OH',
    value: 3750000,
    posted_date: '2026-04-12',
    deadline: '2026-05-28',
    description_url: 'https://sam.gov/opp/FA8726-26-R-0055',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'HSCG23-26-R-PBN012',
    title: 'ERP System Upgrade and Configuration — Coast Guard Financial Systems',
    agency: 'Department of Homeland Security',
    sub_office: 'U.S. Coast Guard',
    naics: '541519',
    set_aside: null,
    location: 'Washington, DC',
    state: 'DC',
    value: 8200000,
    posted_date: '2026-04-05',
    deadline: '2026-05-05',
    description_url: 'https://sam.gov/opp/HSCG23-26-R-PBN012',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'TIRNO-26-R-00088',
    title: 'SAP Training Program Development and Delivery — IRS Enterprise Systems',
    agency: 'Department of the Treasury',
    sub_office: 'Internal Revenue Service',
    naics: '611430',
    set_aside: 'HUBZone',
    location: 'Ogden, UT',
    state: 'UT',
    value: 950000,
    posted_date: '2026-04-18',
    deadline: '2026-05-30',
    description_url: 'https://sam.gov/opp/TIRNO-26-R-00088',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'VA119-26-R-0203',
    title: 'IT Systems Support and Software Administration — VA Medical Centers',
    agency: 'Department of Veterans Affairs',
    sub_office: 'Veterans Health Administration',
    naics: '541512',
    set_aside: 'SDVOSB',
    location: 'Multiple Locations, Nationwide',
    state: 'TX',
    value: 4500000,
    posted_date: '2026-04-20',
    deadline: '2026-06-01',
    description_url: 'https://sam.gov/opp/VA119-26-R-0203',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'DISA-26-Q-IT-0047',
    title: 'Cloud Migration and Enterprise IT Modernization Support',
    agency: 'Defense Information Systems Agency',
    sub_office: 'DISA Field Command',
    naics: '541511',
    set_aside: null,
    location: 'Fort Meade, MD',
    state: 'MD',
    value: 12500000,
    posted_date: '2026-04-01',
    deadline: '2026-05-01',
    description_url: 'https://sam.gov/opp/DISA-26-Q-IT-0047',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'ED-OCIO-26-R-0011',
    title: 'Learning Management System Administration and Instructional Design',
    agency: 'Department of Education',
    sub_office: 'Office of the CIO',
    naics: '611430',
    set_aside: '8(a)',
    location: 'Washington, DC',
    state: 'DC',
    value: 680000,
    posted_date: '2026-04-22',
    deadline: '2026-06-10',
    description_url: 'https://sam.gov/opp/ED-OCIO-26-R-0011',
    source: 'SAM.gov',
    status: 'new',
  },
  {
    solicitation_number: 'HHS-2026-IT-TRN-0088',
    title: 'Enterprise Resource Planning Training and Change Management — HHS',
    agency: 'Department of Health and Human Services',
    sub_office: 'Office of the Secretary',
    naics: '541611',
    set_aside: 'Small Business',
    location: 'Rockville, MD',
    state: 'MD',
    value: 2100000,
    posted_date: '2026-04-17',
    deadline: '2026-05-25',
    description_url: 'https://sam.gov/opp/HHS-2026-IT-TRN-0088',
    source: 'SAM.gov',
    status: 'new',
  },
];

async function seedOpportunities() {
  console.log('SEED: Inserting ' + opportunities.length + ' test opportunities into prime-db...');

  const { data, error } = await supabase
    .from('opportunities')
    .upsert(opportunities, { onConflict: 'solicitation_number' })
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
