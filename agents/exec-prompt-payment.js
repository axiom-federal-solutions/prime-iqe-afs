// =============================================================
// EXEC-PROMPT-PAYMENT.JS — Prompt Payment Interest Claims
// JOB: Find late government payments and calculate interest
//      owed under the Prompt Payment Act (FAR 52.232-25)
// SCHEDULE: Daily 7 AM UTC (prompt-payment-check.yml)
// LAW: Government must pay within 14 days of proper invoice
//      Interest accrues daily using Treasury Department rate
// COST: ~$0 (no LLM — pure math)
// =============================================================

const { supabase, logAction } = require('../lib/supabase');

const PAYMENT_DEADLINE_DAYS = 14;
const TREASURY_RATE_FALLBACK = 0.0575; // 5.75% — update quarterly

// ----------------------------------------------------------
// MAIN: Run daily prompt payment check
// ----------------------------------------------------------
async function runPromptPaymentCheck() {
  console.log('EXEC PROMPT PAYMENT: Starting daily check...');

  try {
    const claims = await findLatePayments();

    if (claims.length === 0) {
      console.log('EXEC PROMPT PAYMENT: No late payments found. All good.');
      await logAction('EXEC', 'Prompt payment check — no late payments', {
        checked_date: new Date().toISOString().split('T')[0],
      });
      return;
    }

    console.log('EXEC PROMPT PAYMENT: Found ' + claims.length + ' late payment(s).');

    for (const claim of claims) {
      await processClaim(claim);
    }

    await logAction('EXEC', 'Prompt payment check complete', {
      late_payments_found: claims.length,
      total_interest_owed: claims.reduce((sum, c) => sum + (c.interest_owed || 0), 0),
    });

  } catch (err) {
    console.error('EXEC PROMPT PAYMENT ERROR:', err.message);
    await logAction('EXEC', 'Prompt payment check failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// FIND LATE PAYMENTS: Scan all open invoices past deadline
// ----------------------------------------------------------
async function findLatePayments() {
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: overdue, error } = await supabase
    .from('prompt_payment_claims')
    .select('*')
    .lt('payment_due', todayStr)
    .is('payment_received', null)
    .eq('claim_status', 'pending');

  if (error) throw new Error('Could not query invoices: ' + error.message);
  return overdue || [];
}

// ----------------------------------------------------------
// PROCESS CLAIM: Calculate interest and update record
// ----------------------------------------------------------
async function processClaim(claim) {
  const today = new Date();
  const dueDate = new Date(claim.payment_due);
  const daysLate = Math.floor((today - dueDate) / 86400000);

  if (daysLate <= 0) return;

  const invoiceAmount = claim.invoice_amount || 0;
  const treasuryRate = claim.treasury_rate || TREASURY_RATE_FALLBACK;
  const dailyRate = treasuryRate / 365;
  const interestOwed = invoiceAmount * dailyRate * daysLate;

  console.log('EXEC PROMPT PAYMENT: Invoice ' + claim.invoice_number +
    ' is ' + daysLate + ' days late. Interest owed: $' + interestOwed.toFixed(2));

  await supabase
    .from('prompt_payment_claims')
    .update({
      treasury_rate: treasuryRate,
      interest_owed: Math.round(interestOwed * 100) / 100,
    })
    .eq('id', claim.id);

  await logAction('EXEC', 'PROMPT PAYMENT INTEREST OWED', {
    invoice_number: claim.invoice_number,
    contract_id: claim.contract_id,
    days_late: daysLate,
    invoice_amount: invoiceAmount,
    interest_owed: interestOwed.toFixed(2),
    far_reference: 'FAR 52.232-25',
    action: 'Review and authorize interest claim letter',
  });
}

// Run when file is executed
runPromptPaymentCheck();
