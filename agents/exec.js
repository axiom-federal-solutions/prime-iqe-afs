// =============================================================
// EXEC.JS — Execution & Expenditure Control
// JOB: Track project costs, payments, certified payroll, retainage
// SCHEDULE: Daily checks + weekly Monday/Friday + triggered events
// COST: ~$2/month (API calls + minimal AI for forms)
// =============================================================

// Load helper tools
const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// Treasury interest rate for late payment calculations (FAR 52.232-25)
// Updated quarterly — check treasury.gov for current rate
const TREASURY_RATE = 0.055; // 5.5% annual (update quarterly)

// Number of days the government has to pay invoices before interest starts
const PAYMENT_TERMS_DAYS = 30;

// Days from government payment receipt to required sub payment (FAR 52.232-27)
const SUB_PAYMENT_DAYS = 7;

// ----------------------------------------------------------
// MAIN FUNCTION: Determine which tasks to run
// ----------------------------------------------------------
async function runExec() {
  const mode = process.argv[2] || 'daily';
  console.log('EXEC: Starting in ' + mode + ' mode at ' + new Date().toISOString());

  try {
    if (mode === 'daily' || mode === 'all') {
      await checkPromptPayment();     // Did the government pay us on time?
      await checkRetainage();         // Is the government holding money they should release?
      await checkSubPayments();       // Did we pay our subs within 7 days?
    }

    if (mode === 'weekly-monday' || mode === 'all') {
      await generateCertifiedPayroll();  // Create WH-347 forms
      await checkContractMods();         // Look for contract changes
    }

    if (mode === 'weekly-friday' || mode === 'all') {
      await projectCashFlow();           // 90-day cash flow projection
    }

    await logAction('EXEC', 'Run complete', { mode });
    console.log('EXEC: Done.');
  } catch (err) {
    console.error('EXEC ERROR:', err.message);
    await logAction('EXEC', 'Run failed', { mode, error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// PROMPT PAYMENT: Check if the government is paying us on time
// FAR 52.232-25: If they're late, we can charge interest
// ----------------------------------------------------------
async function checkPromptPayment() {
  console.log('EXEC: Checking prompt payment compliance...');

  // Get all invoices that haven't been paid yet
  const { data: claims } = await supabase
    .from('prompt_payment_claims')
    .select('*')
    .is('payment_received', null);

  if (!claims || claims.length === 0) return;

  const today = new Date();

  for (const claim of claims) {
    const dueDate  = new Date(claim.payment_due);
    const daysLate = Math.floor((today - dueDate) / 86400000);

    if (daysLate > 0) {
      // Calculate interest owed under FAR 52.232-25
      // Formula: Invoice Amount × Treasury Rate × (Days Late / 365)
      const invoiceAmount = claim.invoice_amount || 0;
      const interestOwed  = invoiceAmount * TREASURY_RATE * (daysLate / 365);

      await supabase
        .from('prompt_payment_claims')
        .update({
          days_late:     daysLate,
          treasury_rate: TREASURY_RATE,
          interest_owed: Math.round(interestOwed * 100) / 100,
          claim_status:  daysLate > 7 ? 'claim_pending' : 'monitoring',
        })
        .eq('id', claim.id);

      if (daysLate > 7) {
        console.log('EXEC: Invoice ' + claim.invoice_number + ' is ' + daysLate + ' days late — $' + interestOwed.toFixed(2) + ' interest');
        await logAction('EXEC', 'Late payment detected', {
          invoice:       claim.invoice_number,
          days_late:     daysLate,
          interest_owed: interestOwed.toFixed(2),
          far_clause:    'FAR 52.232-25',
        });
      }
    }
  }
}

// ----------------------------------------------------------
// RETAINAGE: Check if we can request release of held-back money
// Retainage is typically 10% the government holds until project complete
// ----------------------------------------------------------
async function checkRetainage() {
  console.log('EXEC: Checking retainage status...');

  const { data: trackers } = await supabase
    .from('retainage_tracker')
    .select('*')
    .eq('release_received', false);

  if (!trackers) return;

  for (const tracker of trackers) {
    // Request retainage release if we haven't already
    if (!tracker.release_requested && tracker.retainage_held > 0) {
      // Check if substantial completion has been reached (in a future version,
      // this checks the contract status automatically)
      console.log('EXEC: Retainage of $' + tracker.retainage_held + ' on contract ' + tracker.contract_id);

      await logAction('EXEC', 'Retainage pending release', {
        contract_id:    tracker.contract_id,
        amount_held:    tracker.retainage_held,
        release_needed: true,
        note:           'Manually trigger release request after substantial completion',
      });
    }

    // Track follow-up count for requests already sent
    if (tracker.release_requested && !tracker.release_received) {
      const daysSinceRequest = tracker.release_request_date
        ? Math.floor((Date.now() - new Date(tracker.release_request_date)) / 86400000)
        : 0;

      if (daysSinceRequest > 30) {
        await supabase
          .from('retainage_tracker')
          .update({ followup_count: (tracker.followup_count || 0) + 1 })
          .eq('id', tracker.id);

        await logAction('EXEC', 'Retainage follow-up needed', {
          contract_id:   tracker.contract_id,
          days_pending:  daysSinceRequest,
          followup_num:  (tracker.followup_count || 0) + 1,
        });
      }
    }
  }
}

// ----------------------------------------------------------
// SUB PAYMENTS: Make sure we paid our subcontractors within 7 days
// FAR 52.232-27: We must pay subs within 7 days of receiving payment
// ----------------------------------------------------------
async function checkSubPayments() {
  console.log('EXEC: Checking subcontractor payment compliance...');

  const { data: subs } = await supabase
    .from('sub_payments')
    .select('*')
    .eq('compliant', false);

  if (!subs || subs.length === 0) return;

  for (const sub of subs) {
    console.log('EXEC: NON-COMPLIANT — ' + sub.sub_name + ' paid ' + sub.days_to_pay + ' days after gov payment');
    await logAction('EXEC', 'Sub payment violation', {
      sub_name:     sub.sub_name,
      contract_id:  sub.contract_id,
      days_to_pay:  sub.days_to_pay,
      required:     SUB_PAYMENT_DAYS,
      far_clause:   'FAR 52.232-27',
    });
  }
}

// ----------------------------------------------------------
// CERTIFIED PAYROLL: Generate WH-347 weekly payroll forms
// Required on Davis-Bacon contracts — submitted weekly
// ----------------------------------------------------------
async function generateCertifiedPayroll() {
  console.log('EXEC: Generating certified payroll (WH-347)...');

  const { data: contracts } = await supabase
    .from('active_contracts')
    .select('*')
    .eq('status', 'active');

  if (!contracts) return;

  for (const contract of contracts) {
    // Create a payroll record for the current week
    const weekEnding = getMostRecentSunday();

    const { data: existing } = await supabase
      .from('certified_payroll')
      .select('id')
      .eq('contract_id', contract.id)
      .eq('week_ending', weekEnding)
      .single();

    if (!existing) {
      await supabase.from('certified_payroll').insert({
        contract_id:  contract.id,
        week_ending:  weekEnding,
        workers:      [], // Populated from QuickBooks in next chapter
        total_hours:  0,
        total_gross_pay: 0,
        submitted:    false,
      });

      console.log('EXEC: WH-347 created for contract ' + contract.contract_number + ' week of ' + weekEnding);
      await logAction('EXEC', 'WH-347 generated', {
        contract: contract.contract_number,
        week:     weekEnding,
      });
    }
  }
}

// ----------------------------------------------------------
// CONTRACT MODIFICATIONS: Check for changes to active contracts
// A "mod" can change the price, scope, or end date
// ----------------------------------------------------------
async function checkContractMods() {
  console.log('EXEC: Checking for contract modifications...');
  // Full implementation fetches from the agency's EDA/ePLS system
  // For now, log a reminder to check manually
  await logAction('EXEC', 'Mod check — manual review reminder', {
    note: 'Check ePLS.fas.gsa.gov for any modifications to active contracts',
    timestamp: new Date().toISOString(),
  });
}

// ----------------------------------------------------------
// CASH FLOW PROJECTION: 90-day forward-looking cash flow
// ----------------------------------------------------------
async function projectCashFlow() {
  console.log('EXEC: Projecting 90-day cash flow...');

  const { data: contracts } = await supabase
    .from('active_contracts')
    .select('*')
    .eq('status', 'active');

  if (!contracts) return;

  const totalActiveValue   = contracts.reduce((s, c) => s + (c.value || 0), 0);
  const totalInvoiced      = contracts.reduce((s, c) => s + (c.total_invoiced || 0), 0);
  const totalPaid          = contracts.reduce((s, c) => s + (c.total_paid || 0), 0);
  const retainageHeld      = contracts.reduce((s, c) => s + (c.retainage_held || 0), 0);
  const remainingToInvoice = totalActiveValue - totalInvoiced;

  await logAction('EXEC', '90-day cash flow projection', {
    active_contract_value:  totalActiveValue,
    total_invoiced:         totalInvoiced,
    total_paid:             totalPaid,
    retainage_held:         retainageHeld,
    remaining_to_invoice:   remainingToInvoice,
    outstanding:            totalInvoiced - totalPaid,
  });

  console.log('EXEC: Active: $' + totalActiveValue.toLocaleString() +
    ' | Invoiced: $' + totalInvoiced.toLocaleString() +
    ' | Paid: $' + totalPaid.toLocaleString() +
    ' | Retainage: $' + retainageHeld.toLocaleString());
}

// ----------------------------------------------------------
// HELPER: Get most recent Sunday (for weekly payroll cutoffs)
// ----------------------------------------------------------
function getMostRecentSunday() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

// ----------------------------------------------------------
// START: Run EXEC when this file is executed
// ----------------------------------------------------------
runExec();
