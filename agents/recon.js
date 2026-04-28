// =============================================================
// RECON.JS — Market Intelligence Coordinator
// JOB: Gather competitive intelligence beyond SAM.gov:
//      - Congressional spending bills (federal construction budget intel)
//      - GAO protest database (avoid projects that get protested repeatedly)
//      - CPARS ratings of competitors (understand who we're bidding against)
//      - OSDBU (small business office) relationship building
//      - FPDS competitor analysis (who won similar contracts before?)
//      - NOAA weather alerts (Louisiana construction risk)
//      - Revenue concentration risk (are we too dependent on one agency?)
// SCHEDULE: Weekly Sunday 10 PM CT + after any STRONG BID alert
// COST: ~$0.50/month (minimal Haiku usage for congressional intel summaries)
// =============================================================

const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');
const { fetchJSON, fetchText } = require('../lib/fetch-retry');

// Our geographic focus — Gulf South region
const TARGET_STATES = ['LA','MS','TX','AL','GA','FL','TN'];
const HOME_STATE    = 'LA';

// NOAA API for Gulf South weather that could affect construction projects
const NOAA_API   = 'https://api.weather.gov/alerts/active?area=';
const FPDS_API   = 'https://api.fpds.gov/web/feeds/awards.atom';

// Congressional spending keywords relevant to federal construction
const CONSTRUCTION_BILLS = ['infrastructure', 'construction', 'military construction', 'VA facilities', 'federal buildings', 'MILCON'];

// Revenue concentration threshold — alert if > 80% comes from one agency
const CONCENTRATION_THRESHOLD = 0.80;

// ----------------------------------------------------------
// MAIN: Run all RECON sub-tasks
// ----------------------------------------------------------
async function runRecon() {
  console.log('RECON: Starting intelligence gathering...');

  const enabled = await isAgentEnabled('RECON');
  if (!enabled) process.exit(0);

  const results = {};

  try {
    // Run all intel tasks — order matters (FPDS first so CO data is ready for others)
    console.log('RECON: Scanning FPDS for competitor awards...');
    results.fpds = await scanFPDSCompetitors();

    console.log('RECON: Checking GAO protest database...');
    results.gao = await checkGAOProtests();

    console.log('RECON: Pulling NOAA weather alerts for Gulf South...');
    results.weather = await checkWeatherAlerts();

    console.log('RECON: Checking revenue concentration risk...');
    results.concentration = await checkRevenueConcentration();

    console.log('RECON: Scanning for OSDBU events and matchmaking...');
    results.osdbu = await scanOSDBUEvents();

    console.log('RECON: Analyzing active contract pipeline...');
    results.pipeline = await analyzePipeline();

    await logAction('RECON', 'Weekly intelligence run complete', {
      fpds_competitors:     results.fpds?.competitors_found || 0,
      gao_protests:         results.gao?.protests_found || 0,
      weather_alerts:       results.weather?.alerts || 0,
      concentration_risk:   results.concentration?.risk_level || 'LOW',
      ran_at:               new Date().toISOString(),
    });

    console.log('RECON: Complete. Intelligence saved to database.');

  } catch (err) {
    console.error('RECON ERROR:', err.message);
    await logAction('RECON', 'Intelligence run failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// FPDS COMPETITOR SCAN: Who won contracts similar to ours?
// FPDS = Federal Procurement Data System — public database of all federal awards
// We use this to understand who we're up against on similar contracts
// ----------------------------------------------------------
async function scanFPDSCompetitors() {
  const foundCompetitors = [];

  try {
    // Search FPDS for recent awards in our construction NAICS in Gulf South
    const naicsCodes = ['236220', '238210', '237990'];

    for (const naics of naicsCodes) {
      const url = FPDS_API + '?NAICS_CODE:' + naics + '&PLACE_OF_PERFORMANCE_STATE_CODE:LA&LAST_MODIFIED_DATE:[NOW-365DAYS TO NOW]&max-records=25';

      try {
        const text = await fetchText(url, {
          headers: { 'Accept': 'application/atom+xml' },
        });

        // Parse basic info from the Atom XML response
        const entries = extractFPDSEntries(text);
        foundCompetitors.push(...entries);

        // Save competitor data to database
        for (const entry of entries) {
          await supabase.from('competitor_intel').upsert({
            company_name:  entry.vendor,
            naics:         naics,
            award_value:   entry.value,
            award_date:    entry.date,
            agency:        entry.agency,
            state:         'LA',
            source:        'FPDS',
            updated_at:    new Date().toISOString(),
          }, { onConflict: 'company_name,naics,award_date' });
        }

      } catch (err) {
        console.warn('RECON: FPDS query failed for NAICS ' + naics + ' —', err.message);
      }
    }

  } catch (err) {
    console.warn('RECON: FPDS scan error —', err.message);
  }

  return { competitors_found: foundCompetitors.length, competitors: foundCompetitors };
}

// ----------------------------------------------------------
// GAO PROTEST CHECK: Has this type of contract been protested before?
// Protested contracts = wasted proposal effort if we win and a competitor protests
// We log protest patterns so JUDGE can factor them into scoring
// ----------------------------------------------------------
async function checkGAOProtests() {
  let protestsFound = 0;

  try {
    // GAO Decisions database — public access via web
    const gaoUrl = 'https://www.gao.gov/legal/bid-protests/search?term=construction&type=protest&status=sustained&from_date=2024-01-01';

    const html = await fetchText(gaoUrl, {
      headers: { 'User-Agent': 'PRIME Federal Contracting Intelligence System' },
    });

    // Count mentions of construction-related protests
    const constructionMentions = (html.match(/construction|renovation|repair facility/gi) || []).length;
    protestsFound = constructionMentions;

    // Save protest intelligence
    await supabase.from('system_config').upsert({
      key:   'RECON_GAO_LAST_CHECK',
      value: JSON.stringify({
        checked_at:    new Date().toISOString(),
        mentions:      constructionMentions,
        note:          'Manual review recommended for high-value construction bids — check GAO for specific solicitation protests',
      }),
    }, { onConflict: 'key' });

  } catch (err) {
    console.warn('RECON: GAO protest check failed —', err.message);
  }

  return { protests_found: protestsFound };
}

// ----------------------------------------------------------
// WEATHER ALERTS: NOAA API — Gulf South severe weather
// Active hurricanes, flooding, or extreme heat affect construction timelines
// We factor weather risk into bid pricing and scheduling
// ----------------------------------------------------------
async function checkWeatherAlerts() {
  let alertCount  = 0;
  const alerts    = [];

  for (const state of ['LA', 'MS', 'TX', 'AL', 'FL']) {
    try {
      const data = await fetchJSON(NOAA_API + state, {
        headers: { 'User-Agent': 'PRIME Federal Contracting System (PrimeOpps1@gmail.com)' },
      });

      const activeAlerts = (data?.features || []).filter(f => {
        const event = f.properties?.event || '';
        // Only care about severe weather that impacts construction
        return ['Hurricane','Tropical Storm','Flash Flood','Tornado','Severe Thunderstorm','Extreme Heat'].some(e => event.includes(e));
      });

      if (activeAlerts.length > 0) {
        alertCount += activeAlerts.length;
        alerts.push({ state, count: activeAlerts.length, events: activeAlerts.map(a => a.properties?.event) });

        // Save to database for BRANDI to include in morning brief
        await supabase.from('system_config').upsert({
          key:   'RECON_WEATHER_ALERTS_' + state,
          value: JSON.stringify({ state, alerts: activeAlerts.slice(0, 3), updated_at: new Date().toISOString() }),
        }, { onConflict: 'key' });
      }

    } catch (err) {
      console.warn('RECON: NOAA alert check failed for ' + state + ' —', err.message);
    }
  }

  console.log('RECON: ' + alertCount + ' severe weather alerts found across Gulf South states');
  return { alerts: alertCount, details: alerts };
}

// ----------------------------------------------------------
// REVENUE CONCENTRATION: Are we too dependent on one federal agency?
// If one agency is > 80% of active contract value, that's a risk
// Federal clients can cancel or cut funding — concentration = vulnerability
// ----------------------------------------------------------
async function checkRevenueConcentration() {
  try {
    const { data: contracts } = await supabase
      .from('active_contracts')
      .select('agency, value')
      .eq('status', 'active');

    if (!contracts || contracts.length === 0) {
      return { risk_level: 'LOW', reason: 'No active contracts to analyze' };
    }

    const totalValue = contracts.reduce((sum, c) => sum + (c.value || 0), 0);
    const byAgency   = {};

    for (const c of contracts) {
      byAgency[c.agency] = (byAgency[c.agency] || 0) + (c.value || 0);
    }

    // Find the largest single agency concentration
    let maxAgency = null;
    let maxValue  = 0;
    for (const [agency, value] of Object.entries(byAgency)) {
      if (value > maxValue) {
        maxValue  = value;
        maxAgency = agency;
      }
    }

    const concentrationPct = totalValue > 0 ? maxValue / totalValue : 0;
    const riskLevel = concentrationPct >= CONCENTRATION_THRESHOLD ? 'HIGH' : concentrationPct >= 0.60 ? 'MEDIUM' : 'LOW';

    const result = {
      risk_level:       riskLevel,
      top_agency:       maxAgency,
      top_agency_pct:   (concentrationPct * 100).toFixed(0) + '%',
      total_value:      totalValue,
      agencies:         Object.keys(byAgency).length,
    };

    await supabase.from('system_config').upsert({
      key:   'RECON_CONCENTRATION_RISK',
      value: JSON.stringify({ ...result, updated_at: new Date().toISOString() }),
    }, { onConflict: 'key' });

    if (riskLevel === 'HIGH') {
      console.warn('RECON: HIGH concentration risk — ' + concentrationPct.toFixed(0) + '% of revenue from ' + maxAgency);
      await logAction('RECON', 'HIGH revenue concentration risk detected', result);
    }

    return result;

  } catch (err) {
    console.warn('RECON: Concentration check failed —', err.message);
    return { risk_level: 'UNKNOWN', error: err.message };
  }
}

// ----------------------------------------------------------
// OSDBU EVENTS: Small Business Office matchmaking events
// OSDBU = Office of Small and Disadvantaged Business Utilization
// These events let small businesses meet federal contracting officers
// Walker qualifies as SDB — these are prime networking opportunities
// ----------------------------------------------------------
async function scanOSDBUEvents() {
  let found = 0;

  try {
    // SBA.gov events page — matchmaking and procurement conferences
    const html = await fetchText('https://www.sba.gov/events', {
      headers: { 'User-Agent': 'PRIME Federal Contracting Intelligence System' },
    });

    const eventKeywords = ['matchmaking', 'small business day', 'procurement conference', 'outreach', 'vendor fair'];
    const relevantEvents = eventKeywords.filter(kw => html.toLowerCase().includes(kw)).length;

    if (relevantEvents > 0) {
      await logAction('RECON', 'OSDBU/SBA events detected — manual review recommended', {
        url: 'https://www.sba.gov/events',
        action: 'Visit SBA.gov to find upcoming small business matchmaking events for Gulf South region',
        relevant_mentions: relevantEvents,
      });
      found = relevantEvents;
    }

  } catch (err) {
    console.warn('RECON: OSDBU scan failed —', err.message);
  }

  return { events_found: found };
}

// ----------------------------------------------------------
// PIPELINE ANALYSIS: Review our current active contract pipeline
// Are we over capacity? Under capacity? What's the revenue forecast?
// ----------------------------------------------------------
async function analyzePipeline() {
  try {
    const { data: active } = await supabase
      .from('active_contracts')
      .select('*')
      .eq('status', 'active');

    const { data: pending } = await supabase
      .from('bids')
      .select('*, opportunities(*)')
      .in('status', ['draft_ready', 'submitted', 'pending_review']);

    const activeCount    = (active || []).length;
    const activeValue    = (active || []).reduce((sum, c) => sum + (c.value || 0), 0);
    const pendingCount   = (pending || []).length;
    const pendingValue   = (pending || []).reduce((sum, b) => sum + (b.opportunities?.value || 0), 0);

    const pipelineData = {
      active_contracts:   activeCount,
      active_value:       activeValue,
      pending_bids:       pendingCount,
      pending_value:      pendingValue,
      total_pipeline:     activeValue + pendingValue,
      analyzed_at:        new Date().toISOString(),
    };

    await supabase.from('system_config').upsert({
      key:   'RECON_PIPELINE_SNAPSHOT',
      value: JSON.stringify(pipelineData),
    }, { onConflict: 'key' });

    return pipelineData;

  } catch (err) {
    console.warn('RECON: Pipeline analysis failed —', err.message);
    return {};
  }
}

// ----------------------------------------------------------
// HELPERS: Parse FPDS XML entries (basic text extraction)
// ----------------------------------------------------------
function extractFPDSEntries(xml) {
  const entries = [];
  const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  for (const entry of entryMatches.slice(0, 25)) {
    try {
      const vendor = extractXmlValue(entry, 'title') || 'Unknown Vendor';
      const date   = extractXmlValue(entry, 'updated') || '';

      entries.push({
        vendor:  vendor.replace(/<[^>]+>/g, '').trim().substring(0, 100),
        date:    date.split('T')[0],
        value:   null,   // FPDS Atom doesn't always include dollar values in title
        agency:  extractXmlValue(entry, 'AGENCY_NAME') || 'Unknown Agency',
      });
    } catch (err) {
      // Skip malformed entries
    }
  }

  return entries;
}

function extractXmlValue(xml, tag) {
  const match = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>'));
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : null;
}

// ----------------------------------------------------------
// SUPPLIER INTELLIGENCE: Scan free government APIs for subs/partners
// 3 sources: SAM.gov Entity API, SBA Dynamic Search, USAspending
// Called by recon-supplier-scan.yml (weekly Monday 03:00 CT)
// Also called after JUDGE scores a new opportunity (matching only)
// ----------------------------------------------------------

// Adjacent state network for location scoring (Gulf Coast focus)
const ADJACENT_STATES = {
  LA: ['MS','TX','AR'],
  MS: ['LA','TN','AL'],
  TX: ['LA','OK','NM'],
  AL: ['MS','TN','GA','FL'],
  GA: ['FL','TN','SC','NC'],
  FL: ['AL','GA'],
  TN: ['MS','AL','GA','KY','MO'],
};

// 5-factor match score weights
const MATCH_WEIGHTS = {
  naics:    0.30,  // NAICS match
  cert:     0.25,  // Certification match to set-aside
  location: 0.20,  // Geographic proximity
  experience: 0.15, // Past federal contract history
  capacity: 0.10,  // Company size fits the role
};

// Minimum score to store a match (below this = noise)
const MIN_MATCH_SCORE = 40;

// ----------------------------------------------------------
// SCAN SUPPLIERS: Pull registered contractors from SAM.gov Entity API
// Uses the SAME API key as SCOUT — no additional cost
// ----------------------------------------------------------
async function scanSuppliers() {
  const samKey = process.env.SAM_API_KEY;
  if (!samKey) {
    console.warn('RECON: SAM_API_KEY not set — skipping supplier scan');
    return 0;
  }

  // NAICS codes we want subs for — focus on construction subtrades
  const subNAICS = ['238110','238210','238220','238310','238320','238330','238910','562910','237310'];
  let totalSaved = 0;

  for (const naics of subNAICS) {
    try {
      const url = `https://api.sam.gov/entity-information/v3/entities?api_key=${samKey}&naicsCode=${naics}&entityStatus=Active&purposeOfRegistrationCode=Z2&limit=50`;

      const data = await fetchJSON(url, {
        headers: { 'User-Agent': 'PRIME-IQE-RECON/1.0', 'Accept': 'application/json' },
      });

      const entities = data?.entityData || [];
      console.log(`RECON: SAM Entity API NAICS ${naics} — ${entities.length} suppliers found`);

      for (const entity of entities) {
        const saved = await upsertSupplier(entity, naics);
        if (saved) totalSaved++;
      }

      // Respect rate limits
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.warn(`RECON: Supplier scan error for NAICS ${naics} —`, err.message);
    }
  }

  await logAction('RECON', 'Supplier scan complete', { suppliers_saved: totalSaved });
  return totalSaved;
}

// ----------------------------------------------------------
// ENRICH FROM SBA: Add certification status from SBA Dynamic Small Business Search
// No API key required — public endpoint
// ----------------------------------------------------------
async function enrichFromSBA() {
  const SBA_API = 'https://api.sba.gov/sb_profiles/v3/search?';

  // Get suppliers that haven't been SBA-enriched recently
  let suppliers = [];
  try {
    const { data } = await supabase
      .from('suppliers')
      .select('id, uei, name, state')
      .is('sba_enriched_at', null)
      .limit(50);
    suppliers = data || [];
  } catch (err) {
    console.warn('RECON: suppliers table not available —', err.message);
    return 0;
  }

  if (!suppliers || suppliers.length === 0) return 0;

  let enriched = 0;
  for (const supplier of suppliers) {
    try {
      const params = new URLSearchParams({
        name:  supplier.name.substring(0, 30),
        state: supplier.state || '',
      });

      const data = await fetchJSON(SBA_API + params.toString(), {
        headers: { 'Accept': 'application/json' },
      });

      const match = data?.businesses?.[0];
      if (match) {
        const certs = [];
        if (match['8a_certified'])     certs.push('8(a)');
        if (match['hubzone_certified']) certs.push('HUBZone');
        if (match['women_owned'])       certs.push('WOSB');
        if (match['veteran_owned'])     certs.push('VOSB');
        if (match['service_disabled'])  certs.push('SDVOSB');

        try {
          await supabase.from('suppliers').update({
            certifications:    certs,
            socioeconomic:     certs,
            sba_enriched_at:   new Date().toISOString(),
          }).eq('id', supplier.id);
        } catch (updateErr) {
          console.warn(`RECON: suppliers update failed —`, updateErr.message);
        }

        enriched++;
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.warn(`RECON: SBA enrichment failed for ${supplier.name} —`, err.message);
    }
  }

  console.log(`RECON: SBA enrichment complete — ${enriched} suppliers updated`);
  return enriched;
}

// ----------------------------------------------------------
// ENRICH FROM USASPENDING: Add actual federal contract performance history
// No API key required — public government data
// ----------------------------------------------------------
async function enrichFromUSAspending() {
  let suppliers = [];
  try {
    const { data } = await supabase
      .from('suppliers')
      .select('id, uei, name')
      .is('usaspending_enriched_at', null)
      .not('uei', 'is', null)
      .limit(30);
    suppliers = data || [];
  } catch (err) {
    console.warn('RECON: suppliers table not available —', err.message);
    return 0;
  }

  if (!suppliers || suppliers.length === 0) return 0;

  let enriched = 0;
  for (const supplier of suppliers) {
    try {
      const url = 'https://api.usaspending.gov/api/v2/recipient/duns/';
      const data = await fetchJSON(`${url}${supplier.uei}/`, {
        headers: { 'Accept': 'application/json' },
      });

      if (data) {
        try {
          await supabase.from('suppliers').update({
            federal_contract_count:  data.total_transaction_count || 0,
            avg_contract_value:      data.total_obligations ? data.total_obligations / Math.max(data.total_transaction_count || 1, 1) : 0,
            agencies_worked:         data.top_five_award_types?.length || 0,
            usaspending_enriched_at: new Date().toISOString(),
          }).eq('id', supplier.id);
        } catch (updateErr) {
          console.warn(`RECON: suppliers update failed —`, updateErr.message);
        }

        enriched++;
      }

      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      // USAspending errors are common for new vendors — just skip
    }
  }

  console.log(`RECON: USAspending enrichment complete — ${enriched} suppliers updated`);
  return enriched;
}

// ----------------------------------------------------------
// MATCH SUPPLIERS TO OPPORTUNITY: Calculate 5-factor match score
// Stores top 10 matches per opportunity in supplier_matches table
// ----------------------------------------------------------
async function matchSuppliersToOpportunity(opportunityId) {
  // Load the opportunity
  const { data: opp } = await supabase
    .from('opportunities')
    .select('id, naics, set_aside, place_of_performance, value, title')
    .eq('id', opportunityId)
    .single();

  if (!opp) return 0;

  // Load all active suppliers
  let suppliers = [];
  try {
    const { data } = await supabase
      .from('suppliers')
      .select('*')
      .eq('status', 'active')
      .limit(500);
    suppliers = data || [];
  } catch (err) {
    console.warn('RECON: suppliers table not available —', err.message);
    return 0;
  }

  if (!suppliers || suppliers.length === 0) return 0;

  const matches = [];

  for (const supplier of suppliers) {
    const score = calcMatchScore(supplier, opp);
    if (score >= MIN_MATCH_SCORE) {
      const matchType = determineMatchType(supplier, opp);
      matches.push({ supplier, score, matchType });
    }
  }

  // Sort by score, keep top 10
  matches.sort((a, b) => b.score - a.score);
  const top10 = matches.slice(0, 10);

  // Upsert top 10 into supplier_matches
  for (const match of top10) {
    try {
      await supabase.from('supplier_matches').upsert({
        opportunity_id:  opp.id,
        supplier_id:     match.supplier.id,
        match_score:     match.score,
        match_type:      match.matchType,
        score_breakdown: calcMatchBreakdown(match.supplier, opp),
        created_at:      new Date().toISOString(),
      }, { onConflict: 'opportunity_id,supplier_id' });
    } catch (err) {
      console.warn('RECON: supplier_matches upsert failed —', err.message);
    }
  }

  console.log(`RECON: Opportunity ${opportunityId} — ${top10.length} supplier matches stored`);
  return top10.length;
}

// ----------------------------------------------------------
// MATCH ALL NEW OPPORTUNITIES: Run matching for all recently scored opps
// Called automatically after supplier scan completes
// ----------------------------------------------------------
async function matchAllNewOpportunities() {
  const { data: opps } = await supabase
    .from('opportunities')
    .select('id')
    .in('status', ['scored', 'STRONG_BID', 'BID', 'CONDITIONAL'])
    .gte('scored_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(50);

  if (!opps || opps.length === 0) return;

  let matched = 0;
  for (const opp of opps) {
    const count = await matchSuppliersToOpportunity(opp.id);
    matched += count;
    await new Promise(r => setTimeout(r, 200));
  }

  await logAction('RECON', 'Supplier matching complete', { opportunities_matched: opps.length, total_matches: matched });
}

// ----------------------------------------------------------
// CALC MATCH SCORE: 5-factor scoring (0-100)
// ----------------------------------------------------------
function calcMatchScore(supplier, opp) {
  const naicsScore    = scoreNaicsMatch(supplier, opp);
  const certScore     = scoreCertMatch(supplier, opp);
  const locationScore = scoreLocationMatch(supplier, opp);
  const expScore      = scoreExperienceMatch(supplier, opp);
  const capScore      = scoreCapacityMatch(supplier, opp);

  return Math.round(
    naicsScore    * MATCH_WEIGHTS.naics    +
    certScore     * MATCH_WEIGHTS.cert     +
    locationScore * MATCH_WEIGHTS.location +
    expScore      * MATCH_WEIGHTS.experience +
    capScore      * MATCH_WEIGHTS.capacity
  );
}

function calcMatchBreakdown(supplier, opp) {
  return {
    naics:      scoreNaicsMatch(supplier, opp),
    cert:       scoreCertMatch(supplier, opp),
    location:   scoreLocationMatch(supplier, opp),
    experience: scoreExperienceMatch(supplier, opp),
    capacity:   scoreCapacityMatch(supplier, opp),
  };
}

function scoreNaicsMatch(supplier, opp) {
  const supplierNaics = supplier.naics_codes || [];
  // Direct match = 100
  if (supplierNaics.includes(opp.naics)) return 100;
  // Adjacent match (first 4 digits match) = 50
  const oppPrefix = opp.naics?.substring(0, 4);
  if (supplierNaics.some(n => n.substring(0, 4) === oppPrefix)) return 50;
  return 0;
}

function scoreCertMatch(supplier, opp) {
  const sa = (opp.set_aside || '').toUpperCase();
  const certs = supplier.certifications || [];

  if (!sa || sa === 'NONE' || sa === 'SBP') return 60;  // Open — any supplier qualifies
  if (sa === 'SDB'  && certs.some(c => c.includes('SDB') || c.includes('8(a)'))) return 100;
  if (sa === '8A'   && certs.includes('8(a)')) return 100;
  if (sa === 'HZC'  && certs.includes('HUBZone')) return 100;
  if (sa === 'WOSB' && certs.includes('WOSB')) return 100;
  if (sa === 'SDVOSBC' && certs.includes('SDVOSB')) return 100;
  if (certs.length > 0) return 40;  // Has some cert but wrong one
  return 20;
}

function scoreLocationMatch(supplier, opp) {
  const suppState = supplier.state || '';
  const oppState  = opp.place_of_performance || '';

  if (!suppState || !oppState) return 40;
  if (suppState === oppState) return 100;  // Same state = best

  const adjacent = ADJACENT_STATES[oppState] || [];
  if (adjacent.includes(suppState)) return 50;  // Adjacent state

  return 10;  // Remote
}

function scoreExperienceMatch(supplier, opp) {
  const avgValue  = supplier.avg_contract_value || 0;
  const oppValue  = opp.value || 0;

  if (!oppValue) return 50;

  // Ideal: supplier's average contract is at least 25% of opp value
  if (avgValue >= oppValue * 0.25) return 100;
  if (avgValue >= oppValue * 0.10) return 60;
  if (supplier.federal_contract_count > 0) return 40;
  return 20;  // No federal history
}

function scoreCapacityMatch(supplier, opp) {
  // Use company size standard as a proxy for capacity
  const tier = (supplier.capability_tier || 'small').toLowerCase();
  if (tier === 'large') return 60;   // Too big for sub role usually
  if (tier === 'mid')   return 90;
  if (tier === 'small') return 100;  // Perfect for sub/teaming
  return 70;
}

// ----------------------------------------------------------
// DETERMINE MATCH TYPE: What is the relationship with the supplier?
// sub = subcontractor, teaming = teaming partner, distributor = supply, mentor_protege = joint bid
// ----------------------------------------------------------
function determineMatchType(supplier, opp) {
  const oppNaics = opp.naics || '';
  const certs    = supplier.certifications || [];
  const oppValue = opp.value || 0;

  // Supply vertical — distributors
  if (['424710','424130','424490','424120','424690','423440','424310'].includes(oppNaics)) {
    return 'distributor';
  }

  // If supplier has a cert Walker needs (like 8(a)) and opp is big — potential mentor-protégé
  const sa = (opp.set_aside || '').toUpperCase();
  if (oppValue > 1000000 && certs.length > 0 && sa === 'NONE') {
    return 'mentor_protege';
  }

  // Has special set-aside cert Walker lacks
  if (['8(a)','HUBZone','WOSB'].some(c => certs.includes(c))) {
    return 'teaming';
  }

  // Default: subcontractor
  return 'sub';
}

// ----------------------------------------------------------
// UPSERT SUPPLIER: Save a SAM Entity record to the suppliers table
// ----------------------------------------------------------
async function upsertSupplier(entity, naics) {
  try {
    const core = entity.entityRegistration || {};
    const addr = entity.coreData?.physicalAddress || {};

    const { error } = await supabase.from('suppliers').upsert({
      uei:                core.ueiSAM || null,
      name:               core.legalBusinessName || 'Unknown',
      state:              addr.stateOrProvinceCode || null,
      city:               addr.cityName || null,
      naics_codes:        [naics],  // Initial NAICS — may be expanded by SBA enrichment
      certifications:     [],       // Filled by enrichFromSBA
      socioeconomic:      core.sbaBusinessTypeList?.map(b => b.sbaBusinessTypeDesc) || [],
      sam_registered:     true,
      sam_uei:            core.ueiSAM || null,
      status:             'active',
      updated_at:         new Date().toISOString(),
    }, { onConflict: 'uei' });

    return !error;
  } catch (err) {
    return false;
  }
}

// Export supplier functions so other agents can call them
module.exports = { matchSuppliersToOpportunity, matchAllNewOpportunities };

// Run RECON when this file is executed
runRecon();
