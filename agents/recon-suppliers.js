// =============================================================
// RECON-SUPPLIERS.JS — Supplier Intelligence Engine
// JOB: Find, score, and match subcontractors + teaming partners
//      to every opportunity in the PRIME pipeline
// SCHEDULE: Weekly Monday 03:00 CT (full scan)
//           After judge scoring (match-only mode)
// COST: ~$0.50/month (Haiku calls for partner briefs only)
// DATA SOURCES: SAM.gov Entity API, SBA Dynamic Search, USAspending
// NO NEW API KEYS NEEDED — uses same SAM_API_KEY as SCOUT
// =============================================================

const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku }         = require('../lib/claude');

// SAM.gov Entity Management API (same key as SCOUT)
const SAM_ENTITY_API = 'https://api.sam.gov/entity-information/v3/entities';

// NAICS codes to scan for suppliers (construction + supply focus)
const TARGET_NAICS = [
  '236220','238210','237990','236116','561730',  // construction
  '424710','424130','424490','424120',            // supply
];

// States to scan — Gulf South primary, expanded for teaming
const TARGET_STATES = [
  'LA','TX','MS','AL','FL','GA',    // Gulf South core
  'NC','SC','TN','AR','OK',          // Southeast expansion
  'VA','DC','MD','PA','OH','IL','CO' // Agency HQ states
];

// Minimum match score to save (0-100 scale)
const MIN_MATCH_SCORE = 40;

// ----------------------------------------------------------
// MAIN: Dispatch based on --match-only flag or full scan
// ----------------------------------------------------------
async function run() {
  const args = process.argv.slice(2);
  const matchOnly = args.includes('--match-only');

  console.log('RECON-SUPPLIERS: Starting at ' + new Date().toISOString());
  console.log('RECON-SUPPLIERS: Mode = ' + (matchOnly ? 'match-only' : 'full-scan'));

  try {
    if (matchOnly) {
      // Called after judge scoring — only run matching, skip full SAM scan
      await matchAllNewOpportunities();
    } else {
      // Full weekly scan: refresh supplier DB + enrich + match
      await scanSuppliers();
      await enrichFromUSAspending();
      await matchAllNewOpportunities();
    }

    console.log('RECON-SUPPLIERS: Complete.');
  } catch (err) {
    console.error('RECON-SUPPLIERS ERROR:', err.message);
    await logAction('RECON', 'Supplier intelligence failed', { error: err.message });
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════
// STEP 1: SAM.gov ENTITY SCAN
// Pulls registered federal contractors matching our NAICS codes
// and target states. Upserts into the suppliers table.
// ═══════════════════════════════════════════════════════════
async function scanSuppliers() {
  console.log('RECON-SUPPLIERS: Starting SAM.gov entity scan...');
  let totalUpserted = 0;

  for (const naics of TARGET_NAICS) {
    for (const state of TARGET_STATES) {
      try {
        const params = new URLSearchParams({
          api_key:                     process.env.SAM_API_KEY,
          naicsCode:                   naics,
          physicalAddressStateCode:    state,
          registrationStatus:          'Active',
          purposeOfRegistrationCode:   'Z2',  // All Awards
          entityECAFlag:               'N',
          includeSections:             'entityRegistration,coreData,assertions,certifications',
          page:                        '0',
          size:                        '100',
        });

        const res = await fetch(SAM_ENTITY_API + '?' + params, {
          headers: { 'Accept': 'application/json' },
        });

        if (!res.ok) {
          // SAM.gov returns 429 when rate limited — log and continue
          if (res.status === 429) {
            console.log('RECON-SUPPLIERS: SAM rate limited — waiting 10s...');
            await sleep(10000);
            continue;
          }
          console.log('RECON-SUPPLIERS: SAM error ' + res.status + ' for ' + naics + '/' + state);
          continue;
        }

        const data = await res.json();
        const entities = data.entityData || [];

        for (const entity of entities) {
          const reg  = entity.entityRegistration || {};
          const core = entity.coreData || {};
          const addr = core.physicalAddress || {};
          const poc  = core.pointsOfContact?.governmentBusinessPointOfContact || {};

          // Skip if no UEI — can't identify this entity
          if (!reg.ueiSAM) continue;

          // Parse certifications and socioeconomic flags from SBA types
          const certs = [];
          const socio = [];
          const assertions = entity.assertions || {};

          (assertions.sbaBusinessTypeDesc || []).forEach(t => {
            if (t.includes('8(a)')) {
              certs.push('8(a)'); socio.push('8(a)');
            }
            if (t.includes('HUBZone')) {
              certs.push('HUBZone'); socio.push('HUBZone');
            }
            if (t.includes('Woman')) {
              certs.push('WOSB'); socio.push('WOSB');
            }
            if (t.includes('Veteran') || t.includes('SDVOSB')) {
              certs.push('SDVOSB'); socio.push('SDVOSB');
            }
            if (t.includes('Small Disadvantaged')) {
              socio.push('SDB');
            }
            if (t.includes('Small Business')) {
              socio.push('SB');
            }
          });

          // Pull all NAICS codes from the entity registration
          const naicsList = (core.naicsCode || []).map(n => n.naicsCode).filter(Boolean);

          await supabase.from('suppliers').upsert({
            uei:                   reg.ueiSAM,
            cage_code:             reg.cageCode,
            name:                  reg.legalBusinessName,
            dba_name:              reg.dbaName,
            naics_codes:           naicsList.length ? naicsList : [naics],
            primary_naics:         naicsList[0] || naics,
            certifications:        [...new Set(certs)],
            socioeconomic:         [...new Set(socio)],
            size_standard:         assertions.sizeStatus || 'Unknown',
            state:                 addr.stateOrProvinceCode,
            city:                  addr.city,
            zip:                   addr.zipCode,
            congressional_district: addr.congressionalDistrict,
            contact_name:          poc.firstName ? poc.firstName + ' ' + poc.lastName : null,
            contact_email:         poc.emailAddress,
            contact_phone:         poc.phoneNumber,
            source:                'SAM',
            sam_last_updated:      reg.registrationDate || null,
            last_refreshed:        new Date().toISOString(),
          }, { onConflict: 'uei' });

          totalUpserted++;
        }

        // SAM.gov allows ~10 req/sec — stay under the limit
        await sleep(150);

      } catch (err) {
        console.error('RECON-SUPPLIERS: SAM scan error ' + naics + '/' + state + ': ' + err.message);
      }
    }
  }

  await logAction('RECON', 'SAM entity scan complete', {
    total_upserted: totalUpserted,
    naics_scanned:  TARGET_NAICS.length,
    states_scanned: TARGET_STATES.length,
  });

  console.log('RECON-SUPPLIERS: SAM scan done — ' + totalUpserted + ' suppliers upserted.');
  return totalUpserted;
}

// ═══════════════════════════════════════════════════════════
// STEP 2: USAspending ENRICHMENT
// Adds real federal contract history to each supplier.
// This is the most valuable intel — actual performance, not claims.
// ═══════════════════════════════════════════════════════════
async function enrichFromUSAspending() {
  console.log('RECON-SUPPLIERS: Starting USAspending enrichment...');

  // Only enrich suppliers we haven't touched yet — batch of 100
  const { data: unenriched } = await supabase
    .from('suppliers')
    .select('id, name, uei')
    .eq('usaspending_enriched', false)
    .limit(100);

  if (!unenriched || unenriched.length === 0) {
    console.log('RECON-SUPPLIERS: All suppliers already enriched.');
    return;
  }

  let enriched = 0;

  for (const supplier of unenriched) {
    try {
      const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          filters: {
            recipient_search_text: [supplier.name],
            time_period: [{ start_date: '2020-01-01', end_date: new Date().toISOString().split('T')[0] }],
          },
          fields: ['Award Amount', 'Awarding Agency', 'NAICS Code', 'Start Date'],
          limit:  50,
          page:   1,
        }),
      });

      if (!res.ok) {
        await sleep(300);
        continue;
      }

      const data    = await res.json();
      const results = data.results || [];

      if (results.length > 0) {
        // Calculate performance metrics from actual award data
        const values   = results.map(r => parseFloat(r['Award Amount']) || 0).filter(v => v > 0);
        const agencies = [...new Set(results.map(r => r['Awarding Agency']).filter(Boolean))];

        const totalValue = values.reduce((a, b) => a + b, 0);
        const avgValue   = values.length > 0 ? totalValue / values.length : 0;
        const maxValue   = values.length > 0 ? Math.max(...values) : 0;

        // Tier: what scale of contracts has this supplier handled?
        let tier = 'small';
        if (avgValue > 2000000)  tier = 'large';
        else if (avgValue > 500000) tier = 'mid';

        await supabase.from('suppliers').update({
          federal_contract_count: results.length,
          total_federal_value:    totalValue,
          avg_contract_value:     avgValue,
          largest_contract:       maxValue,
          agencies_worked:        agencies.slice(0, 10),
          capability_tier:        tier,
          usaspending_enriched:   true,
          last_refreshed:         new Date().toISOString(),
        }).eq('id', supplier.id);

        enriched++;
      } else {
        // No federal history — mark enriched so we don't retry
        await supabase.from('suppliers').update({
          usaspending_enriched: true,
          capability_tier:      'no_federal_history',
        }).eq('id', supplier.id);
      }

      await sleep(300); // USAspending rate limit

    } catch (err) {
      console.log('RECON-SUPPLIERS: USAspending error for ' + supplier.name + ': ' + err.message);
    }
  }

  await logAction('RECON', 'USAspending enrichment complete', {
    enriched, total: unenriched.length,
  });

  console.log('RECON-SUPPLIERS: USAspending done — ' + enriched + '/' + unenriched.length + ' enriched.');
}

// ═══════════════════════════════════════════════════════════
// STEP 3: MATCH ALL NEW OPPORTUNITIES
// Finds opportunities that haven't been matched yet and runs
// the matching engine against them.
// ═══════════════════════════════════════════════════════════
async function matchAllNewOpportunities() {
  console.log('RECON-SUPPLIERS: Starting opportunity matching...');

  // Get scored opportunities that have no supplier matches yet
  const { data: opps } = await supabase
    .from('opportunities')
    .select('id, solicitation_number')
    .in('status', ['scored', 'pursuing', 'new'])
    .not('solicitation_number', 'is', null)
    .limit(20);

  if (!opps || opps.length === 0) {
    // 2026-05-01: was a silent console.log — invisible after the workflow
    // run ended. Now logged so the dashboard can show "RECON ran but had
    // nothing to chew on" instead of "RECON never ran".
    console.log('RECON-SUPPLIERS: No opportunities to match.');
    await logAction('RECON', 'Supplier matching skipped — empty input', {
      reason:    'No scored/pursuing/new opportunities with solicitation_number',
      checked_at: new Date().toISOString(),
    });
    return;
  }

  // Only match opps that don't already have matches
  const solNumbers = opps.map(o => o.solicitation_number);
  const { data: alreadyMatched } = await supabase
    .from('supplier_matches')
    .select('solicitation_number')
    .in('solicitation_number', solNumbers);

  const matched = new Set((alreadyMatched || []).map(m => m.solicitation_number));
  const toMatch = opps.filter(o => !matched.has(o.solicitation_number));

  console.log('RECON-SUPPLIERS: Matching ' + toMatch.length + ' new opportunities...');

  for (const opp of toMatch) {
    try {
      await matchSuppliersToOpportunity(opp.solicitation_number);
      await sleep(500); // Pace the DB writes
    } catch (err) {
      console.log('RECON-SUPPLIERS: Match failed for ' + opp.solicitation_number + ': ' + err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// CORE MATCHING ENGINE
// Scores every potential supplier against a specific opportunity
// using 5 weighted factors (total = 100 points).
//
// NAICS Match:  30pts — do their skills match what the contract needs?
// Cert Match:   25pts — do they have the certs the contract requires?
// Location:     20pts — are they in the right geography?
// Experience:   15pts — have they done federal work at this scale?
// Capacity:     10pts — are they the right size for the sub role?
// ═══════════════════════════════════════════════════════════
async function matchSuppliersToOpportunity(solicitationNumber) {
  // Load the opportunity
  const { data: opp } = await supabase
    .from('opportunities')
    .select('*')
    .eq('solicitation_number', solicitationNumber)
    .single();

  if (!opp) {
    console.log('RECON-SUPPLIERS: Opportunity not found: ' + solicitationNumber);
    return [];
  }

  // Decide what kind of match we're looking for
  const isSupply = ['424710','424130','424490','424120','424310'].includes(opp.naics);
  let matchType = 'sub';
  if (isSupply) {
    matchType = 'distributor';
  } else if (opp.set_aside && !walkerHasCert(opp.set_aside)) {
    matchType = 'teaming'; // Walker doesn't have the required cert — find a partner
  }

  // Query candidates — first try exact NAICS match
  let candidates = null;
  const { data: exact } = await supabase
    .from('suppliers')
    .select('*')
    .contains('naics_codes', [opp.naics])
    .limit(200);

  candidates = exact || [];

  // If too few results, broaden to 4-digit NAICS group
  if (candidates.length < 10 && opp.naics && opp.naics.length >= 4) {
    const broadNaics = opp.naics.substring(0, 4);
    const { data: broad } = await supabase
      .from('suppliers')
      .select('*')
      .ilike('primary_naics', broadNaics + '%')
      .limit(200);
    candidates = (broad || []);
  }

  if (candidates.length === 0) {
    console.log('RECON-SUPPLIERS: No candidates found for ' + solicitationNumber);
    return [];
  }

  // Score every candidate
  const scored = candidates.map(sup => {
    const reasons   = [];
    let naicsPts    = 0;
    let certPts     = 0;
    let locPts      = 0;
    let expPts      = 0;
    let capPts      = 0;

    // ── NAICS MATCH (30pts) ──────────────────────────────
    if ((sup.naics_codes || []).includes(opp.naics)) {
      naicsPts = 30;
      reasons.push('Direct NAICS match: ' + opp.naics);
    } else if (sup.primary_naics?.substring(0, 4) === opp.naics?.substring(0, 4)) {
      naicsPts = 15;
      reasons.push('Adjacent NAICS match (' + opp.naics?.substring(0, 4) + 'xx)');
    }

    // ── CERT MATCH (25pts) ───────────────────────────────
    if (matchType === 'teaming' && opp.set_aside) {
      // Teaming: does this supplier HAVE the cert Walker needs?
      const needed = certFromSetAside(opp.set_aside);
      const supCerts = [...(sup.certifications || []), ...(sup.socioeconomic || [])];
      if (needed && supCerts.includes(needed)) {
        certPts = 25;
        reasons.push('Has required ' + needed + ' certification');
      } else if (supCerts.length > 0) {
        certPts = 5;
        reasons.push(supCerts.length + ' socioeconomic certifications');
      }
    } else if ((sup.certifications || []).length > 0) {
      // Sub/distributor: any certs are a bonus
      certPts = 12;
      reasons.push('Certifications: ' + sup.certifications.join(', '));
    }

    // ── LOCATION (20pts) ─────────────────────────────────
    if (opp.state && sup.state === opp.state) {
      const oppCity   = (opp.location || '').toLowerCase();
      const supCity   = (sup.city || '').toLowerCase();
      const sameCity  = supCity && oppCity && oppCity.includes(supCity);
      locPts = sameCity ? 20 : 15;
      reasons.push('Located in ' + (sup.city ? sup.city + ', ' : '') + sup.state);
    } else if (isAdjacentState(opp.state, sup.state)) {
      locPts = 8;
      reasons.push('Adjacent state: ' + sup.state);
    }

    // ── EXPERIENCE (15pts) ───────────────────────────────
    if (sup.federal_contract_count > 0) {
      const threshold = (opp.value || 0) / 4;
      if (sup.avg_contract_value >= threshold) {
        expPts = 15;
        reasons.push(sup.federal_contract_count + ' fed contracts, avg ' + fmtVal(sup.avg_contract_value));
      } else {
        expPts = 8;
        reasons.push(sup.federal_contract_count + ' fed contracts (smaller scale)');
      }
    } else if (sup.capability_tier !== 'no_federal_history') {
      expPts = 3;
    }

    // ── CAPACITY (10pts) ─────────────────────────────────
    const oppVal = opp.value || 0;
    if (sup.capability_tier === 'large') {
      capPts = 5;
    } else if (sup.capability_tier === 'mid' && oppVal < 5000000) {
      capPts = 10;
      reasons.push('Mid-tier capacity — fits contract size');
    } else if (sup.capability_tier === 'small' && oppVal < 1000000) {
      capPts = 10;
      reasons.push('Small business — right size for contract');
    } else {
      capPts = 3;
    }

    const totalScore = naicsPts + certPts + locPts + expPts + capPts;

    return {
      solicitation_number: solicitationNumber,
      supplier_id:         sup.id,
      match_type:          matchType,
      match_score:         totalScore,
      match_reasons:       reasons,
      naics_match_pts:     naicsPts,
      cert_match_pts:      certPts,
      location_pts:        locPts,
      experience_pts:      expPts,
      capacity_pts:        capPts,
    };
  });

  // Keep top 10 above minimum threshold, sorted by score
  const top = scored
    .filter(s => s.match_score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 10);

  if (top.length > 0) {
    await supabase.from('supplier_matches').upsert(top, {
      onConflict: 'solicitation_number,supplier_id',
    });
  }

  await logAction('RECON', 'Supplier matching complete', {
    solicitation:      solicitationNumber,
    candidates_scored: candidates.length,
    matches_stored:    top.length,
    match_type:        matchType,
    top_score:         top.length > 0 ? top[0].match_score : 0,
  });

  console.log('RECON-SUPPLIERS: ' + solicitationNumber + ' — ' +
    top.length + ' matches stored (best: ' + (top[0]?.match_score || 0) + ')');

  return top;
}

// ═══════════════════════════════════════════════════════════
// ON-DEMAND: PARTNER BRIEF
// When Joe is seriously evaluating a teaming partner, generate
// a one-paragraph Haiku assessment. Called from dashboard.
// ═══════════════════════════════════════════════════════════
async function generatePartnerBrief(supplierId) {
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('*')
    .eq('id', supplierId)
    .single();

  if (!supplier) return null;

  const brief = await claudeHaiku(
    'Generate a 1-paragraph partner assessment for this federal contractor: ' +
    JSON.stringify({
      name:              supplier.name,
      naics:             supplier.naics_codes,
      certs:             supplier.certifications,
      socioeconomic:     supplier.socioeconomic,
      location:          supplier.city + ', ' + supplier.state,
      federal_contracts: supplier.federal_contract_count,
      avg_value:         supplier.avg_contract_value,
      agencies:          supplier.agencies_worked,
      tier:              supplier.capability_tier,
    }) +
    '. Focus on: strengths as a teaming partner, relevant experience, and any concerns. 3-4 sentences max. Be direct and specific — no filler phrases.'
  );

  return { supplier, brief };
}

// ═══════════════════════════════════════════════════════════
// EXPORTED FUNCTIONS — used by DRAFT, BID ENGINE, BRANDI, TEST
// ═══════════════════════════════════════════════════════════

async function getSubsForPlan(contractSolicitationNumber) {
  const { data: matches } = await supabase
    .from('supplier_matches')
    .select(`
      match_type, match_score, match_reasons,
      suppliers (
        id, name, city, state, uei, cage_code,
        naics_codes, certifications, socioeconomic,
        federal_contract_count, avg_contract_value, contact_email
      )
    `)
    .eq('solicitation_number', contractSolicitationNumber)
    .eq('match_type', 'sub')
    .order('match_score', { ascending: false })
    .limit(10);

  if (!matches || matches.length === 0) return { matches: [], byCategory: {} };

  const byCategory = {
    sb:      matches.filter(m => m.suppliers?.socioeconomic?.includes('SB')),
    sdb:     matches.filter(m => m.suppliers?.socioeconomic?.includes('SDB')),
    hubzone: matches.filter(m => m.suppliers?.certifications?.includes('HUBZone')),
    wosb:    matches.filter(m => m.suppliers?.certifications?.includes('WOSB')),
    sdvosb:  matches.filter(m => m.suppliers?.certifications?.includes('SDVOSB')),
    eight_a: matches.filter(m => m.suppliers?.certifications?.includes('8(a)')),
  };

  return { matches, byCategory };
}

async function findDistributors(naicsCode, state) {
  const { data: distributors } = await supabase
    .from('suppliers')
    .select('name, city, state, contact_email, contact_phone, avg_contract_value, federal_contract_count, uei')
    .contains('naics_codes', [naicsCode])
    .eq('state', state)
    .order('federal_contract_count', { ascending: false })
    .limit(5);

  return distributors || [];
}

async function getSupplierAlerts() {
  const cutoff = new Date(Date.now() - 25 * 3600000).toISOString();

  const { data: recentMatches } = await supabase
    .from('supplier_matches')
    .select('match_type, match_score, created_at, solicitation_number, suppliers(name), opportunities(title)')
    .gte('created_at', cutoff)
    .order('match_score', { ascending: false })
    .limit(5);

  if (!recentMatches || recentMatches.length === 0) return [];

  return recentMatches.map(m => ({
    text: m.match_type.toUpperCase() + ': ' +
          (m.suppliers?.name || 'Unknown') +
          ' (score ' + m.match_score + ') matched to ' +
          (m.opportunities?.title || m.solicitation_number || 'unknown opp'),
    type:  m.match_type,
    score: m.match_score,
  }));
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function certFromSetAside(setAside) {
  if (!setAside) return null;
  const s = setAside.toUpperCase();
  if (s.includes('HUBZONE')) return 'HUBZone';
  if (s.includes('8(A)') || s.includes('8A'))  return '8(a)';
  if (s.includes('WOSB') || s.includes('WOMAN')) return 'WOSB';
  if (s.includes('SDVOSB') || s.includes('VETERAN')) return 'SDVOSB';
  if (s.includes('SDB'))   return 'SDB';
  return null;
}

function walkerHasCert(setAside) {
  if (!setAside) return true;
  const s = setAside.toUpperCase();
  const walkerCerts = ['SB', 'SMALL BUSINESS'];
  return walkerCerts.some(c => s.includes(c));
}

function isAdjacentState(a, b) {
  if (!a || !b) return false;
  const adj = {
    'LA': ['TX','MS','AR'],
    'TX': ['LA','AR','OK','NM'],
    'MS': ['LA','AL','TN','AR'],
    'AL': ['MS','FL','GA','TN'],
    'FL': ['AL','GA'],
    'GA': ['FL','AL','SC','NC','TN'],
    'AR': ['LA','TX','MS','MO','TN','OK'],
    'TN': ['AR','MS','AL','GA','NC','VA','KY','MO'],
    'VA': ['DC','MD','NC','TN','KY','WV'],
    'DC': ['VA','MD'],
    'MD': ['VA','DC','PA','DE','WV'],
    'PA': ['MD','NJ','NY','OH','WV','DE'],
    'OH': ['PA','WV','KY','IN','MI'],
    'IL': ['IN','WI','MO','IA','KY'],
    'CO': ['NM','UT','WY','NE','KS','OK'],
    'NC': ['VA','SC','TN','GA'],
    'SC': ['NC','GA'],
    'OK': ['TX','AR','MO','KS','CO','NM'],
  };
  return adj[a]?.includes(b) || adj[b]?.includes(a) || false;
}

function fmtVal(v) {
  if (!v || v === 0) return '$0';
  return v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + (v / 1000).toFixed(0) + 'K';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  scanSuppliers,
  enrichFromUSAspending,
  matchAllNewOpportunities,
  matchSuppliersToOpportunity,
  generatePartnerBrief,
  getSubsForPlan,
  findDistributors,
  getSupplierAlerts,
};

// ----------------------------------------------------------
// START: Run when called directly by GitHub Actions
// ----------------------------------------------------------
run();
