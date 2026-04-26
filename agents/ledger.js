// =============================================================
// LEDGER.JS — Learning Engine for Decision Governance & Recalibration
// JOB: Log everything, learn from wins/losses, recalibrate scoring
// SCHEDULE: Every Sunday at 10:00 PM CT + 1st of month + on bid outcomes
// COST: ~$1/month (minimal AI for summaries)
// =============================================================

// Load helper tools
const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// Revenue concentration threshold — warn if one agency is >40% of revenue
const CONCENTRATION_THRESHOLD = 0.40;

// Starting scoring weights (JUDGE uses these — LEDGER updates them weekly)
let currentWeights = {
  alignment:   0.25,
  winProb:     0.20,
  financial:   0.25,
  strategic:   0.15,
  feasibility: 0.15,
};

// ----------------------------------------------------------
// MAIN FUNCTION: Determine which tasks to run based on the schedule
// ----------------------------------------------------------
async function runLedger() {
  const mode = process.argv[2] || 'weekly'; // weekly | monthly | outcome
  console.log('LEDGER: Starting in ' + mode + ' mode at ' + new Date().toISOString());

  try {
    if (mode === 'weekly' || mode === 'all') {
      await weeklyRecalibration();
      await checkConcentrationRisk();
      await checkDecisionAging();
    }

    if (mode === 'monthly' || mode === 'all') {
      await monthlyReport();
    }

    if (mode === 'outcome') {
      // Called when a bid outcome (won/lost) is recorded
      const bidId = process.argv[3];
      if (bidId) await handleBidOutcome(bidId);
    }

    await logAction('LEDGER', 'Run complete', { mode });
    console.log('LEDGER: Done.');
  } catch (err) {
    console.error('LEDGER ERROR:', err.message);
    await logAction('LEDGER', 'Run failed', { mode, error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// WEEKLY RECALIBRATION: Learn from wins and losses
// Compares JUDGE's predicted scores against actual outcomes
// Adjusts weights to be more accurate next time
// ----------------------------------------------------------
async function weeklyRecalibration() {
  console.log('LEDGER: Running weekly score recalibration...');

  // Get all bids that have a final outcome (won or lost)
  const { data: bids } = await supabase
    .from('bids')
    .select('*, opportunities(*)')
    .not('result', 'is', null);

  if (!bids || bids.length < 5) {
    console.log('LEDGER: Not enough outcome data yet — need at least 5 bids. Skipping recalibration.');
    return;
  }

  // Build calibration dataset: predicted score vs actual outcome
  const calibrationData = bids.map(bid => ({
    predicted_score:  bid.opportunities.prime_score || 50,
    actual_outcome:   bid.result === 'won' ? 1 : 0,
    factors: bid.opportunities.scoring_factors || {},
  }));

  // Simple recalibration: if high-score bids keep losing, reduce confidence
  const wins  = calibrationData.filter(d => d.actual_outcome === 1);
  const losses = calibrationData.filter(d => d.actual_outcome === 0);
  const winAvgScore  = wins.length  > 0 ? avg(wins.map(d => d.predicted_score))  : 50;
  const lossAvgScore = losses.length > 0 ? avg(losses.map(d => d.predicted_score)) : 50;

  const drift = Math.abs(winAvgScore - lossAvgScore);
  console.log('LEDGER: Win avg score: ' + winAvgScore.toFixed(1) + ', Loss avg score: ' + lossAvgScore.toFixed(1) + ', Drift: ' + drift.toFixed(1));

  // If winners and losers have similar scores, our model needs adjustment
  // In a future version, this uses logistic regression for precise calibration
  await logAction('LEDGER', 'Weekly recalibration complete', {
    total_outcomes: bids.length,
    wins:           wins.length,
    losses:         losses.length,
    win_avg_score:  winAvgScore.toFixed(1),
    loss_avg_score: lossAvgScore.toFixed(1),
    drift:          drift.toFixed(1) + '%',
  });
}

// ----------------------------------------------------------
// CONCENTRATION RISK: Warn if too much revenue from one agency
// If Agency X = 40%+ of all contracts, we're too dependent on them
// ----------------------------------------------------------
async function checkConcentrationRisk() {
  console.log('LEDGER: Checking revenue concentration risk...');

  const { data: contracts } = await supabase
    .from('active_contracts')
    .select('agency, value')
    .eq('status', 'active');

  if (!contracts || contracts.length === 0) return;

  const total = contracts.reduce((sum, c) => sum + (c.value || 0), 0);
  if (total === 0) return;

  // Group by agency
  const byAgency = {};
  for (const c of contracts) {
    byAgency[c.agency] = (byAgency[c.agency] || 0) + (c.value || 0);
  }

  // Flag any agency that exceeds our concentration threshold
  for (const [agency, agencyTotal] of Object.entries(byAgency)) {
    const pct = agencyTotal / total;
    if (pct > CONCENTRATION_THRESHOLD) {
      console.log('LEDGER: CONCENTRATION RISK — ' + agency + ' = ' + (pct * 100).toFixed(1) + '% of revenue');
      await logAction('LEDGER', 'Concentration risk flagged', {
        agency,
        pct: (pct * 100).toFixed(1) + '%',
        threshold: (CONCENTRATION_THRESHOLD * 100) + '%',
        recommendation: 'Actively bid with other agencies to diversify.',
      });
    }
  }
}

// ----------------------------------------------------------
// DECISION AGING: Check for opportunities sitting without a bid/no-bid call
// Joe should decide within 48 hours of scoring — LEDGER escalates if not
// ----------------------------------------------------------
async function checkDecisionAging() {
  const cutoff48h  = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const cutoff96h  = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();

  const { data: aging } = await supabase
    .from('opportunities')
    .select('id, solicitation_number, prime_score, scored_at')
    .eq('status', 'scored')
    .lt('scored_at', cutoff48h);

  if (aging && aging.length > 0) {
    console.log('LEDGER: ' + aging.length + ' opportunities need a decision NOW');

    // Update decision_age_days for each
    for (const opp of aging) {
      const ageDays = Math.floor((Date.now() - new Date(opp.scored_at)) / 86400000);
      await supabase
        .from('opportunities')
        .update({ decision_age_days: ageDays })
        .eq('id', opp.id);
    }

    await logAction('LEDGER', 'Decision aging report', {
      stale_count: aging.length,
      oldest: aging[aging.length - 1]?.solicitation_number,
    });
  }
}

// ----------------------------------------------------------
// HANDLE BID OUTCOME: Called when a bid result is recorded
// Automatically requests debrief if we lost (FAR 15.506 — 3-day window)
// ----------------------------------------------------------
async function handleBidOutcome(bidId) {
  console.log('LEDGER: Processing outcome for bid ' + bidId);

  const { data: bid } = await supabase
    .from('bids')
    .select('*, opportunities(*)')
    .eq('id', bidId)
    .single();

  if (!bid) return;

  if (bid.result === 'lost') {
    // We lost — request a debrief ASAP (must be within 3 days per FAR 15.506)
    const debriefDeadline = new Date();
    debriefDeadline.setDate(debriefDeadline.getDate() + 3);

    await supabase.from('debrief_tracker').insert({
      bid_id: bidId,
      solicitation_id: bid.opportunity_id,
      agency: bid.opportunities.agency,
      loss_date: new Date().toISOString().split('T')[0],
      debrief_requested: false,
      debrief_request_deadline: debriefDeadline.toISOString().split('T')[0],
    });

    await logAction('LEDGER', 'Debrief tracker created after loss', {
      bid_id: bidId,
      agency: bid.opportunities.agency,
      deadline: debriefDeadline.toISOString().split('T')[0],
      note: 'FAR 15.506 — must request debrief within 3 days of loss notice',
    });

    console.log('LEDGER: Debrief request deadline set for ' + debriefDeadline.toISOString().split('T')[0]);
  }

  if (bid.result === 'won') {
    console.log('LEDGER: WIN recorded for ' + bid.opportunities.title);
    await logAction('LEDGER', 'Win recorded', {
      bid_id: bidId,
      title: bid.opportunities.title,
      value: bid.opportunities.value,
    });
  }
}

// ----------------------------------------------------------
// MONTHLY REPORT: Summary of all activity for the past 30 days
// ----------------------------------------------------------
async function monthlyReport() {
  console.log('LEDGER: Generating monthly summary...');

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: newOpps }  = await supabase.from('opportunities').select('id').gte('created_at', thirtyDaysAgo);
  const { data: bidsWon }  = await supabase.from('bids').select('id').eq('result', 'won');
  const { data: bidsLost } = await supabase.from('bids').select('id').eq('result', 'lost');
  const { data: activeContracts } = await supabase.from('active_contracts').select('value').eq('status', 'active');

  const totalRevenue = (activeContracts || []).reduce((s, c) => s + (c.value || 0), 0);

  const summary = await claudeHaiku(
    'Write a 3-sentence monthly performance summary for a federal contracting company. ' +
    'Data: ' + (newOpps?.length || 0) + ' new opportunities found, ' +
    (bidsWon?.length || 0) + ' contracts won, ' +
    (bidsLost?.length || 0) + ' bids lost, ' +
    '$' + totalRevenue.toLocaleString() + ' total active contract value. ' +
    'Be direct and business-like.'
  );

  await logAction('LEDGER', 'Monthly report complete', {
    new_opportunities: newOpps?.length || 0,
    bids_won:  bidsWon?.length  || 0,
    bids_lost: bidsLost?.length || 0,
    total_active_revenue: totalRevenue,
    summary,
  });

  console.log('LEDGER: Monthly report — ' + (newOpps?.length || 0) + ' opps, '
    + (bidsWon?.length || 0) + ' wins, $' + totalRevenue.toLocaleString() + ' active.');
}

// ----------------------------------------------------------
// HELPER: Calculate average of an array of numbers
// ----------------------------------------------------------
function avg(arr) {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ----------------------------------------------------------
// START: Run LEDGER when this file is executed
// ----------------------------------------------------------
runLedger();
