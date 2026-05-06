// =============================================================
// JUDGE.JS — Dual Scoring Engine (PRIME Score + ACQ Score)
// JOB: Score every new opportunity and make a Bid/No-Bid recommendation
//      Construction → PRIME Score (5 weighted factors)
//      Supply       → ACQ Score   (5 weighted factors)
// SCHEDULE: After every SCOUT run + daily 7 AM catch-up
// COST: ~$1/month (Claude Haiku for AI-assisted scoring)
// SAFETY RULE: Checks kill switch before every batch
// =============================================================

const { supabase, logAction, isAgentEnabled, getConfig } = require('../lib/supabase');
const { claudeJSON } = require('../lib/claude');
const { checkCostCap, recordCost } = require('../lib/cost-guard');

// ─── L6-01: ML Weight Override ────────────────────────────────────────────
// When LEDGER has trained a logistic regression model (20+ bid outcomes),
// loadMLWeights() fetches the latest version from ml_weights table.
// The ML-derived win_prob weight replaces the fixed PRIME_WEIGHTS.win_prob.
// LEDGER updates this weekly — JUDGE picks up the new version on each run.
let mlWeightsLoaded    = false;
let mlWeightVector     = null;  // [naics_match, set_aside_match, gulf_south, value_norm, high_score, has_incumbents, agency_history]
let mlBias             = 0;
let mlVersion          = 0;

async function loadMLWeights() {
  try {
    const isActive = await getConfig('L6_01_ML_ACTIVE', 'false');
    if (isActive !== 'true') return;  // Not yet activated — use fixed weights

    const version = parseInt(await getConfig('L6_01_ML_VERSION', '0'), 10);
    if (version === 0) return;

    const { data: weights } = await supabase
      .from('ml_weights')
      .select('weights, bias, accuracy_pct, feature_names')
      .eq('version', version)
      .single();

    if (!weights) return;

    mlWeightVector  = weights.weights;
    mlBias          = weights.bias;
    mlVersion       = version;
    mlWeightsLoaded = true;

    console.log('JUDGE ML: Loaded L6-01 weights v' + version + ' (accuracy: ' + weights.accuracy_pct + '%)');
  } catch (err) {
    console.warn('JUDGE ML: Could not load ML weights —', err.message, '— using fixed weights');
  }
}

// Apply ML model to estimate win probability for a specific opportunity
// Returns 0-100 score replacing the fixed win_prob component
function mlWinProbScore(opp) {
  if (!mlWeightsLoaded || !mlWeightVector) return null;

  const GULF_SOUTH = ['LA','MS','TX','AL','GA','FL','TN'];
  const OUR_NAICS  = ['236220','238210','237990','236116','238320','238910',
                       '238990','238220','424710','424130','424490','424120'];

  const naicsMatch   = OUR_NAICS.some(n => (opp.naics || '').startsWith(n.substring(0, 4))) ? 1 : 0;
  const setAsideMatch= ['SDB','SBA','SB'].some(s => (opp.set_aside || '').includes(s)) ? 1 : 0;
  const gulfSouth    = GULF_SOUTH.includes(opp.place_of_performance || '') ? 1 : 0;
  const valueNorm    = Math.min(1, (opp.value || 0) / 5000000);
  const highScore    = (opp.pre_prime_score || 0) >= 70 ? 1 : 0;
  const hasIncumbent = 0;   // JUDGE doesn't have live incumbent lookup — RECON sets this
  const agencyHist   = 0;   // Simplified — LEDGER captures this during training

  const featureVec = [naicsMatch, setAsideMatch, gulfSouth, valueNorm, highScore, hasIncumbent, agencyHist];
  const z = featureVec.reduce((sum, f, i) => sum + f * mlWeightVector[i], mlBias);
  const prob = 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z)))); // sigmoid, clipped
  return Math.round(prob * 100); // Convert to 0-100 scale for PRIME score component
}

// 2026-04-30: removed 541511/541512/541519/611430/541611 — IT/SAP/training out of scope
const SUPPLY_NAICS_PREFIXES = ['541330','561110','561210',
  '424410','332999','339999','611420','541618','488490'];
const RE_NAICS_PREFIXES = ['531110','531120','531210','531311','531312','531390'];
function deriveVertical(naics) {
  const n = (naics || '').trim();
  if (RE_NAICS_PREFIXES.some(p => n.startsWith(p))) return 'realestate';
  if (SUPPLY_NAICS_PREFIXES.some(p => n.startsWith(p))) return 'supply';
  return 'construction';
}

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

// NAICS code sets by vertical (drives which scoring model to use)
const CONSTRUCTION_NAICS = [
  '236220','236116','237990','238210','238160','238110',
  '236210','238320','238910','238990','238220',
  '238310','238330','238110','238160','237310','237110','562910',
  '541330','561720','561210','238350','561730',
];
const SUPPLY_NAICS = [
  '424710','424720',  // Fuel
  '561720','424130',  // Janitorial
  '339113','423440',  // PPE
  '424120','453210',  // Office
  '424490','311999',  // Food
  '424690',           // Chemicals
  '423450',           // Safety equipment
  '424310','315990',  // Uniforms
  '424410','332999','339999',  // General supply
];
// Real Estate & Rental — uses LEASE Score model
const REAL_ESTATE_NAICS = ['531110','531120','532412','532120'];

// Supply sub-category map — mirrors SUPPLY_CATS in the dashboard (index.html)
// Used to stamp supply_category on scored opportunities
const SUPPLY_CAT_MAP = [
  { key: 'fuel',     naics: ['424710','424720'] },
  { key: 'jan',      naics: ['561720','424130'] },
  { key: 'ppe',      naics: ['339113','423440'] },
  { key: 'office',   naics: ['424120','453210'] },
  { key: 'food',     naics: ['424490','311999'] },
  { key: 'chem',     naics: ['424690'] },
  { key: 'safety',   naics: ['423450'] },
  { key: 'uni',      naics: ['424310','315990'] },
];
function deriveSupplyCategory(naics) {
  const n = (naics || '').trim();
  const match = SUPPLY_CAT_MAP.find(c => c.naics.some(p => n.startsWith(p)));
  return match ? match.key : null;
}

// LEASE Score weights for Real Estate & Rental vertical
const LEASE_WEIGHTS = {
  asset_ownership: 0.30,  // Do we own the property/equipment needed?
  location_match:  0.25,  // Is the asset in the right location?
  lease_term_fit:  0.20,  // Does the contract term match our holding strategy?
  cert_match:      0.15,  // Set-aside certification match
  revenue_stability: 0.10, // Is this recurring, stable revenue?
};

// ----------------------------------------------------------
// MAIN: Score all opportunities that are waiting for a score
// ----------------------------------------------------------
async function runJudge() {
  console.log('JUDGE: Starting scoring run...');

  // Check per-agent enable flag (T.E.S.T. can disable JUDGE via system_config)
  const enabled = await isAgentEnabled('JUDGE');
  if (!enabled) process.exit(0);

  // L6-01: Load ML weights if LEDGER has trained a model (20+ bid outcomes)
  await loadMLWeights();

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
// SCORE OPPORTUNITY: Route to the correct scoring model
// Construction → PRIME Score | Supply → ACQ Score | Real Estate → LEASE Score
// ----------------------------------------------------------
async function scoreOpportunity(opp) {
  // Use prefix-based vertical detection so partial NAICS codes still match
  const vertical    = deriveVertical(opp.naics || opp.naics_code || '');
  const isSupply     = vertical === 'supply';
  const isRealEstate = vertical === 'realestate';

  let scoreResult;
  let scoreField = 'prime_score'; // Default field to save score into

  if (isRealEstate) {
    scoreResult = await calcLeaseScore(opp);
    scoreField  = 'lease_score';
  } else if (isSupply) {
    scoreResult = await calcAcqScore(opp);
    scoreField  = 'prime_score'; // ACQ score stored in prime_score column as generic score
  } else {
    scoreResult = await calcPrimeScore(opp);
    scoreField  = 'prime_score';
  }

  const { score, factors, recommendation, reasoning } = scoreResult;

  // Determine the bid tier (same thresholds across all 3 scoring models)
  const tier = score >= THRESHOLDS.STRONG_BID ? 'STRONG_BID'
             : score >= THRESHOLDS.BID         ? 'BID'
             : score >= THRESHOLDS.CONDITIONAL ? 'CONDITIONAL'
             : 'NO_BID';

  // Build the update payload — real estate opps also get lease_score stored separately
  const updatePayload = {
    prime_score:    score,        // Always populate prime_score for sorting/display
    raw_data:       null,         // Null out raw SAM.gov JSON after scoring — prevents DB bloat (~5KB/opp)
    score_factors:  factors,
    recommendation: recommendation,
    tier:           tier,
    reasoning:      reasoning,
    scored_at:      new Date().toISOString(),
    status:         tier === 'NO_BID' ? 'rejected' : 'scored',
    needs_scoring:  false,
    vertical:       deriveVertical(opp.naics || opp.naics_code || ''),
  };

  // Also store lease_score in its dedicated column for real estate opps
  if (isRealEstate) {
    updatePayload.lease_score = score;
    updatePayload.prime_score = null; // Real estate doesn't have a PRIME Score
  }

  // For supply opps: also write acq_score + supply_category so dashboard can filter by category
  if (isSupply) {
    updatePayload.acq_score       = score;
    updatePayload.supply_category = deriveSupplyCategory(opp.naics || opp.naics_code || '');
  }

  // Save the score and recommendation to the database
  const { error } = await supabase
    .from('opportunities')
    .update(updatePayload)
    .eq('id', opp.id);

  if (error) {
    console.warn('JUDGE: Could not save score for ' + opp.solicitation_number, error.message);
    return null;
  }

  // 2026-05-04: previously only created bids for BID/STRONG_BID tier (score ≥70).
  // CONDITIONAL (55-69) was excluded, so most opps never got priced — detail panel
  // showed "Run BID ENGINE" placeholder forever. Now any non-NO_BID tier gets a
  // bid record so BIDENGINE batch mode prices it. Pricing is cheap (math + DB write,
  // no API calls) and the data is useful even for CONDITIONAL opps in case the user
  // wants to bid via teaming.
  if (tier !== 'NO_BID') {
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
// CALC LEASE SCORE: Score a Real Estate & Rental opportunity (5 factors)
// Asset-dependent: VAULT must confirm asset ownership before bid is allowed
// This score tells Joe HOW GOOD the contract is IF the asset exists
// ----------------------------------------------------------
async function calcLeaseScore(opp) {
  const naics = opp.naics || '';
  const state = opp.place_of_performance || '';
  const title = (opp.title || '').toLowerCase();
  const value = opp.value || 0;

  // Factor 1: Asset Ownership (0-100)
  // VAULT checks actual asset records — JUDGE uses NAICS as proxy for now
  // Full ownership check happens in VAULT before bid submission
  const assetOwnership = scoreAssetOwnership(naics, title);

  // Factor 2: Location Match (0-100)
  // Is the asset in or near where the government needs it?
  const locationMatch = scoreLeaseLocation(state);

  // Factor 3: Lease Term Fit (0-100)
  // Does the contract duration match Walker's holding/investment strategy?
  const leaseTermFit = scoreLeaseTermFit(opp, title);

  // Factor 4: Certification Match (0-100)
  const certMatch = scoreSetAsideMatch(opp); // Reuse supply function — same logic

  // Factor 5: Revenue Stability (0-100)
  // Is this a long-term stable income stream or one-time emergency contract?
  const revenueStability = scoreRevenueStability(naics, title);

  // Weighted LEASE Score
  const finalScore = Math.round(
    assetOwnership   * LEASE_WEIGHTS.asset_ownership  +
    locationMatch    * LEASE_WEIGHTS.location_match   +
    leaseTermFit     * LEASE_WEIGHTS.lease_term_fit   +
    certMatch        * LEASE_WEIGHTS.cert_match       +
    revenueStability * LEASE_WEIGHTS.revenue_stability
  );

  const tier = finalScore >= THRESHOLDS.STRONG_BID ? 'STRONG BID'
             : finalScore >= THRESHOLDS.BID         ? 'BID'
             : finalScore >= THRESHOLDS.CONDITIONAL ? 'CONDITIONAL BID'
             : 'NO BID';

  const reasoning = buildRealEstateReasoning(opp, finalScore, {
    assetOwnership, locationMatch, leaseTermFit, certMatch, revenueStability,
  });

  return {
    score: finalScore,
    factors: {
      asset_ownership: assetOwnership,
      location_match:  locationMatch,
      lease_term_fit:  leaseTermFit,
      cert_match:      certMatch,
      revenue_stability: revenueStability,
    },
    recommendation: tier,
    reasoning,
  };
}

// LEASE Score Factor: Asset Ownership — proxy score until VAULT confirms
function scoreAssetOwnership(naics, title) {
  // GSA nonresidential leases (531120) — large passive income stream, good score if property exists
  if (naics === '531120') return 70;  // GSA leases — property ownership assumed pending VAULT check
  // Military residential housing (531110)
  if (naics === '531110') return 65;
  // Equipment rental — likely have construction equipment (532412)
  if (naics === '532412') return 75;  // Walker likely has some heavy equipment
  // Truck rental (532120) — good if fleet exists
  if (naics === '532120') return 60;

  // Keywords suggesting asset availability
  if (title.includes('adjacent') || title.includes('nearby') || title.includes('baton rouge') ||
      title.includes('new orleans') || title.includes('louisiana')) return 70;

  return 50; // Unknown — VAULT will confirm actual ownership
}

// LEASE Score Factor: Location Match for real estate opps
function scoreLeaseLocation(state) {
  if (!state) return 40;
  // Same city/metro (Gulf South) — highest score
  if (['LA'].includes(state)) return 100;  // Home state
  if (['MS','TX'].includes(state)) return 80;  // Adjacent — can manage
  if (['AL','FL','GA'].includes(state)) return 60;  // Same day travel
  if (['TN','AR'].includes(state)) return 40;  // Manageable
  return 20;  // Remote — low score
}

// LEASE Score Factor: Lease Term Fit
function scoreLeaseTermFit(opp, title) {
  // Look for lease term signals in title/description
  if (title.includes('5 year') || title.includes('5-year')) return 95;
  if (title.includes('3 year') || title.includes('3-year')) return 85;
  if (title.includes('1 year') || title.includes('annual'))  return 75;
  if (title.includes('month-to-month') || title.includes('short term')) return 50;
  if (title.includes('10 year') || title.includes('15 year')) return 40; // Long lock-in
  return 70; // Unknown term — assume moderate fit
}

// LEASE Score Factor: Revenue Stability
function scoreRevenueStability(naics, title) {
  // GSA office leases are multi-year stable — very high stability
  if (naics === '531120') return 90;
  // Military housing — long-term stable demand
  if (naics === '531110') return 85;
  // Equipment rental — ongoing, but variable demand
  if (naics === '532412') return 65;
  // Truck rental — disaster response is seasonal and unpredictable
  if (naics === '532120') return 50;
  return 60;
}

// Build readable LEASE Score reasoning
function buildRealEstateReasoning(opp, score, factors) {
  return (
    'LEASE Score: ' + score + '/100 (' + (score >= 85 ? 'STRONG BID' : score >= 70 ? 'BID' : score >= 55 ? 'CONDITIONAL' : 'NO BID') + '). ' +
    'Asset Ownership: ' + factors.assetOwnership + ' (VAULT will confirm before bid) | ' +
    'Location: ' + factors.locationMatch + ' | ' +
    'Lease Term Fit: ' + factors.leaseTermFit + ' | ' +
    'Cert Match: ' + factors.certMatch + ' | ' +
    'Revenue Stability: ' + factors.revenueStability + '. ' +
    'REMINDER: VAULT blocks bid submission unless asset ownership is confirmed in the system.'
  );
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
// TRIGGER BID ENGINE: Queue bid for VAULT clearance first
// Status flow: vault_pending → VAULT clears → pending_pricing → BID ENGINE
// VAULT gates every bid. INELIGIBLE bids get status = compliance_hold.
// ----------------------------------------------------------
async function triggerBidEngine(oppId, score) {
  await supabase.from('bids').upsert({
    opportunity_id: oppId,
    status:         'vault_pending',   // VAULT must clear before BID ENGINE prices it
    prime_score:    score,
    created_at:     new Date().toISOString(),
  }, { onConflict: 'opportunity_id' });
  console.log('JUDGE: Bid queued for VAULT review — opportunity ' + oppId);
}

// Run JUDGE when this file is executed
runJudge();
