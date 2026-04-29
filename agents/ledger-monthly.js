// =============================================================
// LEDGER-MONTHLY.JS — Monthly Performance Report
// JOB: Generate monthly system report: win rates, scoring
//      accuracy, cost variance trends, concentration risk.
<<<<<<< HEAD
//      Sends summary via Brandi's email.
=======
>>>>>>> prime-system/main
// SCHEDULE: 1st of each month at 6 AM UTC (ledger-monthly-report.yml)
// COST: ~$0.50/month (Haiku for report narrative)
// =============================================================

<<<<<<< HEAD
const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// Concentration risk threshold — flag if one agency > 40% of revenue
=======
const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

>>>>>>> prime-system/main
const CONCENTRATION_THRESHOLD = 40;

// ----------------------------------------------------------
// MAIN: Run monthly performance report
// ----------------------------------------------------------
async function runMonthlyReport() {
<<<<<<< HEAD
  // T.E.S.T. integration: check if agent is enabled before running
  if (!(await isAgentEnabled('LEDGER'))) return;

=======
>>>>>>> prime-system/main
  console.log('LEDGER MONTHLY: Generating monthly performance report...');

  const reportMonth = getLastMonthLabel();
  console.log('LEDGER MONTHLY: Report period: ' + reportMonth);

  try {
<<<<<<< HEAD
    // Gather all data sections
=======
>>>>>>> prime-system/main
    const winRate = await calcWinRate();
    const scoringAccuracy = await calcScoringAccuracy();
    const costVariances = await summarizeCostVariances();
    const concentrationRisk = await checkConcentrationRisk();
    const systemHealth = await getSystemHealth();

<<<<<<< HEAD
    // Generate narrative summary using Claude Haiku
=======
>>>>>>> prime-system/main
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
      }) +
      '. Paragraphs: (1) Bid pipeline summary and win rate, (2) System accuracy and scoring calibration, ' +
      '(3) Cost performance on active contracts, (4) Recommendations for next month. Be specific. Use numbers.'
    );

<<<<<<< HEAD
    // Save the report
=======
>>>>>>> prime-system/main
    await logAction('LEDGER', 'Monthly report generated', {
      report_month: reportMonth,
      win_rate: winRate,
      bids_evaluated: winRate.total_bids,
      concentration_risk: concentrationRisk,
      narrative_preview: narrative.substring(0, 200),
    });

    console.log('LEDGER MONTHLY: Report complete for ' + reportMonth);
<<<<<<< HEAD
    console.log('LEDGER MONTHLY: Win rate: ' + winRate.pct + '% (' +
      winRate.won + '/' + winRate.total_bids + ')');
=======
>>>>>>> prime-system/main

  } catch (err) {
    console.error('LEDGER MONTHLY ERROR:', err.message);
    await logAction('LEDGER', 'Monthly report failed', { error: err.message });
    process.exit(1);
  }
}

<<<<<<< HEAD
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

=======
async function calcWinRate() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: bids } = await supabase
    .from('bids').select('result').not('result', 'is', null)
    .gte('created_at', thirtyDaysAgo.toISOString());
>>>>>>> prime-system/main
  const allBids = bids || [];
  const won = allBids.filter(b => b.result === 'won').length;
  const lost = allBids.filter(b => b.result === 'lost').length;
  const pct = allBids.length > 0 ? Math.round((won / allBids.length) * 100) : 0;
<<<<<<< HEAD

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
=======
  return { won, lost, total_bids: allBids.length, pct };
}

async function calcScoringAccuracy() {
  const { data: bids } = await supabase
    .from('bids').select('result, opportunities(prime_score)').not('result', 'is', null);
  if (!bids || bids.length === 0) return { accuracy: 'insufficient_data', sample_size: 0 };
  const highScoreBids = bids.filter(b => (b.opportunities?.prime_score || 0) >= 70);
  const highScoreWins = highScoreBids.filter(b => b.result === 'won').length;
  const accuracy = highScoreBids.length > 0
    ? Math.round((highScoreWins / highScoreBids.length) * 100) : null;
  return { accuracy_pct: accuracy, high_score_bids: highScoreBids.length,
    high_score_wins: highScoreWins, sample_size: bids.length };
}

async function summarizeCostVariances() {
  const { data: costs } = await supabase
    .from('job_costs').select('variance_pct, category').not('variance_pct', 'is', null);
  if (!costs || costs.length === 0) return { avg_variance: 0, over_budget_count: 0 };
  const overBudget = costs.filter(c => c.variance_pct > 10);
  const avgVariance = costs.reduce((sum, c) => sum + Math.abs(c.variance_pct), 0) / costs.length;
  return { avg_variance_pct: Math.round(avgVariance * 10) / 10,
    over_budget_count: overBudget.length, total_line_items: costs.length };
}

async function checkConcentrationRisk() {
  const { data: contracts } = await supabase
    .from('active_contracts').select('agency, value').eq('status', 'active');
  if (!contracts || contracts.length === 0) return { risk: 'no_active_contracts' };
  const total = contracts.reduce((sum, c) => sum + (c.value || 0), 0);
  const byAgency = {};
  for (const c of contracts) byAgency[c.agency] = (byAgency[c.agency] || 0) + (c.value || 0);
  const risks = [];
  for (const [agency, value] of Object.entries(byAgency)) {
    const pct = Math.round((value / total) * 100);
    if (pct >= CONCENTRATION_THRESHOLD) risks.push({ agency, pct, value });
  }
  return { risks, total_active_value: total };
}

async function getSystemHealth() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: logs } = await supabase
    .from('audit_log').select('agent, action').gte('created_at', thirtyDaysAgo.toISOString());
  const agentCounts = {};
  for (const log of (logs || [])) agentCounts[log.agent] = (agentCounts[log.agent] || 0) + 1;
  return { agent_activity: agentCounts, total_actions: (logs || []).length };
}

>>>>>>> prime-system/main
function getLastMonthLabel() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Run when file is executed
runMonthlyReport();
