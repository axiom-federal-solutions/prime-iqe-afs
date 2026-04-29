// =============================================================
// BIDENGINE.JS — Bid Intelligence & Dynamic Engineering Network
<<<<<<< HEAD
// JOB: Calculate the right price for any government construction contract
// SCHEDULE: On-demand — triggered when a bid is approved
// COST: ~$1/month (mostly math, minimal AI)
// PRICING MODEL: Labor (Davis-Bacon) + Materials + Mobilization + Bond + Overhead + Profit
// =============================================================

// Load helper tools
const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');

// Walker Contractors LLC / Axiom Federal Solutions HQ — New Orleans, LA
const HQ_LOCATION = { state: 'LA', lat: 29.9511, lng: -90.0715 };

// Supply NAICS codes — pricing is handled differently than construction
const SUPPLY_NAICS = ['424710', '424130', '424490', '424120'];
=======
// JOB: Calculate the right price for any government contract
// SCHEDULE: On-demand — triggered when Joe approves a bid
// COST: ~$1/month (mostly math, minimal AI)
// =============================================================

// Load helper tools
const { supabase, logAction } = require('../lib/supabase');

// Our company headquarters location (for mobilization distance calc)
const HQ_LOCATION = { state: 'TX', lat: 32.7767, lng: -96.7970 }; // Dallas, TX

// Supply NAICS codes — pricing is handled differently than construction
const SUPPLY_NAICS = ['424710','424130','424490','424120'];
>>>>>>> prime-system/main

// DOL Davis-Bacon API for prevailing wages
const DOL_WAGE_URL = 'https://api.dol.gov/V1/SCA/wage-determination';

// ----------------------------------------------------------
// MAIN FUNCTION: Calculate the bid price for an opportunity
// ----------------------------------------------------------
async function runBidEngine() {
  // Get the opportunity ID from command line
  const opportunityId = process.argv[2];

  if (!opportunityId) {
    console.error('BID ENGINE: No opportunity ID provided. Usage: node agents/bidengine.js <opportunityId>');
    process.exit(1);
  }

  console.log('BID ENGINE: Calculating price for opportunity ' + opportunityId);

  try {
    const result = await calculateBidPrice(opportunityId);

<<<<<<< HEAD
    // Find or create the bid record for this opportunity
    const { data: existingBid } = await supabase
      .from('bids')
      .select('id')
      .eq('opportunity_id', opportunityId)
      .single();

    if (existingBid) {
      await supabase
        .from('bids')
        .update({ pricing_data: result })
        .eq('opportunity_id', opportunityId);
    } else {
      await supabase.from('bids').insert({
        opportunity_id: opportunityId,
        status: 'priced',
        pricing_data: result,
      });
    }

    console.log('BID ENGINE: Price calculated — $' + result.base.toLocaleString() + ' base');

=======
    // Save the pricing to the bids table
    await supabase
      .from('bids')
      .update({ pricing_data: result })
      .eq('opportunity_id', opportunityId);

    console.log('BID ENGINE: Price calculated — $' + result.base.toLocaleString() + ' base');
>>>>>>> prime-system/main
    await logAction('BID ENGINE', 'Price calculated', {
      opportunity_id: opportunityId,
      base_price: result.base,
      escalated_price: result.escalated,
    });
<<<<<<< HEAD

=======
>>>>>>> prime-system/main
  } catch (err) {
    console.error('BID ENGINE ERROR:', err.message);
    await logAction('BID ENGINE', 'Pricing failed', { opportunityId, error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// CALCULATE BID PRICE: Main pricing logic
// Automatically detects if this is a construction or supply bid
// ----------------------------------------------------------
async function calculateBidPrice(opportunityId) {
  const opp = await getOpportunity(opportunityId);

  // Use different pricing models for supply vs construction
  const isSupply = SUPPLY_NAICS.includes(opp.naics);
<<<<<<< HEAD
  if (isSupply) {
    return calculateSupplyPrice(opp);
  }
=======

  if (isSupply) {
    return calculateSupplyPrice(opp);
  }

>>>>>>> prime-system/main
  return calculateConstructionPrice(opp);
}

// ----------------------------------------------------------
// CONSTRUCTION PRICING: Build up costs from scratch
// Labor (Davis-Bacon) + Materials + Mobilization + Bond + Overhead + Profit
// ----------------------------------------------------------
async function calculateConstructionPrice(opp) {
  console.log('BID ENGINE: Using construction pricing model...');

  // Get Davis-Bacon prevailing wage rates for this state
<<<<<<< HEAD
  const wages = await getDavisBaconRates(opp.state, opp.naics);
=======
  const wages     = await getDavisBaconRates(opp.state, opp.naics);
>>>>>>> prime-system/main

  // Estimate material costs based on state (RS Means regional factors)
  const materials = await getMaterialCosts(opp.state, opp.value);

  // Calculate how much it costs to get our crew to the job site
  const mobilization = calcMobilization(opp.state);

  // Bond premium — typically 1-3% of total contract value
  const bondPremium = (opp.value || 500000) * 0.02; // 2% typical

  // Overhead = 15% of labor + materials (covers office, insurance, equipment)
  const overhead = (wages.total + materials.total) * 0.15;

  // Profit = 10% of labor + materials (our target margin)
<<<<<<< HEAD
  const profit = (wages.total + materials.total) * 0.10;
=======
  const profit   = (wages.total + materials.total) * 0.10;
>>>>>>> prime-system/main

  // Base year price (all costs combined)
  const basePrice = wages.total + materials.total + mobilization + bondPremium + overhead + profit;

  // Get number of option years (most federal contracts have 4 option years)
  const optionYears = getOptionYears(opp);

  // Apply annual escalation for each option year
  // Labor goes up 4% per year, materials 3% per year
  let escalated = basePrice;
  const yearlyBreakdown = [{ year: 0, price: basePrice }];
<<<<<<< HEAD
  for (let y = 1; y <= optionYears; y++) {
    const laborEscalation = wages.total * 0.04 * y;
    const materialEscalation = materials.total * 0.03 * y;
    const yearPrice = basePrice + laborEscalation + materialEscalation;
    escalated = yearPrice;
=======

  for (let y = 1; y <= optionYears; y++) {
    const laborEscalation    = wages.total * 0.04 * y;
    const materialEscalation = materials.total * 0.03 * y;
    const yearPrice = basePrice + laborEscalation + materialEscalation;
    escalated = yearPrice; // Final year is highest
>>>>>>> prime-system/main
    yearlyBreakdown.push({ year: y, price: Math.round(yearPrice) });
  }

  return {
    model: 'construction',
    base: Math.round(basePrice),
    escalated: Math.round(escalated),
    total_if_all_years: yearlyBreakdown.reduce((sum, y) => sum + y.price, 0),
    breakdown: {
<<<<<<< HEAD
      wages: Math.round(wages.total),
      materials: Math.round(materials.total),
      mobilization: Math.round(mobilization),
      bond_premium: Math.round(bondPremium),
      overhead: Math.round(overhead),
      profit: Math.round(profit),
=======
      wages:        Math.round(wages.total),
      materials:    Math.round(materials.total),
      mobilization: Math.round(mobilization),
      bond_premium: Math.round(bondPremium),
      overhead:     Math.round(overhead),
      profit:       Math.round(profit),
>>>>>>> prime-system/main
    },
    yearly: yearlyBreakdown,
  };
}

// ----------------------------------------------------------
// SUPPLY PRICING: Material cost + shipping + markup
// First checks for stale pricing — blocks if prices are old
// ----------------------------------------------------------
async function calculateSupplyPrice(opp) {
  console.log('BID ENGINE: Using supply pricing model...');

  // Check for stale prices — if any are older than 14 days, STOP
  const { data: stalePrices } = await supabase
    .from('distributor_prices')
    .select('*')
    .eq('is_stale', true);

  if (stalePrices && stalePrices.length > 0) {
    await logAction('BID ENGINE', 'BLOCKED — stale pricing detected', {
      stale_count: stalePrices.length,
      items: stalePrices.map(p => p.distributor_name),
    });
    throw new Error(
      'BLOCKED: ' + stalePrices.length + ' distributor prices are stale (>14 days). ' +
      'Get fresh quotes before bidding.'
    );
  }

  // Load current distributor prices
  const { data: prices } = await supabase
    .from('distributor_prices')
    .select('*')
    .eq('is_stale', false);

  const materialCost = (prices || []).reduce((sum, p) => sum + (p.unit_price || 0), 0);

  // Add shipping estimate (2% of material cost for regional delivery)
  const shipping = materialCost * 0.02;

  // Add markup (12% for supply contracts)
  const markup = materialCost * 0.12;
<<<<<<< HEAD
=======

>>>>>>> prime-system/main
  const basePrice = materialCost + shipping + markup;

  // Check competitor prices from public bid openings
  const { data: competitorPrices } = await supabase
    .from('competitor_prices')
    .select('bid_amount')
    .eq('is_winner', true)
    .order('recorded_date', { ascending: false })
    .limit(5);

  const avgCompetitorPrice = competitorPrices && competitorPrices.length > 0
    ? competitorPrices.reduce((sum, c) => sum + c.bid_amount, 0) / competitorPrices.length
    : null;

  return {
    model: 'supply',
    base: Math.round(basePrice),
    escalated: Math.round(basePrice), // Supply = no escalation usually
    breakdown: {
      materials: Math.round(materialCost),
<<<<<<< HEAD
      shipping: Math.round(shipping),
      markup: Math.round(markup),
=======
      shipping:  Math.round(shipping),
      markup:    Math.round(markup),
>>>>>>> prime-system/main
    },
    competitor_avg: avgCompetitorPrice ? Math.round(avgCompetitorPrice) : null,
    note: avgCompetitorPrice && basePrice > avgCompetitorPrice
      ? 'WARNING: Our price is above competitor average. Review markup.'
      : 'Price is competitive.',
  };
}

// ----------------------------------------------------------
// DAVIS-BACON WAGES: Get the government prevailing wage for each state/trade
// Required on all federal construction contracts over $2,000
// ----------------------------------------------------------
async function getDavisBaconRates(state, naics) {
  try {
<<<<<<< HEAD
    // Regional prevailing wage estimates by state ($/hr base + fringe)
    // TODO: Add DOL_API_KEY to GitHub Secrets and query live rates
    const estimatedRates = {
      'LA': { hourly: 27, benefits: 8 },  // Walker Contractors home state
      'TX': { hourly: 28, benefits: 8 },
      'MS': { hourly: 24, benefits: 7 },
      'AL': { hourly: 25, benefits: 7 },
      'TN': { hourly: 26, benefits: 8 },
      'FL': { hourly: 27, benefits: 8 },
      'OK': { hourly: 25, benefits: 7 },
=======
    // Use DOL API if available — fallback to estimates if not
    // TODO: Add DOL API key to GitHub Secrets as DOL_API_KEY
    const estimatedRates = {
      'TX': { hourly: 28, benefits: 8 },
      'OK': { hourly: 25, benefits: 7 },
      'LA': { hourly: 27, benefits: 8 },
>>>>>>> prime-system/main
      'AR': { hourly: 24, benefits: 7 },
      'NM': { hourly: 26, benefits: 8 },
    };

    const rate = estimatedRates[state] || { hourly: 30, benefits: 10 };

    // Estimate: 5 workers x 40 hours/week x 26 weeks (6-month project avg)
    const totalHours = 5 * 40 * 26;
    const totalWages = totalHours * (rate.hourly + rate.benefits);

    return {
      hourly_rate: rate.hourly,
      fringe_rate: rate.benefits,
<<<<<<< HEAD
      total_hours: totalHours,
=======
      total_hours:  totalHours,
>>>>>>> prime-system/main
      total: totalWages,
    };
  } catch (err) {
    console.warn('BID ENGINE: Could not get Davis-Bacon rates, using estimate —', err.message);
    return { hourly_rate: 30, fringe_rate: 10, total_hours: 5200, total: 208000 };
  }
}

// ----------------------------------------------------------
// MATERIAL COSTS: Regional cost factors based on RS Means data
// ----------------------------------------------------------
async function getMaterialCosts(state, contractValue) {
  // RS Means regional cost factors (% of national average)
  const regionalFactors = {
<<<<<<< HEAD
    'LA': 0.92,  // Walker home state
    'TX': 0.95,
    'MS': 0.85,
    'AL': 0.87,
    'TN': 0.91,
    'FL': 0.93,
    'OK': 0.88,
    'AR': 0.85,
    'NM': 0.87,
    'CO': 0.98,
=======
    'TX': 0.95, 'OK': 0.88, 'LA': 0.92, 'AR': 0.85,
    'NM': 0.87, 'CO': 0.98, 'KS': 0.89, 'MO': 0.93,
>>>>>>> prime-system/main
  };

  const factor = regionalFactors[state] || 1.0;

  // Estimate materials as 35% of contract value, adjusted for region
  const estimatedValue = contractValue || 500000;
<<<<<<< HEAD
  const materialBase = estimatedValue * 0.35;
=======
  const materialBase   = estimatedValue * 0.35;
>>>>>>> prime-system/main

  return {
    regional_factor: factor,
    total: Math.round(materialBase * factor),
  };
}

// ----------------------------------------------------------
// MOBILIZATION: Cost to move our crew and equipment to the site
<<<<<<< HEAD
// Walker is based in New Orleans — closer sites = lower cost
// ----------------------------------------------------------
function calcMobilization(state) {
  const mobilizationCosts = {
    'LA': 1500,   // Home state — minimal cost
    'MS': 4000,
    'AL': 6000,
    'TX': 7000,
    'FL': 8000,
    'TN': 9000,
    'AR': 7000,
    'OK': 10000,
    'NM': 12000,
    'CO': 15000,
  };
  return mobilizationCosts[state] || 18000;
=======
// The farther the job, the higher the mobilization cost
// ----------------------------------------------------------
function calcMobilization(state) {
  // States we're closest to = lower cost
  const mobilizationCosts = {
    'TX': 2000,  'OK': 5000,  'LA': 8000,  'AR': 7000,
    'NM': 9000,  'CO': 12000, 'KS': 8000,  'MO': 10000,
  };
  return mobilizationCosts[state] || 15000;
>>>>>>> prime-system/main
}

// ----------------------------------------------------------
// OPTION YEARS: How many years the contract can be extended
<<<<<<< HEAD
// Federal construction contracts typically have base + 4 option years
// ----------------------------------------------------------
function getOptionYears(opp) {
  return 4; // Default: base + 4 option years
=======
// Federal contracts typically have a base year + 4 option years
// ----------------------------------------------------------
function getOptionYears(opp) {
  // Default to 4 option years for most federal contracts
  return 4;
>>>>>>> prime-system/main
}

// ----------------------------------------------------------
// HELPER: Get full opportunity record from database
// ----------------------------------------------------------
async function getOpportunity(opportunityId) {
  const { data, error } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', opportunityId)
    .single();

  if (error || !data) throw new Error('Opportunity not found: ' + opportunityId);
  return data;
}

// ----------------------------------------------------------
<<<<<<< HEAD
// FIND DISTRIBUTORS: Cross-reference supplier DB for supply bid pricing
// Instead of guessing at distributor prices, look up matched suppliers
// who have distributor match type for this opportunity
// ----------------------------------------------------------
async function findDistributors(opportunityId) {
  try {
    const { data: matches } = await supabase
      .from('supplier_matches')
      .select('*, suppliers(name, state, naics_codes, avg_contract_value, federal_contract_count, certifications)')
      .eq('opportunity_id', opportunityId)
      .eq('match_type', 'distributor')
      .gte('match_score', 40)
      .order('match_score', { ascending: false })
      .limit(5);

    if (!matches || matches.length === 0) {
      console.log(`BID ENGINE: No distributor matches found for opportunity ${opportunityId} — using market price estimates`);
      return [];
    }

    const distributors = matches.map(m => ({
      name:          m.suppliers?.name || 'Unknown',
      state:         m.suppliers?.state || '',
      match_score:   m.match_score,
      naics_codes:   m.suppliers?.naics_codes || [],
      avg_val:       m.suppliers?.avg_contract_value || 0,
      contracts_won: m.suppliers?.federal_contract_count || 0,
    }));

    console.log(`BID ENGINE: Found ${distributors.length} distributor candidates for opportunity ${opportunityId}`);
    return distributors;

  } catch (err) {
    console.warn('BID ENGINE: findDistributors error —', err.message);
    return [];
  }
}

// Export so DRAFT and other agents can call findDistributors
module.exports = { findDistributors };

// ----------------------------------------------------------
=======
>>>>>>> prime-system/main
// START: Run BID ENGINE when this file is executed
// ----------------------------------------------------------
runBidEngine();
