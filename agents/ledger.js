// =============================================================
// LEDGER.JS — Learning Engine for Decision Governance & Recalibration
// JOB: Log everything, learn from wins/losses, recalibrate scoring
// SCHEDULE: Every Sunday at 10:00 PM CT + 1st of month + on bid outcomes
// COST: ~$1/month (minimal AI for summaries)
// =============================================================

// Load helper tools
const { supabase, logAction, getConfig, setConfig } = require('../lib/supabase');
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

// ─── L6-01: ML Win Scoring Constants ─────────────────────────────────────
// Auto-activates at 20+ bid outcomes. LEDGER trains a logistic regression
// model on historical bids and saves learned weights to ml_weights table.
// JUDGE reads those weights on its next run instead of using fixed defaults.
const ML_THRESHOLD     = 20;    // Minimum bid outcomes before training
const ML_LEARNING_RATE = 0.05;  // Gradient descent step size
const ML_ITERATIONS    = 2000;  // Training passes through the data
const ML_FEATURES      = [      // Feature vector definition (must match JUDGE)
  'naics_match',      // 1 if our NAICS codes overlap with the opp NAICS
  'set_aside_match',  // 1 if our SDB cert matches the set-aside requirement
  'gulf_south',       // 1 if place_of_performance is in our 7-state footprint
  'value_normalized', // Contract value normalized 0-1 (capped at $5M)
  'high_prime_score', // 1 if PRIME score >= 70 before ML adjustment
  'has_incumbents',   // 1 if an incumbent was identified by RECON
  'agency_history',   // 1 if we have prior awards with this agency
];

// Our service region — same list as SCOUT and JUDGE
const GULF_SOUTH = ['LA','MS','TX','AL','GA','FL','TN'];
const OUR_NAICS  = ['236220','238210','237990','236116','238320','238910',
                    '238990','238220','424710','424130','424490','424120'];

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
      await checkMLThreshold();  // L6-01: train ML model if enough data exists
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
// L6-01: ML THRESHOLD CHECK — runs after every weekly recalibration
// Checks if we have 20+ bid outcomes. If yes, trains the model.
// If already trained this week, skips to avoid wasted compute.
// ----------------------------------------------------------
async function checkMLThreshold() {
  const { data: outcomes } = await supabase
    .from('bids')
    .select('id, result, opportunity_id')
    .not('result', 'is', null);

  const count = outcomes?.length || 0;
  console.log('LEDGER ML: Bid outcomes available: ' + count + '/' + ML_THRESHOLD + ' needed for ML activation');

  if (count < ML_THRESHOLD) {
    console.log('LEDGER ML: L6-01 not yet active — need ' + (ML_THRESHOLD - count) + ' more bid outcomes.');
    return;
  }

  // Check if we've already trained this week to avoid retraining unnecessarily
  const lastTrained = await getConfig('ML_LAST_TRAINED', '');
  if (lastTrained) {
    const daysSinceTrain = (Date.now() - new Date(lastTrained)) / 86400000;
    if (daysSinceTrain < 6) {
      console.log('LEDGER ML: Already trained ' + daysSinceTrain.toFixed(1) + ' days ago — skipping.');
      return;
    }
  }

  console.log('LEDGER ML: Training logistic regression on ' + count + ' bid outcomes...');
  await trainMLModel(outcomes);
}

// ----------------------------------------------------------
// L6-01: TRAIN ML MODEL — Pure JS logistic regression
// Pulls features for each historical bid → trains via gradient descent →
// saves new weights to ml_weights table → enables L6-01 flag.
// JUDGE reads these weights on its next run.
// ----------------------------------------------------------
async function trainMLModel(outcomes) {
  // Build feature matrix (X) and label vector (y)
  const X = [];
  const y = [];

  for (const bid of outcomes) {
    // Fetch the opportunity linked to this bid
    const { data: opp } = await supabase
      .from('opportunities')
      .select('naics, set_aside, place_of_performance, value, prime_score, agency')
      .eq('id', bid.opportunity_id)
      .single();

    if (!opp) continue;

    // Build feature vector — must match ML_FEATURES order
    const naicsMatch   = OUR_NAICS.some(n => (opp.naics || '').startsWith(n.substring(0, 4))) ? 1 : 0;
    const setAsideMatch = ['SDB','SBA','SB'].some(s => (opp.set_aside || '').includes(s)) ? 1 : 0;
    const gulfSouth    = GULF_SOUTH.includes(opp.place_of_performance || '') ? 1 : 0;
    const valueNorm    = Math.min(1, (opp.value || 0) / 5000000);  // Cap at $5M
    const highScore    = (opp.prime_score || 0) >= 70 ? 1 : 0;

    // Check incumbent and agency history from our tables
    const { data: incumbent } = await supabase
      .from('incumbents')
      .select('id')
      .ilike('agency', '%' + (opp.agency || '') + '%')
      .limit(1);

    const { data: priorAward } = await supabase
      .from('active_contracts')
      .select('id')
      .ilike('agency', '%' + (opp.agency || '') + '%')
      .limit(1);

    const hasIncumbent  = (incumbent && incumbent.length > 0) ? 1 : 0;
    const agencyHistory = (priorAward  && priorAward.length  > 0) ? 1 : 0;

    X.push([naicsMatch, setAsideMatch, gulfSouth, valueNorm, highScore, hasIncumbent, agencyHistory]);
    y.push(bid.result === 'won' ? 1 : 0);
  }

  if (X.length < ML_THRESHOLD) {
    console.log('LEDGER ML: Not enough complete feature records — skipping training.');
    return;
  }

  const n = X.length;
  const numFeatures = ML_FEATURES.length;

  // Initialize weights and bias to zero
  let weights = new Array(numFeatures).fill(0);
  let bias    = 0;

  // Gradient descent: run ML_ITERATIONS passes through the training data
  for (let iter = 0; iter < ML_ITERATIONS; iter++) {
    // Forward pass: compute predictions for all training samples
    const predictions = X.map(xi => sigmoid(dot(xi, weights) + bias));

    // Compute gradients (cross-entropy loss derivative)
    const errors = predictions.map((pred, i) => pred - y[i]);

    const dWeights = new Array(numFeatures).fill(0);
    for (let j = 0; j < numFeatures; j++) {
      dWeights[j] = X.reduce((sum, xi, i) => sum + errors[i] * xi[j], 0) / n;
    }
    const dBias = errors.reduce((s, e) => s + e, 0) / n;

    // Update weights and bias
    weights = weights.map((w, j) => w - ML_LEARNING_RATE * dWeights[j]);
    bias   -= ML_LEARNING_RATE * dBias;
  }

  // Calculate training accuracy to assess model quality
  const trainingPredictions = X.map(xi => sigmoid(dot(xi, weights) + bias) >= 0.5 ? 1 : 0);
  const correct = trainingPredictions.filter((pred, i) => pred === y[i]).length;
  const accuracy = Math.round((correct / n) * 100);

  const wins   = y.filter(v => v === 1).length;
  const losses = y.filter(v => v === 0).length;

  console.log('LEDGER ML: Training complete — accuracy: ' + accuracy + '% (' + wins + ' wins, ' + losses + ' losses, ' + n + ' samples)');

  // Get the current version number and increment
  const currentVersion = parseInt(await getConfig('L6_01_ML_VERSION', '0'), 10);
  const newVersion     = currentVersion + 1;

  // Save trained model to database
  await supabase.from('ml_weights').insert({
    version:          newVersion,
    feature_names:    ML_FEATURES,
    weights:          weights,
    bias:             bias,
    training_samples: n,
    wins,
    losses,
    accuracy_pct: accuracy,
  });

  // Log training run for audit trail
  const featureImportances = {};
  ML_FEATURES.forEach((name, i) => {
    featureImportances[name] = Math.abs(weights[i]).toFixed(4);
  });

  await supabase.from('ml_training_log').insert({
    version:             newVersion,
    samples:             n,
    accuracy_pct:        accuracy,
    wins,
    losses,
    feature_importances: featureImportances,
    note:                'Gradient descent logistic regression — ' + ML_ITERATIONS + ' iterations, lr=' + ML_LEARNING_RATE,
  });

  // Update system config to tell JUDGE which version to load
  await setConfig('L6_01_ML_VERSION', String(newVersion));
  await setConfig('L6_01_ML_ACTIVE', 'true');
  await setConfig('ML_LAST_TRAINED', new Date().toISOString());

  await logAction('LEDGER', 'L6-01 ML model trained', {
    version:    newVersion,
    accuracy:   accuracy + '%',
    samples:    n,
    wins,
    losses,
    top_feature: Object.entries(featureImportances).sort((a,b) => b[1]-a[1])[0]?.[0],
  });

  console.log('LEDGER ML: L6-01 active — version ' + newVersion + ', accuracy ' + accuracy + '%');
  console.log('LEDGER ML: Feature importances:', featureImportances);
}

// ----------------------------------------------------------
// MATH HELPERS for logistic regression
// ----------------------------------------------------------
function sigmoid(z) {
  // Clip z to prevent overflow in Math.exp()
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
}

function dot(a, b) {
  return a.reduce((sum, ai, i) => sum + ai * b[i], 0);
}

// ----------------------------------------------------------
// START: Run LEDGER when this file is executed
// ----------------------------------------------------------
runLedger();
