// =============================================================
// JUDGE.JS — Job Utility & Decision Grading Engine
// JOB: Score every new contract on a 0-100 scale
// SCHEDULE: Triggered automatically after each SCOUT scan
// COST: ~$6/month (uses Claude Haiku AI for reasoning)
// =============================================================

// Load helper tools
const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// ----------------------------------------------------------
// SCORING WEIGHTS: How much each factor counts toward the score
// These 5 weights must add up to 1.0 (100%)
// ----------------------------------------------------------
const WEIGHTS = {
  alignment:   0.25,  // Does this match our licenses, set-asides, location?
  winProb:     0.20,  // How likely are we to win?
  financial:   0.25,  // Is the money worth it?
  strategic:   0.15,  // Does this help us grow long-term?
  feasibility: 0.15,  // Can we actually do this job right now?
};

// ----------------------------------------------------------
// MAIN FUNCTION: Score all new opportunities
// ----------------------------------------------------------
async function runJudge() {
  console.log('JUDGE: Starting scoring run at ' + new Date().toISOString());

  // Get all opportunities that haven't been scored yet
  const { data: opps, error } = await supabase
    .from('opportunities')
    .select('*')
    .eq('status', 'new');

  if (error) {
    console.error('JUDGE: Failed to fetch opportunities —', error.message);
    await logAction('JUDGE', 'Fetch failed', { error: error.message });
    process.exit(1);
  }

  console.log('JUDGE: Found ' + opps.length + ' opportunities to score');

  // Score each one
  for (const opp of opps) {
    try {
      await scoreOpportunity(opp);
    } catch (err) {
      console.warn('JUDGE: Failed to score ' + opp.solicitation_number + ' — ' + err.message);
    }
  }

  // Check for decisions that are taking too long (stale)
  await checkDecisionAging();

  await logAction('JUDGE', 'Scoring run complete', { scored: opps.length });
  console.log('JUDGE: Done scoring ' + opps.length + ' opportunities.');
}

// ----------------------------------------------------------
// SCORE ONE OPPORTUNITY: Run all 5 scoring factors
// ----------------------------------------------------------
async function scoreOpportunity(opp) {
  // Calculate each of the 5 scoring factors (each returns 0-100)
  const factors = {
    alignment:   calcAlignment(opp),
    winProb:     calcWinProbability(opp),
    financial:   calcFinancial(opp),
    strategic:   calcStrategic(opp),
    feasibility: calcFeasibility(opp),
  };

  // Multiply each factor by its weight and add them all up
  const score = Object.entries(factors)
    .reduce((sum, [key, val]) => sum + val * WEIGHTS[key], 0);

  // Ask Claude Haiku to explain the score in plain English
  const rationale = await claudeHaiku(
    'You are a federal contracting advisor. Explain in 3 short sentences ' +
    'why a contractor should or should not bid on this opportunity. Score: ' +
    Math.round(score) + '/100. ' +
    'Opportunity data: ' + JSON.stringify({ title: opp.title, naics: opp.naics,
      set_aside: opp.set_aside, value: opp.value, state: opp.state, factors })
  );

  // Save the score and reasoning to the database
  await supabase
    .from('opportunities')
    .update({
      prime_score: Math.round(score),
      status: 'scored',
      scored_at: new Date().toISOString(),
      decision_made_at: null,
    })
    .eq('id', opp.id);

  // Write a log entry
  await logAction('JUDGE', 'Scored ' + opp.solicitation_number, {
    score: Math.round(score),
    factors,
    rationale,
  });

  console.log('JUDGE: ' + opp.solicitation_number + ' scored ' + Math.round(score) + '/100');
}

// ----------------------------------------------------------
// FACTOR 1: ALIGNMENT (0-100)
// Does this opportunity match our capabilities?
// ----------------------------------------------------------
function calcAlignment(opp) {
  let score = 50; // Start in the middle

  // Our registered NAICS codes — add points if it matches
  const ourNAICS = ['236220','238210','237990','236116','561730',
                    '424710','424130','424490','424120'];
  if (ourNAICS.includes(opp.naics)) score += 20;

  // Preferred states where we operate
  const ourStates = ['TX','OK','LA','AR','NM','CO','KS','MO'];
  if (ourStates.includes(opp.state)) score += 15;

  // Set-asides we qualify for
  const goodSetAsides = ['Total Small Business', 'SBA', 'HUBZone', 'SDVOSB', '8(a)'];
  if (!opp.set_aside || goodSetAsides.some(s => (opp.set_aside || '').includes(s))) score += 15;

  return Math.min(100, score);
}

// ----------------------------------------------------------
// FACTOR 2: WIN PROBABILITY (0-100)
// How likely are we to beat the competition?
// ----------------------------------------------------------
function calcWinProbability(opp) {
  let score = 50;

  // Smaller contracts = less competition = better odds
  if (opp.value && opp.value < 500000) score += 20;
  else if (opp.value && opp.value < 1500000) score += 10;
  else if (opp.value && opp.value > 5000000) score -= 10;

  // Set-aside contracts have fewer bidders
  if (opp.set_aside && opp.set_aside !== 'None') score += 15;

  // Site visits are burdensome and reduce competition
  if (opp.site_visit_required) score += 10;

  return Math.min(100, Math.max(0, score));
}

// ----------------------------------------------------------
// FACTOR 3: FINANCIAL (0-100)
// Is the profit margin worth our time?
// ----------------------------------------------------------
function calcFinancial(opp) {
  let score = 50;

  // Sweet spot: $150K–$2M contracts have best margin/effort ratio
  if (opp.value >= 150000 && opp.value <= 2000000) score += 25;
  else if (opp.value >= 50000 && opp.value < 150000) score += 10;
  else if (opp.value > 10000000) score -= 15; // Very large = high bonding cost

  // Bid bond required reduces margin slightly
  if (opp.site_visit_required) score -= 5;

  return Math.min(100, Math.max(0, score));
}

// ----------------------------------------------------------
// FACTOR 4: STRATEGIC VALUE (0-100)
// Does winning this help us build relationships or win bigger later?
// ----------------------------------------------------------
function calcStrategic(opp) {
  let score = 50;

  // Agencies with high recompete rates are valuable
  const strategicAgencies = ['ARMY', 'NAVY', 'AIR FORCE', 'VA', 'GSA', 'USACE'];
  if (strategicAgencies.some(a => (opp.agency || '').toUpperCase().includes(a))) score += 20;

  // 8(a) and HUBZone help build certifications history
  if ((opp.set_aside || '').includes('8(a)')) score += 15;
  if ((opp.set_aside || '').includes('HUBZone')) score += 10;

  return Math.min(100, score);
}

// ----------------------------------------------------------
// FACTOR 5: FEASIBILITY (0-100)
// Can we do this job given our current workload?
// ----------------------------------------------------------
function calcFeasibility(opp) {
  let score = 70; // Default — assume we can handle it

  // Jobs far from HQ cost more to mobilize
  const remoteStates = ['AK','HI','PR','GU'];
  if (remoteStates.includes(opp.state)) score -= 20;

  // Very short deadlines are hard to hit
  if (opp.deadline) {
    const daysLeft = Math.floor((new Date(opp.deadline) - new Date()) / 86400000);
    if (daysLeft < 7) score -= 25;
    else if (daysLeft < 14) score -= 10;
  }

  return Math.min(100, Math.max(0, score));
}

// ----------------------------------------------------------
// DECISION AGING: Flag opportunities that haven't been decided on
// If Joe hasn't made a bid/no-bid call in 48 hours, warn him
// ----------------------------------------------------------
async function checkDecisionAging() {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago

  const { data: stale } = await supabase
    .from('opportunities')
    .select('id, solicitation_number, prime_score')
    .eq('status', 'scored')
    .lt('scored_at', cutoff);

  if (stale && stale.length > 0) {
    console.log('JUDGE: ' + stale.length + ' opportunities have STALE decisions (48+ hours)');
    for (const opp of stale) {
      // Calculate how many days since scoring
      const ageHours = Math.floor((Date.now() - new Date(opp.scored_at)) / 3600000);
      await supabase
        .from('opportunities')
        .update({ decision_age_days: Math.floor(ageHours / 24) })
        .eq('id', opp.id);
    }
    await logAction('JUDGE', 'Decision aging check', { stale_count: stale.length });
  }
}

// ----------------------------------------------------------
// START: Run JUDGE when this file is executed
// ----------------------------------------------------------
runJudge();
