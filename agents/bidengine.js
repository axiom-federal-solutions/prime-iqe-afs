// =============================================================
// BIDENGINE.JS — Bid Intelligence & Dynamic Engineering Network
// JOB: Calculate the right price for any government construction contract
// SCHEDULE: On-demand — triggered when a bid is approved
// COST: ~$1/month (mostly math, minimal AI)
// PRICING MODEL: Labor (Davis-Bacon) + Materials + Mobilization + Bond + Overhead + Profit
// =============================================================

// Load helper tools
const { supabase, logAction, isAgentEnabled, getConfig } = require('../lib/supabase');

// Walker Contractors LLC / Axiom Federal Solutions HQ — New Orleans, LA
const HQ_LOCATION = { state: 'LA', lat: 29.9511, lng: -90.0715 };

// Supply NAICS codes — pricing is handled differently than construction
const SUPPLY_NAICS = ['424710', '424130', '424490', '424120'];

// DOL Davis-Bacon API for prevailing wages
const DOL_WAGE_URL = 'https://api.dol.gov/V1/SCA/wage-determination';

// Max bids to price in a single batch run — keeps each invocation under
// the GitHub Actions 10-minute timeout and keeps Anthropic spend bounded.
const BATCH_LIMIT = 10;

// ----------------------------------------------------------
// MAIN FUNCTION: Calculate the bid price for one opportunity (CLI mode)
// OR auto-process every bid waiting in 'pending_pricing' (batch mode).
// 2026-05-01 BUG FIX: BID ENGINE was workflow_dispatch-only with a required
// opportunity_id input. JUDGE inserted rows into `bids` with
// status='pending_pricing' but nothing ever picked them up — bids piled up
// forever and DRAFT was starved. Batch mode unblocks the pipeline so a cron
// or workflow_run trigger can drain the queue automatically.
// ----------------------------------------------------------
async function runBidEngine() {
  const opportunityId = process.argv[2];

  // Per-agent kill switch — T.E.S.T. can disable BID ENGINE via system_config.
  // Key resolves to AGENT_BIDENGINE_ENABLED (no space) to match the
  // single-token convention SCOUT/JUDGE/BRANDI use.
  const enabled = await isAgentEnabled('BIDENGINE');
  if (!enabled) process.exit(0);

  if (opportunityId) {
    // ── Single-opportunity mode (manual workflow_dispatch) ────────────
    console.log('BID ENGINE: Single mode — opportunity ' + opportunityId);
    try {
      await priceOneBid(opportunityId);
    } catch (err) {
      console.error('BID ENGINE ERROR:', err.message);
      await logAction('BID ENGINE', 'Pricing failed', { opportunityId, error: err.message });
      process.exit(1);
    }
    return;
  }

  // ── Batch mode (cron / post-JUDGE workflow_run) ────────────────────
  console.log('BID ENGINE: Batch mode — draining pending_pricing queue (limit ' + BATCH_LIMIT + ')');

  const { data: queue, error: queueErr } = await supabase
    .from('bids')
    .select('id, opportunity_id, created_at')
    .eq('status', 'pending_pricing')
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (queueErr) {
    console.error('BID ENGINE: Queue read failed —', queueErr.message);
    await logAction('BID ENGINE', 'Batch queue read failed', { error: queueErr.message });
    process.exit(1);
  }

  if (!queue || queue.length === 0) {
    console.log('BID ENGINE: Queue empty — no bids waiting for pricing.');
    await logAction('BID ENGINE', 'Batch run — queue empty', { checked_at: new Date().toISOString() });
    return;
  }

  console.log('BID ENGINE: ' + queue.length + ' bids in queue. Pricing now...');

  let priced = 0;
  let failed = 0;
  for (const row of queue) {
    try {
      await priceOneBid(row.opportunity_id);
      priced++;
    } catch (err) {
      failed++;
      console.warn('BID ENGINE: Failed bid ' + row.id + ' (opp ' + row.opportunity_id + ') —', err.message);
      // Park the failed bid so it doesn't get retried every batch run.
      // Mr. Kemp can reset to 'pending_pricing' to re-attempt.
      await supabase
        .from('bids')
        .update({ status: 'pricing_failed' })
        .eq('id', row.id);
      await logAction('BID ENGINE', 'Pricing failed (batch)', {
        bid_id:         row.id,
        opportunity_id: row.opportunity_id,
        error:          err.message,
      });
    }
  }

  await logAction('BID ENGINE', 'Batch run complete', {
    checked: queue.length,
    priced,
    failed,
  });
  console.log('BID ENGINE: Batch done — ' + priced + ' priced, ' + failed + ' failed.');
}

// Price a single opportunity and transition the linked bid to 'priced'.
// Extracted from runBidEngine so both single and batch modes share logic.
async function priceOneBid(opportunityId) {
  const result = await calculateBidPrice(opportunityId);

  // Find or create the bid record for this opportunity
  const { data: existingBid } = await supabase
    .from('bids')
    .select('id, status')
    .eq('opportunity_id', opportunityId)
    .single();

  if (existingBid) {
    // 2026-05-01 BUG FIX: previously only updated pricing_data, leaving
    // status='pending_pricing' so the bid would be reprocessed forever and
    // downstream agents (DRAFT, BRANDI) never saw a 'priced' bid.
    await supabase
      .from('bids')
      .update({
        pricing_data: result,
        status:       'priced',
      })
      .eq('id', existingBid.id);
  } else {
    await supabase.from('bids').insert({
      opportunity_id: opportunityId,
      status:         'priced',
      pricing_data:   result,
    });
  }

  console.log('BID ENGINE: Price calculated — $' + result.base.toLocaleString() + ' base');
  await logAction('BID ENGINE', 'Price calculated', {
    opportunity_id:  opportunityId,
    base_price:      result.base,
    escalated_price: result.escalated,
  });
}

// 2026-05-02: vertical detection for pricing — kept simple and self-contained
// so BID ENGINE doesn't need to import scout.js's deriveVertical().
const REAL_ESTATE_NAICS_BID = ['531110','531120','531190','531210','531311','531312','531390','532120','532412'];
const SUPPLY_NAICS_BID      = ['424710','424720','424130','424490','424120','424690','423440','423450','424310','424410','311999','339113','453210','315990','561720'];
function _deriveBidVertical(opp) {
  const v = (opp.vertical || '').toLowerCase();
  if (v === 'realestate' || v === 'supply' || v === 'construction') return v;
  const n = (opp.naics || '').trim();
  if (REAL_ESTATE_NAICS_BID.some(p => n.startsWith(p))) return 'realestate';
  if (SUPPLY_NAICS_BID.some(p => n.startsWith(p)))      return 'supply';
  return 'construction';
}

// ----------------------------------------------------------
// CALCULATE BID PRICE: Main pricing logic
// 2026-05-02: now routes to construction / supply / real estate.
// Previously real estate opps fell through to construction pricing (wrong
// model — federal RE bids use lease offers + property mgmt cost stacks,
// not Davis-Bacon labor).
// ----------------------------------------------------------
async function calculateBidPrice(opportunityId) {
  const opp = await getOpportunity(opportunityId);
  const vertical = _deriveBidVertical(opp);

  let baseResult;
  if (vertical === 'realestate') {
    baseResult = await calculateRealEstatePrice(opp);
  } else if (vertical === 'supply') {
    baseResult = await calculateSupplyPrice(opp);
  } else {
    baseResult = await calculateConstructionPrice(opp);
  }

  // L6-07: If competitor profiles are active, layer in competitive positioning
  const competitorIntelActive = await getConfig('L6_07_COMPETITOR_ACTIVE', 'false');
  if (competitorIntelActive === 'true') {
    const competitorAdjustment = await applyCompetitorPositioning(opp, baseResult);
    return { ...baseResult, ...competitorAdjustment };
  }

  return baseResult;
}

// ----------------------------------------------------------
// CONSTRUCTION PRICING: Build up costs from scratch
// Labor (Davis-Bacon) + Materials + Mobilization + Bond + Overhead + Profit
// ----------------------------------------------------------
async function calculateConstructionPrice(opp) {
  console.log('BID ENGINE: Using construction pricing model...');

  // Get Davis-Bacon prevailing wage rates for this state
  const wages = await getDavisBaconRates(opp.state, opp.naics);

  // Estimate material costs based on state (RS Means regional factors)
  const materials = await getMaterialCosts(opp.state, opp.value);

  // Calculate how much it costs to get our crew to the job site
  const mobilization = calcMobilization(opp.state);

  // Bond premium — typically 1-3% of total contract value
  const bondPremium = (opp.value || 500000) * 0.02; // 2% typical

  // Overhead = 15% of labor + materials (covers office, insurance, equipment)
  const overhead = (wages.total + materials.total) * 0.15;

  // Profit = 10% of labor + materials (our target margin)
  const profit = (wages.total + materials.total) * 0.10;

  // Base year price (all costs combined)
  const basePrice = wages.total + materials.total + mobilization + bondPremium + overhead + profit;

  // Get number of option years (most federal contracts have 4 option years)
  const optionYears = getOptionYears(opp);

  // Apply annual escalation for each option year
  // Labor goes up 4% per year, materials 3% per year
  let escalated = basePrice;
  const yearlyBreakdown = [{ year: 0, price: basePrice }];
  for (let y = 1; y <= optionYears; y++) {
    const laborEscalation = wages.total * 0.04 * y;
    const materialEscalation = materials.total * 0.03 * y;
    const yearPrice = basePrice + laborEscalation + materialEscalation;
    escalated = yearPrice;
    yearlyBreakdown.push({ year: y, price: Math.round(yearPrice) });
  }

  return {
    model: 'construction',
    base: Math.round(basePrice),
    escalated: Math.round(escalated),
    total_if_all_years: yearlyBreakdown.reduce((sum, y) => sum + y.price, 0),
    breakdown: {
      wages: Math.round(wages.total),
      materials: Math.round(materials.total),
      mobilization: Math.round(mobilization),
      bond_premium: Math.round(bondPremium),
      overhead: Math.round(overhead),
      profit: Math.round(profit),
    },
    yearly: yearlyBreakdown,
  };
}

// ----------------------------------------------------------
// SUPPLY PRICING: Material cost + shipping + markup
// 2026-05-02: hardened so an empty distributor_prices table no longer
// produces a $0 bid. Falls back to value-based estimation (35% of contract
// value as material cost, mirroring the construction model) and flags the
// estimate so Mr. Kemp knows to verify before submission.
// ----------------------------------------------------------
async function calculateSupplyPrice(opp) {
  console.log('BID ENGINE: Using supply pricing model...');

  // Check for stale prices on THIS opp's NAICS only — was previously a global
  // block that stopped pricing every supply bid if any one distributor price
  // anywhere was stale. Now scoped so unrelated stale data doesn't block a bid.
  const { data: stalePrices } = await supabase
    .from('distributor_prices')
    .select('*')
    .eq('is_stale', true)
    .eq('naics', opp.naics);

  if (stalePrices && stalePrices.length > 0) {
    await logAction('BID ENGINE', 'BLOCKED — stale pricing for this NAICS', {
      naics: opp.naics,
      stale_count: stalePrices.length,
      items: stalePrices.map(p => p.distributor_name),
    });
    throw new Error(
      'BLOCKED: ' + stalePrices.length + ' distributor prices for NAICS ' + opp.naics +
      ' are stale (>14 days). Get fresh quotes before bidding.'
    );
  }

  // Load current distributor prices for THIS NAICS specifically
  const { data: prices } = await supabase
    .from('distributor_prices')
    .select('*')
    .eq('is_stale', false)
    .eq('naics', opp.naics);

  const haveRealPrices = prices && prices.length > 0;
  let materialCost;
  let estimateNote;

  if (haveRealPrices) {
    materialCost = prices.reduce((sum, p) => sum + (p.unit_price || 0), 0);
    estimateNote = `Material cost from ${prices.length} live distributor quote(s).`;
  } else {
    // 2026-05-02: fallback — no distributor data yet for this NAICS.
    // Use 65% of contract value as estimated material cost (federal supply
    // contracts typically run 60–70% materials, 12% markup, balance shipping).
    // This produces a defensible bid that Mr. Kemp can refine once real
    // distributor quotes are entered into the distributor_prices table.
    const fallbackBase = opp.value || 100000;
    materialCost = Math.round(fallbackBase * 0.65);
    estimateNote = '⚠️ ESTIMATED — no distributor quotes on file for NAICS ' +
      opp.naics + '. Material cost approximated at 65% of contract ceiling. ' +
      'Enter real distributor quotes in distributor_prices table to refine.';
    await logAction('BID ENGINE', 'Supply pricing — distributor data missing', {
      naics: opp.naics,
      opportunity_id: opp.id,
      fallback_base: fallbackBase,
      estimated_material_cost: materialCost,
    });
  }

  // Add shipping estimate (2% of material cost for regional delivery)
  const shipping = Math.round(materialCost * 0.02);

  // Add markup (12% for supply contracts)
  const markup = Math.round(materialCost * 0.12);
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
    base: basePrice,
    escalated: basePrice, // Supply = no escalation usually
    breakdown: {
      materials: materialCost,
      shipping,
      markup,
    },
    pricing_source: haveRealPrices ? 'distributor_quotes' : 'value_based_estimate',
    competitor_avg: avgCompetitorPrice ? Math.round(avgCompetitorPrice) : null,
    note: estimateNote + (avgCompetitorPrice && basePrice > avgCompetitorPrice
      ? ' WARNING: Above competitor average — review markup.'
      : ''),
  };
}

// ----------------------------------------------------------
// REAL ESTATE PRICING — 2026-05-02: NEW
// Federal RE bids fall into four shapes; we route by NAICS:
//   531120 (GSA office lease)         → annual rent × term (5-year typical)
//   531110 (residential/military)     → annual rent × term
//   531190/531210/531390 (advisory)   → service-fee model (hourly + retainer)
//   531311/531312 (property mgmt)     → % of managed value (3–5% federal range)
//   532120/532412 (equipment rental)  → daily/monthly rate × duration
// Without the full RFP attached we estimate; VAULT confirms asset ownership
// before submission (memory: "RE requires manual asset entry to bid").
// ----------------------------------------------------------
async function calculateRealEstatePrice(opp) {
  console.log('BID ENGINE: Using real estate pricing model...');

  const naics = (opp.naics || '').trim();
  const value = opp.value || 0;
  const title = (opp.title || '').toLowerCase();

  // Try to detect lease term from title (1, 3, 5, 10 years are common)
  let termYears = 5; // default — standard GSA office lease
  if (title.includes('10 year') || title.includes('10-year')) termYears = 10;
  else if (title.includes('1 year') || title.includes('annual')) termYears = 1;
  else if (title.includes('3 year') || title.includes('3-year')) termYears = 3;

  let model, base, breakdown, escalated, note;

  // ── LEASE OFFERS — 531110, 531120, 531190 ──
  if (naics.startsWith('5311')) {
    model = 'real_estate_lease';
    // Annual lease rate estimated as contract value / term, with 3% escalation/yr
    const annualRate = value > 0 ? value / termYears : 100000;
    let total = 0;
    const yearly = [];
    for (let y = 0; y < termYears; y++) {
      const yr = Math.round(annualRate * Math.pow(1.03, y));
      yearly.push({ year: y, price: yr });
      total += yr;
    }
    base = Math.round(annualRate);              // year-1 rent
    escalated = Math.round(yearly[yearly.length - 1].price);
    breakdown = {
      annual_base_rent:    base,
      term_years:          termYears,
      escalation_pct:      3,
      total_lifetime_rent: total,
      operating_expenses:  Math.round(annualRate * 0.20), // 20% OpEx (CAM, taxes, insurance)
      tenant_improvement:  Math.round(annualRate * 0.15), // typical TI allowance ask
    };
    note = `Lease offer: ${termYears}-yr term, $${base.toLocaleString()}/yr Year 1 with 3% annual escalation. ` +
           `Total contract value $${total.toLocaleString()}. VAULT must confirm asset ownership before submission.`;
  }

  // ── PROPERTY MANAGEMENT — 531311, 531312 ──
  else if (naics.startsWith('53131')) {
    model = 'real_estate_property_mgmt';
    // PM contracts price as % of managed portfolio value or flat monthly fee
    const managedValue = value > 0 ? value : 1000000;
    const annualFee = Math.round(managedValue * 0.04); // 4% federal PM standard
    base = annualFee;
    escalated = Math.round(annualFee * Math.pow(1.025, termYears - 1));
    breakdown = {
      annual_management_fee: annualFee,
      managed_portfolio_value: managedValue,
      fee_percentage: 4.0,
      term_years: termYears,
      escalation_pct: 2.5,
      monthly_retainer: Math.round(annualFee / 12),
    };
    note = `Property management: 4% of managed portfolio value, ${termYears}-yr term. ` +
           `Includes Trevor Monnie LA Licensed Landscape Horticulturist for grounds compliance.`;
  }

  // ── BROKERAGE/ADVISORY — 531210, 531390 ──
  else if (naics.startsWith('5312') || naics.startsWith('53139')) {
    model = 'real_estate_advisory';
    // Hourly + retainer model — typical for federal advisory
    const hourlyRate = 175;       // senior RE consultant blended rate
    const estimatedHours = value > 0 ? Math.min(value / hourlyRate, 2000) : 500;
    const retainer = Math.round(value > 0 ? value * 0.10 : 25000);
    base = Math.round(retainer + estimatedHours * hourlyRate);
    escalated = base;             // no escalation for advisory
    breakdown = {
      retainer,
      hourly_rate: hourlyRate,
      estimated_hours: Math.round(estimatedHours),
      labor_cost: Math.round(estimatedHours * hourlyRate),
    };
    note = `Advisory services: $${retainer.toLocaleString()} retainer + ${Math.round(estimatedHours)} hrs @ $${hourlyRate}/hr.`;
  }

  // ── EQUIPMENT RENTAL — 532120 (vehicles), 532412 (construction equipment) ──
  else if (naics.startsWith('5321') || naics.startsWith('5324')) {
    model = 'real_estate_rental';
    // Daily rate × duration; 90-day default if not specified in title
    let durationDays = 90;
    if (title.includes('30 day')) durationDays = 30;
    else if (title.includes('60 day')) durationDays = 60;
    else if (title.includes('180 day') || title.includes('6 month')) durationDays = 180;
    else if (title.includes('1 year') || title.includes('annual')) durationDays = 365;

    const dailyRate = value > 0
      ? Math.round(value / durationDays)
      : (naics.startsWith('5324') ? 850 : 175); // construction eq vs vehicle defaults
    base = dailyRate * durationDays;
    escalated = base;
    breakdown = {
      daily_rate: dailyRate,
      duration_days: durationDays,
      mobilization: Math.round(base * 0.05),  // 5% mob
      insurance: Math.round(base * 0.03),     // 3% liability
      fuel_maintenance: Math.round(base * 0.08),
    };
    note = `Equipment rental: $${dailyRate}/day × ${durationDays} days. ` +
           `VAULT must confirm equipment availability before bid submission.`;
  }

  // ── FALLBACK — unknown RE NAICS; use value with margin ──
  else {
    model = 'real_estate_generic';
    base = value > 0 ? Math.round(value * 0.95) : 250000; // bid 5% under ceiling
    escalated = base;
    breakdown = { contract_value: value, our_bid_pct_of_ceiling: 95 };
    note = `Real estate generic: 95% of ceiling value. Refine after RFP review.`;
  }

  return {
    model,
    base: Math.round(base),
    escalated: Math.round(escalated),
    breakdown,
    pricing_source: 'estimated_from_value_and_term',
    note,
  };
}

// ----------------------------------------------------------
// DAVIS-BACON WAGES: Get the government prevailing wage for each state/trade
// Required on all federal construction contracts over $2,000
// ----------------------------------------------------------
async function getDavisBaconRates(state, naics) {
  try {
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
      total_hours: totalHours,
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
  };

  const factor = regionalFactors[state] || 1.0;

  // Estimate materials as 35% of contract value, adjusted for region
  const estimatedValue = contractValue || 500000;
  const materialBase = estimatedValue * 0.35;

  return {
    regional_factor: factor,
    total: Math.round(materialBase * factor),
  };
}

// ----------------------------------------------------------
// MOBILIZATION: Cost to move our crew and equipment to the site
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
}

// ----------------------------------------------------------
// OPTION YEARS: How many years the contract can be extended
// Federal construction contracts typically have base + 4 option years
// ----------------------------------------------------------
function getOptionYears(opp) {
  return 4; // Default: base + 4 option years
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
// L6-07: COMPETITOR POSITIONING
// Runs after base price is calculated. Pulls competitor_profiles for
// any known competitors on this opp's NAICS + geography.
// Outputs a recommended price position and adjustment amount.
// Strategy: undercut low-tier competitors slightly, stay below high-tier.
// ----------------------------------------------------------
async function applyCompetitorPositioning(opp, baseResult) {
  try {
    const naicsPrefix = (opp.naics || '').substring(0, 4);
    const state       = opp.place_of_performance || opp.state || '';
    const basePrice   = baseResult.base || 0;

    if (!basePrice) return {};

    // Find competitor profiles active in this NAICS and geography
    const { data: profiles } = await supabase
      .from('competitor_profiles')
      .select('competitor_name, pricing_tier, avg_bid_value, win_rate_pct, avg_markup_pct, geographic_focus, naics_focus')
      .contains('naics_focus', [opp.naics])  // GIN index match
      .limit(10);

    // Also check geography — include profiles that operate in this state
    const { data: geoProfiles } = await supabase
      .from('competitor_profiles')
      .select('competitor_name, pricing_tier, avg_bid_value, win_rate_pct, avg_markup_pct')
      .contains('geographic_focus', [state])
      .limit(10);

    // Combine and deduplicate by name
    const allProfiles = [...(profiles || []), ...(geoProfiles || [])];
    const seen = new Set();
    const uniqueProfiles = allProfiles.filter(p => {
      if (seen.has(p.competitor_name)) return false;
      seen.add(p.competitor_name);
      return true;
    });

    if (uniqueProfiles.length === 0) {
      return { competitor_intel: { active: true, note: 'No known competitors for this NAICS/geography yet.' } };
    }

    // Analyze the competitive field
    const lowTier  = uniqueProfiles.filter(p => p.pricing_tier === 'low');
    const midTier  = uniqueProfiles.filter(p => p.pricing_tier === 'mid');
    const highTier = uniqueProfiles.filter(p => p.pricing_tier === 'high');

    // Average bid values from profiles for reference
    const avgCompetitorBid = uniqueProfiles
      .filter(p => p.avg_bid_value)
      .reduce((sum, p, _, arr) => sum + p.avg_bid_value / arr.length, 0);

    // Pricing strategy recommendation:
    // - If mostly low-tier competitors: match them, emphasize past performance differentiator
    // - If mostly mid-tier: position 2-3% below mid to win on price without sacrificing margin
    // - If mostly high-tier: stay at our base price — they'll be above us anyway
    let recommendedAdjustment = 0;
    let pricingStrategy = 'hold';

    if (lowTier.length > uniqueProfiles.length * 0.6) {
      // Dominated by low-bidders — match base, compete on qualifications
      pricingStrategy = 'compete_on_quals';
      recommendedAdjustment = 0;
    } else if (midTier.length >= lowTier.length) {
      // Mid-tier field — cut 2% to gain edge
      pricingStrategy = 'slight_undercut';
      recommendedAdjustment = -(basePrice * 0.02);
    } else {
      // High-tier heavy — our base price is already competitive
      pricingStrategy = 'hold_position';
      recommendedAdjustment = 0;
    }

    const adjustedPrice = Math.round(basePrice + recommendedAdjustment);

    await logAction('BID ENGINE', 'L6-07 Competitor positioning applied', {
      opportunity_id:        opp.id,
      competitors_found:     uniqueProfiles.length,
      low_tier_count:        lowTier.length,
      mid_tier_count:        midTier.length,
      high_tier_count:       highTier.length,
      pricing_strategy:      pricingStrategy,
      base_price:            basePrice,
      adjusted_price:        adjustedPrice,
      adjustment:            Math.round(recommendedAdjustment),
    });

    return {
      adjusted_price: adjustedPrice,
      competitor_intel: {
        active:               true,
        competitors_analyzed: uniqueProfiles.length,
        low_tier:             lowTier.map(p => p.competitor_name),
        mid_tier:             midTier.map(p => p.competitor_name),
        high_tier:            highTier.map(p => p.competitor_name),
        pricing_strategy:     pricingStrategy,
        recommended_price:    adjustedPrice,
        avg_competitor_bid:   avgCompetitorBid ? Math.round(avgCompetitorBid) : null,
        note: pricingStrategy === 'compete_on_quals'
          ? 'Low-tier field dominates — hold price, emphasize SDB cert and past performance.'
          : pricingStrategy === 'slight_undercut'
          ? 'Mid-tier field — priced 2% below competition for edge without sacrificing margin.'
          : 'High-tier field — base price is already competitive. No adjustment needed.',
      },
    };

  } catch (err) {
    console.warn('BID ENGINE L6-07: Competitor positioning failed —', err.message);
    return {};
  }
}

// ----------------------------------------------------------
// START: Run BID ENGINE when this file is executed
// ----------------------------------------------------------
runBidEngine();
