// =============================================================
// EXEC-COSTS.JS — Monday Cost Sync
// JOB: Pull actual job costs, compare to bid estimates,
//      flag variances over 10% in Brandi's brief
// SCHEDULE: Monday 7 AM UTC (exec-cost-sync.yml)
// COST: ~$0 (no LLM — pure data comparison)
// =============================================================

<<<<<<< HEAD
const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');
=======
const { supabase, logAction } = require('../lib/supabase');
>>>>>>> prime-system/main

// Alert threshold — flag any cost variance over 10%
const VARIANCE_ALERT_PCT = 10;

// ----------------------------------------------------------
// MAIN: Run Monday cost sync
// ----------------------------------------------------------
async function runCostSync() {
<<<<<<< HEAD
  // T.E.S.T. integration: check if agent is enabled before running
  if (!(await isAgentEnabled('EXEC'))) return;

=======
>>>>>>> prime-system/main
  console.log('EXEC COSTS: Starting Monday cost sync...');

  try {
    const contracts = await getActiveContracts();

    if (contracts.length === 0) {
      console.log('EXEC COSTS: No active contracts to sync.');
      await logAction('EXEC', 'Cost sync — no active contracts', {});
      return;
    }

    console.log('EXEC COSTS: Found ' + contracts.length + ' active contracts.');

    let totalVariances = 0;
    for (const contract of contracts) {
      const variances = await syncContractCosts(contract);
      totalVariances += variances;
    }

    await logAction('EXEC', 'Monday cost sync complete', {
      contracts_synced: contracts.length,
      variances_flagged: totalVariances,
    });

    console.log('EXEC COSTS: Sync complete. ' + totalVariances + ' variances flagged.');

  } catch (err) {
    console.error('EXEC COSTS ERROR:', err.message);
    await logAction('EXEC', 'Cost sync failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// SYNC CONTRACT COSTS: Compare actuals vs. bid estimates
<<<<<<< HEAD
// QuickBooks integration placeholder — logs estimated costs
// until QuickBooks OAuth is configured
=======
>>>>>>> prime-system/main
// ----------------------------------------------------------
async function syncContractCosts(contract) {
  console.log('EXEC COSTS: Syncing ' + contract.contract_number + '...');

<<<<<<< HEAD
  // Pull existing job cost records for this contract
=======
>>>>>>> prime-system/main
  const { data: existingCosts } = await supabase
    .from('job_costs')
    .select('*')
    .eq('contract_id', contract.id);

<<<<<<< HEAD
  // NOTE: QuickBooks API integration goes here
  // Until configured, we check existing cost records for variances
  // and alert if any exceed the threshold
=======
>>>>>>> prime-system/main
  const costs = existingCosts || [];

  let varianceCount = 0;
  for (const cost of costs) {
    if (Math.abs(cost.variance_pct || 0) > VARIANCE_ALERT_PCT) {
      varianceCount++;
      await flagCostVariance(contract, cost);
    }
  }

  return varianceCount;
}

// ----------------------------------------------------------
// FLAG: Alert Brandi when a cost variance is too high
// ----------------------------------------------------------
async function flagCostVariance(contract, cost) {
  const direction = cost.variance_pct > 0 ? 'OVER budget' : 'UNDER budget';
  console.log('EXEC COSTS: VARIANCE — ' +
    contract.contract_number + ' ' +
    cost.category + ' is ' +
    Math.abs(cost.variance_pct) + '% ' + direction);

  await logAction('EXEC', 'Cost variance flagged', {
    contract_number: contract.contract_number,
    contract_id: contract.id,
    category: cost.category,
    budgeted: cost.budgeted,
    actual: cost.actual,
    variance_pct: cost.variance_pct,
    alert: direction,
    action: 'Review and adjust forecast in Brandi brief',
  });
}

// ----------------------------------------------------------
// HELPER: Get all active contracts
// ----------------------------------------------------------
async function getActiveContracts() {
  const { data, error } = await supabase
    .from('active_contracts')
    .select('*')
    .eq('status', 'active');

  if (error) throw new Error('Could not load active contracts: ' + error.message);
  return data || [];
}

// Run when file is executed
runCostSync();
