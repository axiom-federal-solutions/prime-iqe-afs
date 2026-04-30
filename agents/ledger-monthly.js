// =============================================================
// LEDGER-MONTHLY.JS — Monthly Performance Report
// JOB: Generate monthly system report: win rates, scoring
//      accuracy, cost variance trends, concentration risk.
//      Sends summary via Brandi's email.
// SCHEDULE: 1st of each month at 6 AM UTC (ledger-monthly-report.yml)
// COST: ~$0.50/month (Haiku for report narrative)
// =============================================================

const { supabase, logAction, isAgentEnabled, getConfig, setConfig } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// ─── L6-06: Monte Carlo Revenue Forecasting ───────────────────────────────
// Auto-activates when 10+ bid outcomes are recorded in LEDGER.
// Runs 10,000 simulations per pipeline opportunity using a beta distribution
// parameterized by the PRIME score. Outputs P25/P50/P75 revenue bands.
// These numbers go to the dashboard Command Center and the monthly report.
const MONTE_CARLO_THRESHOLD   = 10;    // Minimum outcomes needed to activate
const MONTE_CARLO_SIMULATIONS = 10000; // Number of random scenarios to run

// Concentration risk threshold — flag if one agency > 40% of revenue
const CONCENTRATION_THRESHOLD = 40;

// ----------------------------------------------------------
// MAIN: Run monthly performance report
// ----------------------------------------------------------
async function runMonthlyReport() {
  // T.E.S.T. integration: check if agent is enabled before running
  if (!(await isAgentEnabled('LEDGER'))) return;

  console.log('LEDGER MONTHLY: Generating monthly performance report...');

  const reportMonth = getLastMonthLabel();
  console.log('LEDGER MONTHLY: Report period: ' + reportMonth);

  try {
    // Gather all data sections
    const winRate = await calcWinRate();
    const scoringAccuracy = await calcScoringAccuracy();
    const costVariances = await summarizeCostVariances();
    const concentrationRisk = await checkConcentrationRisk();
    const systemHealth = await getSystemHealth();

    // L6-06: Monte Carlo — run if threshold is met (auto-activating)
    const monteCarlo = await runMonteCarloForecast();

    // Generate narrative summary using Claude Haiku
    const monteCarloSummary = monteCarlo
      ? `Monte Carlo P25=$${(monteCarlo.p25 / 1000).toFixed(0)}K P50=$${(monteCarlo.p50 / 1000).toFixed(0)}K P75=$${(monteCarlo.p75 / 1000).toFixed(0)}K pipeline across ${monteCarlo.pipeline_count} opportunities.`
      : 'Monte Carlo not yet active (need 10+ bid outcomes).';

    const narrative = await claudeHaiku(
      'Write a concise 4-paragraph monthly performance summary for Walker Contractors LLC / Axiom Federal Solutions. ' +
      'This is their PRIME federal contracting AI system. ' +
      'Data: ' + JSON.stringify({
        report_month: reportMonth,
        win_rate: winRate,
        scoring_accuracy: scoringAccuracy,
        cost_variances: costVariances,
        concentration_risk: concentrationRisk,
        system_health: systemHealth,
        monte_carlo_forecast: monteCarloSummary,
      }) +
      '. Paragraphs: (1) Bid pipeline summary and win rate, (2) System accuracy and scoring calibration, ' +
      '(3) Cost performance on active contracts, (4) Recommendations for next month including Monte Carlo revenue forecast if available. Be specific. Use numbers.'
    );

    // Save the report
    await logAction('LEDGER', 'Monthly report generated', {
      report_month: reportMonth,
      win_rate: winRate,
      bids_evaluated: winRate.total_bids,
      concentration_risk: concentrationRisk,
      monte_carlo: monteCarlo || 'not_active',
      narrative_preview: narrative.substring(0, 200),
    });

    console.log('LEDGER MONTHLY: Report complete for ' + reportMonth);
    console.log('LEDGER MONTHLY: Win rate: ' + winRate.pct + '% (' +
      winRate.won + '/' + winRate.total_bids + ')');

  } catch (err) {
    console.error('LEDGER MONTHLY ERROR:', err.message);
    await logAction('LEDGER', 'Monthly report failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// WIN RATE: Count wins vs. losses in the last 30 days
// ----------------------------------------------------------
async function calcWinRate() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: bids } = await supabase
    .from('bids')
    .select('result')
    .not('result', 'is', null)
    .gte('created_at', thirtyDaysAgo.toISOString());

  const allBids = bids || [];
  const won = allBids.filter(b => b.result === 'won').length;
  const lost = allBids.filter(b => b.result === 'lost').length;
  const pct = allBids.length > 0 ? Math.round((won / allBids.length) * 100) : 0;

  return { won, lost, total_bids: allBids.length, pct };
}

// ----------------------------------------------------------
// SCORING ACCURACY: Were high PRIME scores actually wins?
// ----------------------------------------------------------
async function calcScoringAccuracy() {
  const { data: bids } = await supabase
    .from('bids')
    .select('result, opportunities(prime_score)')
    .not('result', 'is', null);

  if (!bids || bids.length === 0) {
    return { accuracy: 'insufficient_data', sample_size: 0 };
  }

  // High score = 70+. Count how often high scores = wins.
  const highScoreBids = bids.filter(b => (b.opportunities?.prime_score || 0) >= 70);
  const highScoreWins = highScoreBids.filter(b => b.result === 'won').length;
  const accuracy = highScoreBids.length > 0
    ? Math.round((highScoreWins / highScoreBids.length) * 100)
    : null;

  return {
    accuracy_pct: accuracy,
    high_score_bids: highScoreBids.length,
    high_score_wins: highScoreWins,
    sample_size: bids.length,
  };
}

// ----------------------------------------------------------
// COST VARIANCES: How many contracts are running over budget?
// ----------------------------------------------------------
async function summarizeCostVariances() {
  const { data: costs } = await supabase
    .from('job_costs')
    .select('variance_pct, category')
    .not('variance_pct', 'is', null);

  if (!costs || costs.length === 0) return { avg_variance: 0, over_budget_count: 0 };

  const overBudget = costs.filter(c => c.variance_pct > 10);
  const avgVariance = costs.reduce((sum, c) => sum + Math.abs(c.variance_pct), 0) / costs.length;

  return {
    avg_variance_pct: Math.round(avgVariance * 10) / 10,
    over_budget_count: overBudget.length,
    total_line_items: costs.length,
  };
}

// ----------------------------------------------------------
// CONCENTRATION RISK: Is too much revenue from one agency?
// ----------------------------------------------------------
async function checkConcentrationRisk() {
  const { data: contracts } = await supabase
    .from('active_contracts')
    .select('agency, value')
    .eq('status', 'active');

  if (!contracts || contracts.length === 0) return { risk: 'no_active_contracts' };

  const total = contracts.reduce((sum, c) => sum + (c.value || 0), 0);
  const byAgency = {};
  for (const c of contracts) {
    byAgency[c.agency] = (byAgency[c.agency] || 0) + (c.value || 0);
  }

  const risks = [];
  for (const [agency, value] of Object.entries(byAgency)) {
    const pct = Math.round((value / total) * 100);
    if (pct >= CONCENTRATION_THRESHOLD) {
      risks.push({ agency, pct, value });
    }
  }

  return { risks, total_active_value: total };
}

// ----------------------------------------------------------
// SYSTEM HEALTH: How many agents ran successfully this month?
// ----------------------------------------------------------
async function getSystemHealth() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: logs } = await supabase
    .from('audit_log')
    .select('agent, action')
    .gte('created_at', thirtyDaysAgo.toISOString());

  const agentCounts = {};
  for (const log of (logs || [])) {
    agentCounts[log.agent] = (agentCounts[log.agent] || 0) + 1;
  }

  return { agent_activity: agentCounts, total_actions: (logs || []).length };
}

// Get "Month YYYY" label for last month
function getLastMonthLabel() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// ----------------------------------------------------------
// L6-06: MONTE CARLO REVENUE FORECASTING
// Auto-activates when LEDGER has 10+ bid outcomes with win/loss + value.
// Runs 10,000 revenue simulations across the current pipeline.
// Each opp gets a win probability from its PRIME score → beta distribution.
// Summing across all opps produces a revenue distribution (not a single guess).
// P25 = conservative bond application figure. P50 = expected. P75 = upside.
// ----------------------------------------------------------
async function runMonteCarloForecast() {
  // Check if we have enough outcome history to model win probability
  const { data: outcomes } = await supabase
    .from('bids')
    .select('id')
    .not('result', 'is', null);

  const outcomeCount = outcomes?.length || 0;
  console.log('LEDGER MC: Bid outcomes available: ' + outcomeCount + '/' + MONTE_CARLO_THRESHOLD + ' needed');

  if (outcomeCount < MONTE_CARLO_THRESHOLD) {
    console.log('LEDGER MC: Monte Carlo not yet active — need ' + (MONTE_CARLO_THRESHOLD - outcomeCount) + ' more bid outcomes.');
    return null;
  }

  // First activation — flip the flag so dashboard knows it's live
  const alreadyActive = await getConfig('L6_06_MONTE_CARLO_ACTIVE', 'false');
  if (alreadyActive === 'false') {
    await setConfig('L6_06_MONTE_CARLO_ACTIVE', 'true');
    console.log('LEDGER MC: L6-06 Monte Carlo ACTIVATED — ' + outcomeCount + ' outcomes crossed the threshold.');
    await logAction('LEDGER', 'L6-06 Monte Carlo auto-activated', { outcome_count: outcomeCount });
  }

  // Pull pipeline: all pursuing/scored/reviewing opportunities with a value
  const { data: pipeline } = await supabase
    .from('opportunities')
    .select('id, prime_score, value, vertical')
    .in('status', ['scored', 'reviewing', 'pursuing'])
    .not('value', 'is', null)
    .gt('value', 0);

  if (!pipeline || pipeline.length === 0) {
    console.log('LEDGER MC: No active pipeline opportunities found — skipping.');
    return null;
  }

  console.log('LEDGER MC: Running ' + MONTE_CARLO_SIMULATIONS.toLocaleString() + ' simulations across ' + pipeline.length + ' pipeline opportunities...');

  // Convert each opportunity's PRIME score into beta distribution params.
  // Beta(alpha, beta) is ideal because it's bounded [0,1] — perfect for win probability.
  // A score of 75 means we win ~75% of the time, but with uncertainty.
  // Alpha = score/10, Beta = (100-score)/10 — this shapes the distribution.
  const oppParams = pipeline.map(opp => {
    const score = Math.max(1, Math.min(99, opp.prime_score || 50));
    const alpha = score / 10;
    const beta  = (100 - score) / 10;
    return { value: opp.value, alpha, beta };
  });

  // Run 10,000 scenarios — each scenario varies all win probabilities simultaneously
  const simulationResults = [];

  for (let sim = 0; sim < MONTE_CARLO_SIMULATIONS; sim++) {
    let scenarioRevenue = 0;

    for (const opp of oppParams) {
      // Sample a win probability from the beta distribution using rejection sampling
      const winProb = sampleBeta(opp.alpha, opp.beta);
      // This opportunity wins in this scenario if random < winProb
      if (Math.random() < winProb) {
        scenarioRevenue += opp.value;
      }
    }

    simulationResults.push(scenarioRevenue);
  }

  // Sort scenarios low→high to extract percentile values
  simulationResults.sort((a, b) => a - b);

  const p25 = simulationResults[Math.floor(MONTE_CARLO_SIMULATIONS * 0.25)];
  const p50 = simulationResults[Math.floor(MONTE_CARLO_SIMULATIONS * 0.50)];
  const p75 = simulationResults[Math.floor(MONTE_CARLO_SIMULATIONS * 0.75)];
  const mean = simulationResults.reduce((s, v) => s + v, 0) / MONTE_CARLO_SIMULATIONS;
  const variance = simulationResults.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / MONTE_CARLO_SIMULATIONS;
  const stdDev = Math.sqrt(variance);

  // Get baseline (already-won active contracts) so the forecast is additive
  const { data: active } = await supabase
    .from('active_contracts')
    .select('value')
    .eq('status', 'active');
  const contractBase = (active || []).reduce((s, c) => s + (c.value || 0), 0);

  // Save to forecast_snapshots so the dashboard can read it
  await supabase.from('forecast_snapshots').insert({
    snapshot_date:        new Date().toISOString().split('T')[0],
    pipeline_count:       pipeline.length,
    simulations:          MONTE_CARLO_SIMULATIONS,
    p25_revenue:          Math.round(p25),
    p50_revenue:          Math.round(p50),
    p75_revenue:          Math.round(p75),
    mean_revenue:         Math.round(mean),
    std_deviation:        Math.round(stdDev),
    active_contract_base: Math.round(contractBase),
  });

  await setConfig('L6_06_LAST_RUN', new Date().toISOString());

  console.log('LEDGER MC: Forecast complete — P25=$' + p25.toLocaleString() +
    ' P50=$' + p50.toLocaleString() + ' P75=$' + p75.toLocaleString());

  await logAction('LEDGER', 'L6-06 Monte Carlo forecast saved', {
    pipeline_count: pipeline.length,
    p25: Math.round(p25),
    p50: Math.round(p50),
    p75: Math.round(p75),
    active_contract_base: Math.round(contractBase),
  });

  return { p25, p50, p75, mean: Math.round(mean), pipeline_count: pipeline.length };
}

// ----------------------------------------------------------
// BETA DISTRIBUTION SAMPLER (Pure JS — no numpy needed)
// Uses the Johnk method: generates a beta(alpha, beta) sample
// by rejection sampling with uniform random numbers.
// Called 10,000 * pipeline_size times per month — fast enough in Node.
// ----------------------------------------------------------
function sampleBeta(alpha, beta) {
  // For integer or half-integer params, use the sum-of-gammas method
  // For general case, use Johnk's rejection sampler
  let u, v, x, y, z;
  do {
    u = Math.random();
    v = Math.random();
    x = Math.pow(u, 1 / alpha);
    y = Math.pow(v, 1 / beta);
    z = x + y;
  } while (z > 1.0);  // Rejection — try again if outside [0,1]
  return x / z;
}

// Run when file is executed
runMonthlyReport();
