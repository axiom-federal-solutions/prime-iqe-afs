// =============================================================
// EXEC-PAYROLL.JS — WH-347 Certified Payroll Generator
// JOB: Generate certified payroll forms for all active
//      Davis-Bacon construction contracts every Friday
// SCHEDULE: Friday 4 PM UTC (exec-certified-payroll.yml)
// LEGAL: Davis-Bacon Act — 29 CFR Part 5
//        WH-347 required weekly for all federal construction
// COST: ~$0 (no LLM — form generation only)
// =============================================================

<<<<<<< HEAD
const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');

// Minimum Davis-Bacon hourly rates by state (construction)
// These back up the live DOL rates for validation
const MINIMUM_RATES = {
  'LA': 27.00,
  'TX': 28.00,
  'MS': 24.00,
  'AL': 25.00,
  'TN': 26.00,
  'FL': 27.00,
  'OK': 25.00,
  'AR': 24.00,
  'NM': 26.00,
=======
const { supabase, logAction } = require('../lib/supabase');

// Minimum Davis-Bacon hourly rates by state (construction)
const MINIMUM_RATES = {
  'LA': 27.00, 'TX': 28.00, 'MS': 24.00, 'AL': 25.00,
  'TN': 26.00, 'FL': 27.00, 'OK': 25.00, 'AR': 24.00, 'NM': 26.00,
>>>>>>> prime-system/main
};

// ----------------------------------------------------------
// MAIN: Run weekly certified payroll generation
// ----------------------------------------------------------
async function runCertifiedPayroll() {
<<<<<<< HEAD
  // T.E.S.T. integration: check if agent is enabled before running
  if (!(await isAgentEnabled('EXEC'))) return;

  console.log('EXEC PAYROLL: Starting weekly WH-347 generation...');

  try {
    // Get the week ending date (this past Friday)
    const weekEnding = getLastFriday();
    console.log('EXEC PAYROLL: Week ending ' + weekEnding);

    // Get all active contracts with Davis-Bacon requirements
=======
  console.log('EXEC PAYROLL: Starting weekly WH-347 generation...');

  try {
    const weekEnding = getLastFriday();
    console.log('EXEC PAYROLL: Week ending ' + weekEnding);

>>>>>>> prime-system/main
    const contracts = await getDavisBaconContracts();
    console.log('EXEC PAYROLL: Found ' + contracts.length + ' Davis-Bacon contracts.');

    if (contracts.length === 0) {
      console.log('EXEC PAYROLL: No active Davis-Bacon contracts.');
      await logAction('EXEC', 'Certified payroll — no active contracts', { week_ending: weekEnding });
      return;
    }

    let formsGenerated = 0;
    for (const contract of contracts) {
      await generateWH347(contract, weekEnding);
      formsGenerated++;
    }

    await logAction('EXEC', 'WH-347 forms generated', {
      week_ending: weekEnding,
      forms_generated: formsGenerated,
      contracts: contracts.map(c => c.contract_number),
    });

    console.log('EXEC PAYROLL: ' + formsGenerated + ' WH-347 forms generated.');

  } catch (err) {
    console.error('EXEC PAYROLL ERROR:', err.message);
    await logAction('EXEC', 'Payroll generation failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// GENERATE WH-347: Create certified payroll record
<<<<<<< HEAD
// Full integration with QuickBooks payroll data goes here
=======
>>>>>>> prime-system/main
// ----------------------------------------------------------
async function generateWH347(contract, weekEnding) {
  console.log('EXEC PAYROLL: Generating WH-347 for ' + contract.contract_number + '...');

<<<<<<< HEAD
  // Check if a record already exists for this week
=======
>>>>>>> prime-system/main
  const { data: existing } = await supabase
    .from('certified_payroll')
    .select('id')
    .eq('contract_id', contract.id)
    .eq('week_ending', weekEnding)
    .single();

  if (existing) {
    console.log('EXEC PAYROLL: WH-347 already exists for this week — skipping.');
    return;
  }

<<<<<<< HEAD
  // Create the certified payroll record
  // In production: pull actual worker hours from QuickBooks
  // For now: create the record with placeholder data that
  // Mr. Kemp fills in before submission
=======
>>>>>>> prime-system/main
  const { error } = await supabase
    .from('certified_payroll')
    .insert({
      contract_id: contract.id,
      week_ending: weekEnding,
<<<<<<< HEAD
      workers: [],  // Populated from QuickBooks when integrated
=======
      workers: [],
>>>>>>> prime-system/main
      wage_determination_id: contract.wage_determination_id || 'PENDING',
      total_hours: 0,
      total_gross_pay: 0,
      form_url: null,
      submitted: false,
    });

  if (error) {
    console.error('EXEC PAYROLL: Failed to create record for ' + contract.contract_number, error.message);
    return;
  }

  await logAction('EXEC', 'WH-347 record created — needs worker data', {
    contract_number: contract.contract_number,
    week_ending: weekEnding,
    action_required: 'Fill in worker hours and submit to DOL',
  });
}

// ----------------------------------------------------------
// HELPERS
// ----------------------------------------------------------
<<<<<<< HEAD

// Get all active contracts that require Davis-Bacon payroll
async function getDavisBaconContracts() {
  // Davis-Bacon applies to all federal construction contracts over $2,000
  // We track this in the compliance table — for now get all active contracts
=======
async function getDavisBaconContracts() {
>>>>>>> prime-system/main
  const { data, error } = await supabase
    .from('active_contracts')
    .select('*')
    .eq('status', 'active');

  if (error) throw new Error('Could not load contracts: ' + error.message);
  return data || [];
}

<<<<<<< HEAD
// Get the date of last Friday (week ending date for WH-347)
function getLastFriday() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 5=Fri
=======
function getLastFriday() {
  const today = new Date();
  const dayOfWeek = today.getDay();
>>>>>>> prime-system/main
  const daysBack = dayOfWeek === 5 ? 0 : (dayOfWeek + 2) % 7;
  const friday = new Date(today);
  friday.setDate(today.getDate() - daysBack);
  return friday.toISOString().split('T')[0];
}

// Run when file is executed
runCertifiedPayroll();
