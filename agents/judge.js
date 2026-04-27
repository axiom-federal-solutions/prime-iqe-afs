// =============================================================
// JUDGE.JS — Dual Scoring Engine (PRIME Score + ACQ Score)
// JOB: Score every new opportunity and make a Bid/No-Bid recommendation
//      Construction → PRIME Score (5 weighted factors)
//      Supply       → ACQ Score   (5 weighted factors)
// SCHEDULE: After every SCOUT run + daily 7 AM catch-up
// COST: ~$1/month (Claude Haiku for AI-assisted scoring)
// SAFETY RULE: Checks kill switch before every batch
// =============================================================

const { supabase, logAction, checkSystemHalt } = require('../lib/supabase');
const { claudeJSON } = require('../lib/claude');
const { checkCostCap, recordCost } = require('../lib/cost-guard');

// Walker Contractors / Axiom Federal Solutions profile
const COMPANY = {
  name:           'Walker Contractors LLC',
  dba:            'Axiom Federal Solutions',
  uei:            'USMQMFAGL9M4',
  certifications: ['SDB'],
  states:         ['LA','MS','TX','AL','GA','FL','TN'],  // Service region
  primary_naics:  '236220',                               // Commercial construction
  bonding_limit:  500000,                                  // Current bonding capacity ($)
};

// PRIME Score weights for construction opportunities
// Total must add up to 1.00
const PRIME_WEIGHTS = {
  alignment:    0.30,  // How well the scope matches what we do
  win_prob:     0.25,  // Estimated probability we can win this
  financial:    0.20,  // Financial health — contract size, cash flow impact
  strategic:    0.15,  // Strategic value — relationships, positioning, certifications
  feasibility:  0.10,  // Can we actually execute this with current capacity?
};

// ACQ Score weights for supply opportunities
// Total must add up to 1.00
const ACQ_WEIGHTS = {
  set_aside:    0.30,  // Do we qualify for the set-aside? (SDB, SB, SDVO, etc.)
  competition:  0.25,  // How much competition? Fewer bidders = better
  recurring:    0.20,  // Is this a recurring/repeat purchase? (vs. one-time)
  simplicity:   0.15,  // How simple is the supply requirement?
  drop_ship:    0.10,  // Can the distributor ship direct? (Walker doesn't warehouse)
};

// Bid recommendation thresholds
const THRESHOLDS = {
  STRONG_BID:  85,  // Green — definitely bid, notify immediately
  BID:         70,  // Gold  — bid with standard prep
  CONDITIONAL: 55,  // Amber — bid only if specific conditions are met
  NO_BID:       0,  // Red   — skip this one
};

// Construction NAICS codes we compete for
const CONSTRUCTION_NAICS = ['236220', '236116', '237990', '238210', '238160', '238110'];
const SUPPLY_NAICS        = ['424710', '424130', '424490', '424120', '424410'];

// ----------------------------------------------------------
// MAIN: Score all opportunities that are waiting for a score
// ----------------------------------------------------------
async function runJudge() {
  console.log('JUDGE: Starting scoring run...');

  // Check kill switch
  const halted = await checkSystemHalt('JUDGE');
  if (halted) process.exit(0);

  try {
    // Find all opportunities that need scoring
    const { data: opps, error } = await supabase
      .from('opportunities')
      .select('*')
      .eq('status', 'new')
      .limit(100);  // Process up to 100 at a time

    if (error) throw new Error('Database query failed: ' + error.message);

    const opportunities = opps || [];
    console.log('JUDGE: ' + opportunities.length + ' opportunities to score');

    if (opportunities.length === 0) {
      console.log('JUDGE: Nothing to score — all caught up.');
      process.exit(0);
    }

    let scored      = 0;
    let strongBids  = [];

    for (const opp of opportunities) {
      try {
        const result = await scoreOpportunity(opp);
        if (result) {
          scored++;
          if (result.prime_score >= THRESHOLDS.STRONG_BID) {
            strongBids.push({ ...opp, prime_score: result.prime_score });
          }
        }
      } catch (err) {
        console.warn('JUDGE: Failed to score ' + opp.solicitation_number + ' —', err.message);
      }
    }

    // If any STRONG BID (85+) was found, flag it for BRANDI's immediate alert
    if (strongBids.length > 0) {
      await flagStrongBids(strongBids);
    }

    await logAction('JUDGE', 'Scoring run complete', {
      total_scored:    scored,
      strong_bids:     strongBids.length,
      scored_at:       new Date().toISOString(),
    });

    console.log('JUDGE: Done — ' + scored + ' scored, ' + strongBids.length + ' STRONG BIDs flagged.');

  } catch (err) {
    console.error('JUDGE ERROR:', err.message);
    await logAction('JUDGE', 'Scoring run failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// SCORE OPPORTUNITY: Calculate PRIME or ACQ score for one opportunity
// ----------------------------------------------------------
async function scoreOpportunity(opp) {
  const isSupply = SUPPLY_NAICS.includes(opp.naics);

  let scoreResult;

  if (isSupply) {
    scoreResult = await calcAcqScore(opp);
  } else {
    scoreResult = await calcPrimeScore(opp);
  }

  const { score, factors, recommendation, reasoning } = scoreResult;

  // Determine the bid tier
  const tier = score >= THRESHOLDS.STRONG_BID ? 'STRONG_BID'
             : score >= THRESHOLDS.BID         ? 'BID'
             : score >= THRESHOLDS.CONDITIONAL ? 'CONDITIONAL'
             : 'NO_BID';

  // Save the score and recommendation to the database
  const { error } = await supabase
    .from('opportunities')
    .update({
      prime_score:    score,
      score_factors:  factors,
      recommendation: recommendation,
      tier:           tier,
      reasoning:      reasoning,
      scored_at:      new Date().toISOString(),
      status:         tier === 'NO_BID' ? 'rejected' : 'scored',
      needs_scoring:  false,
    })
    .eq('id', opp.id);

  if (error) {
    console.warn('JUDGE: Could not save score for ' + opp.solicitation_number, error.message);
    return null;
  }

  // If this is a Tier 1 bid (BID or STRONG_BID), trigger BID ENGINE
  if (tier === 'BID' || tier === 'STRONG_BID') {
    await triggerBidEngine(opp.id, score);
  }

  return { prime_score: score, tier };
}

// ----------------------------------------------------------
// CALC PRIME SCORE: Score a construction opportunity (5 factors)
// Uses Claude Haiku for intelligent scoring of ambiguous factors
// ----------------------------------------------------------
async function calcPrimeScore(opp) {
  // Factor 1: Alignment (0-100)
  // How well does this match our construction specialty?
  const alignment = scoreAlignment(opp);

  // Factor 2: Win Probability (0-100)
  // Based on set-aside type, competition, our certifications, location advantage
  const winProb = scoreWinProbability(opp);

  // Factor 3: Financial (0-100)
  // Is the contract size right? Not too small (not worth it) or too big (can't bond)?
  const financial = scoreFinancial(opp);

  // Factor 4: Strategic (0-100)
  // Does this build relationships, certifications, or positioning we need?
  const strategic = scoreStrategic(opp);

  // Factor 5: Feasibility (0-100)
  // Can we actually execute this? Location, capacity, timeline?
  const feasibility = scoreFeasibility(opp);

  // Add timing bonus (up to 5 points) for deadlines more than 14 days away
  const timingBonus = calcTimingBonus(opp.deadline);

  // Calculate weighted PRIME Score
  const baseScore = (
    alignment   * PRIME_WEIGHTS.alignment   +
    winProb     * PRIME_WEIGHTS.win_prob    +
    financial   * PRIME_WEIGHTS.financial   +
    strategic   * PRIME_WEIGHTS.strategic   +
    feasibility * PRIME_WEIGHTS.feasibility
  );

  const finalScore = Math.round(Math.min(100, baseScore + timingBonus));

  // Build recommendation text
  const tier = finalScore >= THRESHOLDS.STRONG_BID ? 'STRONG BID'
             : finalScore >= THRESHOLDS.BID         ? 'BID'
             : finalScore >= THRESHOLDS.CONDITIONAL ? 'CONDITIONAL BID'
             : 'NO BID';

  const reasoning = buildConstructionReasoning(opp, finalScore, { alignment, winProb, financial, strategic, feasibility });

  return {
    score:         finalScore,
    factors: {
      alignment,
      win_probability: winProb,
      financial,
      strategic,
      feasibility,
      timing_bonus: timingBonus,
    },
    recommendation: tier,
    reasoning,
  };
}

// ----------------------------------------------------------
// CALC ACQ SCORE: Score a supply opportunity (5 factors)
// Location-blind by design — Walker can drop-ship anywhere in the US
// ----------------------------------------------------------
async function calcAcqScore(opp) {
  // Factor 1: Set-Aside Match (0-100)
  const setAsideMatch = scoreSetAsideMatch(opp);

  // Factor 2: Competition Level (0-100) — fewer bidders = higher score
  const competition = scoreCompetition(opp);

  // Factor 3: Recurring Revenue Potential (0-100)
  const recurring = scoreRecurringPotential(opp);

  // Factor 4: Simplicity (0-100) — how easy is this supply requirement?
  const simplicity = scoreSupplySimplicity(opp);

  // Factor 5: Drop-Ship Eligible (0-100) — can distributor ship direct?
  const dropShip = scoreDropShipEligibility(opp);

  // Weighted ACQ Score
  const finalScore = Math.round(
    setAsideMatch * ACQ_WEIGHTS.set_aside  +
    competition   * ACQ_WEIGHTS.competition +
    recurring     * ACQ_WEIGHTS.recurring   +
    simplicity    * ACQ_WEIGHTS.simplicity  +
    dropShip      * ACQ_WEIGHTS.drop_ship
  );

  const tier = finalScore >= THRESHOLDS.STRONG_BID ? 'STRONG BID'
             : finalScore >= THRESHOLDS.BID         ? 'BID'
             : finalScore >= THRESHOLDS.CONDITIONAL ? 'CONDITIONAL BID'
             : 'NO BID';

  const reasoning = buildSupplyReasoning(opp, finalScore, { setAsideMatch, competition, recurring, simplicity, dropShip });

  return {
    score:         finalScore,
    factors: {
      set_aside_match: setAsideMatch,
      competition,
      recurring_revenue: recurring,
      simplicity,
      drop_ship_eligible: dropShip,
    },
    recommendation: tier,
    reasoning,
  };
}

// ----------------------------------------------------------
// FACTOR SCORERS — Construction
// ----------------------------------------------------------

function scoreAlignment(opp) {
  let score = 50;
  const title = (opp.title || '').toLowerCase();
  const naics  = opp.naics || '';

  // Primary NAICS match
  if (naics === '236220') score += 25;                                // Commercial construction — core
  else if (['236116','238210','238160','238110'].includes(naics)) score += 15;
  else if (naics === '237990') score += 10;                           // Civil — we can do it

  // Gulf South construction keywords in title
  const positiveKeywords = ['building', 'facility', 'renovation', 'construction', 'repair', 'hvac', 'electrical', 'roofing', 'concrete', 'structure'];
  const matches = positiveKeywords.filter(kw => title.includes(kw)).length;
  score += Math.min(matches * 5, 20);

  return Math.min(score, 100);
}

function scoreWinProbability(opp) {
  let score = 40;

  // Set-aside match — best single factor for win probability
  const sa = (opp.set_aside || '').toUpperCase();
  if (['SDB','SBA','SBP'].includes(sa)) score += 30;    // We qualify — fewer competitors
  else if (['SDVOSBC','WOSB','8A'].includes(sa)) score += 10;  // Close but need more certs

  // Gulf South location advantage
  const state = opp.place_of_performance;
  if (state && ['LA','MS'].includes(state)) score += 20;      // Home turf advantage
  else if (state && ['TX','AL','FL','GA','TN'].includes(state)) score += 10;

  return Math.min(score, 100);
}

function scoreFinancial(opp) {
  const value = opp.value || 0;

  // Sweet spot for Walker: $100K–$5M
  if (value >= 250000  && value <= 2000000)  return 90;  // Perfect size
  if (value >= 100000  && value <= 5000000)  return 75;  // Good size
  if (value >= 50000   && value <= 10000000) return 55;  // Manageable
  if (value > 10000000) return 30;                        // Too big for current bonding
  if (value > 0)        return 40;                        // Too small — not worth overhead
  return 50;                                               // Value unknown — neutral
}

function scoreStrategic(opp) {
  let score = 50;
  const agency = (opp.agency || '').toUpperCase();

  // Federal agency relationships matter
  if (agency.includes('ARMY') || agency.includes('USACE')) score += 20;  // USACE = construction
  if (agency.includes('VA')   || agency.includes('VETERANS'))  score += 15;
  if (agency.includes('GSA'))                                   score += 15;
  if (agency.includes('DHS')  || agency.includes('DOD'))       score += 10;

  return Math.min(score, 100);
}

function scoreFeasibility(opp) {
  let score = 70;

  // Deduct if deadline is very close (less than 7 days)
  const deadline = opp.deadline ? new Date(opp.deadline) : null;
  if (deadline) {
    const daysLeft = Math.ceil((deadline - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 7)  score -= 30;
    else if (daysLeft < 14) score -= 15;
  }

  return Math.max(score, 10);
}

function calcTimingBonus(deadlineStr) {
  if (!deadlineStr) return 0;
  const deadline  = new Date(deadlineStr);
  const daysLeft  = Math.ceil((deadline - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft >= 21) return 5;   // 3+ weeks — plenty of time
  if (daysLeft >= 14) return 2;   // 2 weeks — manageable
  return 0;                        // Less than 2 weeks — no bonus
}

// ----------------------------------------------------------
// FACTOR SCORERS — Supply
// ----------------------------------------------------------

function scoreSetAsideMatch(opp) {
  const sa = (opp.set_aside || '').toUpperCase();
  if (['SDB','SBA','SBP'].includes(sa)) return 100;  // Perfect match
  if (['SDVOSBC','WOSB','8A','HZC'].includes(sa)) return 60;  // Close but missing cert
  if (!sa || sa === 'NONE') return 50;               // Full and open — neutral
  return 40;
}

function scoreCompetition(opp) {
  // Simplified — without vendor count data, use contract value as proxy
  // Small contracts = fewer large primes bother = better odds
  const value = opp.value || 0;
  if (value < 25000)  return 85;  // Micro-purchase — minimal competition
  if (value < 100000) return 70;  // Simplified acquisition — low competition
  if (value < 500000) return 55;  // Moderate competition
  return 40;                       // High competition
}

function scoreRecurringPotential(opp) {
  const title   = (opp.title || '').toLowerCase();
  const naics   = opp.naics || '';

  // Fuel, janitorial supplies, office supplies — all recurring by nature
  if (['424710','424130','424120','424410'].includes(naics)) return 80;
  if (naics === '424490') return 60;  // PPE can be recurring or one-time

  // Keywords that suggest recurring purchases
  const recurringKeywords = ['annual', 'blanket', 'indefinite', 'idiq', 'bpa', 'delivery order', 'year supply'];
  if (recurringKeywords.some(kw => title.includes(kw))) return 90;

  return 50;
}

function scoreSupplySimplicity(opp) {
  const title = (opp.title || '').toLowerCase();

  // Complex supply requirements (avoid these)
  const complexKeywords = ['hazmat', 'radioactive', 'classified', 'specialized', 'refrigerated', 'controlled'];
  if (complexKeywords.some(kw => title.includes(kw))) return 20;

  // Simple commodity items (ideal for drop-ship)
  const simpleKeywords = ['paper', 'supplies', 'fuel', 'food', 'janitorial', 'cleaning', 'ppe', 'office'];
  const matches = simpleKeywords.filter(kw => title.includes(kw)).length;

  return Math.min(60 + matches * 10, 100);
}

function scoreDropShipEligibility(opp) {
  const title = (opp.title || '').toLowerCase();

  // Items that absolutely require on-site presence — drop-ship won't work
  const onSiteRequired = ['installation', 'maintenance', 'repair service', 'calibration'];
  if (onSiteRequired.some(kw => title.includes(kw))) return 10;

  // Standard commodities that any distributor can drop-ship
  return 80;  // Most supply contracts allow FOB destination (drop-ship)
}

// ----------------------------------------------------------
// REASONING BUILDERS: Generate readable explanations
// ----------------------------------------------------------

function buildConstructionReasoning(opp, score, factors) {
  return (
    'PRIME Score: ' + score + '/100 (' + (score >= 85 ? 'STRONG BID' : score >= 70 ? 'BID' : score >= 55 ? 'CONDITIONAL' : 'NO BID') + '). ' +
    'Alignment: ' + factors.alignment + ' | Win Probability: ' + factors.winProb + ' | Financial: ' + factors.financial + ' | Strategic: ' + factors.strategic + ' | Feasibility: ' + factors.feasibility + '. ' +
    'Value: $' + ((opp.value || 0) / 1000).toFixed(0) + 'K | Agency: ' + (opp.agency || 'Unknown') + ' | Set-Aside: ' + (opp.set_aside || 'Full & Open') + '.'
  );
}

function buildSupplyReasoning(opp, score, factors) {
  return (
    'ACQ Score: ' + score + '/100 (' + (score >= 85 ? 'STRONG BID' : score >= 70 ? 'BID' : score >= 55 ? 'CONDITIONAL' : 'NO BID') + '). ' +
    'Set-Aside: ' + factors.setAsideMatch + ' | Competition: ' + factors.competition + ' | Recurring: ' + factors.recurring + ' | Simplicity: ' + factors.simplicity + ' | Drop-Ship: ' + factors.dropShip + '. ' +
    'Drop-ship model: Distributor ships direct to government — Walker holds contract, zero warehousing.'
  );
}

// ----------------------------------------------------------
// FLAG STRONG BIDS: Mark Tier 1 opportunities for immediate BRANDI alert
// ----------------------------------------------------------
async function flagStrongBids(strongBids) {
  for (const opp of strongBids) {
    await supabase
      .from('opportunities')
      .update({ alert_level: 'CRITICAL', alert_sent: false })
      .eq('id', opp.id);

    await logAction('JUDGE', 'STRONG BID flagged for BRANDI alert', {
      solicitation: opp.solicitation_number,
      title:        opp.title,
      score:        opp.prime_score,
      agency:       opp.agency,
    });
  }
}

// ----------------------------------------------------------
// TRIGGER BID ENGINE: Queue a scored opportunity for pricing
// ----------------------------------------------------------
async function triggerBidEngine(oppId, score) {
  await supabase.from('bids').upsert({
    opportunity_id: oppId,
    status:         'pending_pricing',
    prime_score:    score,
    created_at:     new Date().toISOString(),
  }, { onConflict: 'opportunity_id' });
}

// Run JUDGE when this file is executed
runJudge();
