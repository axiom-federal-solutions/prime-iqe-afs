// =============================================================
// BIDENGINE.JS — Bid Intelligence & Dynamic Engineering Network
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

    // Save the pricing to the bids table
    await supabase
      .from('bids')
      .update({ pricing_data: result })
      .eq('opportunity_id', opportunityId);

    console.log('BID ENGINE: Price calculated — $' + result.base.toLocaleString() + ' base');
    await logAction('BID ENGINE', 'Price calculated', {
      opportunity_id: opportunityId,
      base_price: result.base,
      escalated_price: result.escalated,
    });
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

  if (isSupply) {
    return calculateSupplyPrice(opp);
  }

  return calculateConstructionPrice(opp);
}

// ----------------------------------------------------------
// CONSTRUCTION PRICING: Build up costs from scratch
// Labor (Davis-Bacon) + Materials + Mobilization + Bond + Overhead + Profit
// ----------------------------------------------------------
async function calculateConstructionPrice(opp) {
  console.log('BID ENGINE: Using construction pricing model...');

  // Get Davis-Bacon prevailing wage rates for this state
  const wages     = await getDavisBaconRates(opp.state, opp.naics);

  // Estimate material costs based on state (RS Means regional factors)
  const materials = await getMaterialCosts(opp.state, opp.value);

  // Calculate how much it costs to get our crew to the job site
  const mobilization = calcMobilization(opp.state);

  // Bond premium — typically 1-3% of total contract value
  const bondPremium = (opp.value || 500000) * 0.02; // 2% typical

  // Overhead = 15% of labor + materials (covers office, insurance, equipment)
  const overhead = (wages.total + materials.total) * 0.15;

  // Profit = 10% of labor + materials (our target margin)
  const profit   = (wages.total + materials.total) * 0.10;

  // Base year price (all costs combined)
  const basePrice = wages.total + materials.total + mobilization + bondPremium + overhead + profit;

  // Get number of option years (most federal contracts have 4 option years)
  const optionYears = getOptionYears(opp);

  // Apply annual escalation for each option year
  // Labor goes up 4% per year, materials 3% per year
  let escalated = basePrice;
  const yearlyBreakdown = [{ year: 0, price: basePrice }];

  for (let y = 1; y <= optionYears; y++) {
    const laborEscalation    = wages.total * 0.04 * y;
    const materialEscalation = materials.total * 0.03 * y;
    const yearPrice = basePrice + laborEscalation + materialEscalation;
    escalated = yearPrice; // Final year is highest
    yearlyBreakdown.push({ year: y, price: Math.round(yearPrice) });
  }

  return {
    model: 'construction',
    base: Math.round(basePrice),
    escalated: Math.round(escalated),
    total_if_all_years: yearlyBreakdown.reduce((sum, y) => sum + y.price, 0),
    breakdown: {
      wages:        Math.round(wages.total),
      materials:    Math.round(materials.total),
      mobilization: Math.round(mobilization),
      bond_premium: Math.round(bondPremium),
      overhead:     Math.round(overhead),
      profit:       Math.round(profit),
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
      shipping:  Math.round(shipping),
      markup:    Math.round(markup),
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
    // Use DOL API if available — fallback to estimates if not
    // TODO: Add DOL API key to GitHub Secrets as DOL_API_KEY
    const estimatedRates = {
      'TX': { hourly: 28, benefits: 8 },
      'OK': { hourly: 25, benefits: 7 },
      'LA': { hourly: 27, benefits: 8 },
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
      total_hours:  totalHours,
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
    'TX': 0.95, 'OK': 0.88, 'LA': 0.92, 'AR': 0.85,
    'NM': 0.87, 'CO': 0.98, 'KS': 0.89, 'MO': 0.93,
  };

  const factor = regionalFactors[state] || 1.0;

  // Estimate materials as 35% of contract value, adjusted for region
  const estimatedValue = contractValue || 500000;
  const materialBase   = estimatedValue * 0.35;

  return {
    regional_factor: factor,
    total: Math.round(materialBase * factor),
  };
}

// ----------------------------------------------------------
// MOBILIZATION: Cost to move our crew and equipment to the site
// The farther the job, the higher the mobilization cost
// ----------------------------------------------------------
function calcMobilization(state) {
  // States we're closest to = lower cost
  const mobilizationCosts = {
    'TX': 2000,  'OK': 5000,  'LA': 8000,  'AR': 7000,
    'NM': 9000,  'CO': 12000, 'KS': 8000,  'MO': 10000,
  };
  return mobilizationCosts[state] || 15000;
}

// ----------------------------------------------------------
// OPTION YEARS: How many years the contract can be extended
// Federal contracts typically have a base year + 4 option years
// ----------------------------------------------------------
function getOptionYears(opp) {
  // Default to 4 option years for most federal contracts
  return 4;
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
// START: Run BID ENGINE when this file is executed
// ----------------------------------------------------------
runBidEngine();
