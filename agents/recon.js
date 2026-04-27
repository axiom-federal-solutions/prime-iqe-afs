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

const { supabase, logAction, checkSystemHalt } = require('../lib/supabase');
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

  const halted = await checkSystemHalt('RECON');
  if (halted) process.exit(0);

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

// Run RECON when this file is executed
runRecon();
