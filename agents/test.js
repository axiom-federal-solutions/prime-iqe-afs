// ============================================================
// T.E.S.T. — Tactical Evaluation & System Testing
// Agent 10 of 10 | PRIME System | v2
// Cost: $0/mo (zero LLM calls — pure logic assertions)
// Runs: Daily 04:00 CT + after SCOUT, JUDGE, EXEC, BRANDI
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SAM_API_KEY = process.env.SAM_API_KEY;

// Holds all test results for this run — written to DB at the end
const RESULTS = [];

// ── UTILITIES ──────────────────────────────────────────────

// Push a test result into the RESULTS array
function recordTest(testName, category, passed, expected, actual, agentTested, errorMsg) {
  RESULTS.push({ testName, category, passed, expected, actual, agentTested, errorMsg });
}

// Count how many times this test has failed consecutively in DB
async function getConsecutiveFailures(testName) {
  const { data } = await supabase
    .from('test_results')
    .select('passed')
    .eq('test_name', testName)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!data || data.length === 0) return 0;
  let count = 0;
  for (const row of data) {
    if (!row.passed) count++;
    else break;
  }
  return count;
}

// HALT: set agent_enabled = false in system_config
async function haltAgent(agentName, reason) {
  const key = agentName.toLowerCase() + '_enabled';
  await supabase.from('system_config').upsert({
    key, value: 'false', updated_by: 'TEST', updated_at: new Date().toISOString()
  });
  await supabase.from('system_config').upsert({
    key: 'halt_reason',
    value: agentName + ': ' + reason,
    updated_by: 'TEST',
    updated_at: new Date().toISOString()
  });
  await supabase.from('audit_log').insert({
    agent: 'TEST', action: 'HALT_AGENT',
    details: { halted_agent: agentName, reason },
    outcome: 'Agent disabled'
  });
  console.log('HALT: ' + agentName + ' disabled — ' + reason);
}

// ── TEST SUITES ────────────────────────────────────────────

// 1. DATA INTEGRITY: Validate SCOUT output
async function testScoutOutput() {
  const { data: opps } = await supabase
    .from('opportunities')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!opps || opps.length === 0) {
    recordTest('scout_has_data', 'DATA_INTEGRITY', true,
      'At least 0 opps (empty is OK for some NAICS)', '0', 'SCOUT', null);
    return;
  }

  // solicitation_number must not be null
  const nullSolNums = opps.filter(o => !o.solicitation_number);
  recordTest('scout_solicitation_not_null', 'DATA_INTEGRITY',
    nullSolNums.length === 0,
    '0 null solicitation_numbers',
    nullSolNums.length + ' null', 'SCOUT',
    nullSolNums.length > 0 ? 'Found ' + nullSolNums.length + ' null solicitation_numbers' : null);

  // value must be a number, not a formatted string
  const badValues = opps.filter(o =>
    o.value !== null && (typeof o.value !== 'number' || isNaN(o.value))
  );
  recordTest('scout_value_is_number', 'DATA_INTEGRITY',
    badValues.length === 0,
    '0 non-numeric values',
    badValues.length + ' non-numeric', 'SCOUT',
    badValues.length > 0 ? 'Value field contains non-numeric data — possible API format change' : null);

  // deadline must be a parseable date
  const badDates = opps.filter(o => o.deadline && isNaN(Date.parse(o.deadline)));
  recordTest('scout_deadline_valid_date', 'DATA_INTEGRITY',
    badDates.length === 0,
    '0 invalid dates',
    badDates.length + ' invalid', 'SCOUT',
    badDates.length > 0 ? 'Deadline field contains unparseable dates' : null);

  // NAICS must be exactly 6 digits
  const badNaics = opps.filter(o => o.naics && !/^\d{6}$/.test(o.naics));
  recordTest('scout_naics_format', 'DATA_INTEGRITY',
    badNaics.length === 0,
    '0 bad NAICS formats',
    badNaics.length + ' bad', 'SCOUT',
    badNaics.length > 0 ? 'NAICS code not 6-digit format' : null);
}

// 2. SCORE VALIDATION: Validate JUDGE output
async function testJudgeScoring() {
  const { data: scored } = await supabase
    .from('opportunities')
    .select('id, prime_score, acq_score, status')
    .in('status', ['scored', 'pursuing', 'bid_ready'])
    .not('prime_score', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!scored || scored.length === 0) {
    recordTest('judge_has_scored', 'SCORE_VALIDATION', true,
      'No scored opps yet', '0', 'JUDGE', null);
    return;
  }

  // All scores must be 0-100
  const outOfRange = scored.filter(o =>
    (o.prime_score !== null && (o.prime_score < 0 || o.prime_score > 100)) ||
    (o.acq_score   !== null && (o.acq_score   < 0 || o.acq_score   > 100))
  );
  recordTest('judge_scores_in_range', 'SCORE_VALIDATION',
    outOfRange.length === 0,
    'All scores 0-100',
    outOfRange.length + ' out of range', 'JUDGE',
    outOfRange.length > 0 ? 'Scores outside 0-100 range detected' : null);

  // Mean score must be within 15pts of 30-day historical average
  const recentScores = scored.map(o => o.prime_score || o.acq_score).filter(Boolean);
  if (recentScores.length >= 5) {
    const mean = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

    const { data: historical } = await supabase
      .from('opportunities')
      .select('prime_score, acq_score')
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
      .not('prime_score', 'is', null);

    if (historical && historical.length >= 10) {
      const histScores = historical.map(o => o.prime_score || o.acq_score).filter(Boolean);
      const histMean   = histScores.reduce((a, b) => a + b, 0) / histScores.length;
      const drift      = Math.abs(mean - histMean);

      recordTest('judge_score_drift', 'SCORE_VALIDATION',
        drift <= 15,
        'Drift <= 15 points',
        'Drift: ' + drift.toFixed(1) + ' pts', 'JUDGE',
        drift > 15
          ? 'Scoring drift detected: current mean ' + mean.toFixed(0) +
            ' vs 30-day mean ' + histMean.toFixed(0)
          : null);
    }
  }
}

// 3. FINANCIAL MATH: Validate EXEC calculations
async function testExecFinancials() {
  // Prompt payment interest must be positive
  const { data: claims } = await supabase
    .from('prompt_payment_claims')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (claims && claims.length > 0) {
    const negativeInterest = claims.filter(c => c.interest_owed !== null && c.interest_owed < 0);
    recordTest('exec_interest_positive', 'FINANCIAL_MATH',
      negativeInterest.length === 0,
      '0 negative interest values',
      negativeInterest.length + ' negative', 'EXEC',
      negativeInterest.length > 0
        ? 'CRITICAL: Interest calculation returned negative — math error in EXEC'
        : null);

    const badDaysLate = claims.filter(c => c.days_late !== null && c.days_late > 365);
    recordTest('exec_days_late_reasonable', 'FINANCIAL_MATH',
      badDaysLate.length === 0,
      '0 claims over 365 days late',
      badDaysLate.length + ' over 365d', 'EXEC',
      badDaysLate.length > 0 ? 'Invoice marked as 365+ days late — data error' : null);
  }

  // Retainage must be between 0-100%
  const { data: ret } = await supabase
    .from('retainage_tracker')
    .select('*')
    .limit(10);

  if (ret && ret.length > 0) {
    const badRate = ret.filter(r => r.retainage_rate < 0 || r.retainage_rate > 1);
    recordTest('exec_retainage_rate_valid', 'FINANCIAL_MATH',
      badRate.length === 0,
      'All rates 0-100%',
      badRate.length + ' invalid', 'EXEC',
      badRate.length > 0 ? 'Retainage rate outside 0-100% range' : null);

    const overHeld = ret.filter(r => r.retainage_held > r.total_contract_value);
    recordTest('exec_retainage_not_exceed_contract', 'FINANCIAL_MATH',
      overHeld.length === 0,
      'Retainage <= contract value',
      overHeld.length + ' exceed', 'EXEC',
      overHeld.length > 0
        ? 'CRITICAL: Retainage held exceeds total contract value'
        : null);
  }

  // Bid bonds must be positive
  const { data: bonds } = await supabase
    .from('bid_bonds')
    .select('*')
    .limit(10);

  if (bonds && bonds.length > 0) {
    const negBonds = bonds.filter(b => b.bond_amount !== null && b.bond_amount < 0);
    recordTest('exec_bond_positive', 'FINANCIAL_MATH',
      negBonds.length === 0,
      'All bond amounts positive',
      negBonds.length + ' negative', 'VAULT',
      negBonds.length > 0 ? 'CRITICAL: Negative bid bond amount detected' : null);
  }
}

// 4. API CONTRACT: Validate external API response schemas
async function testApiContracts() {
  if (!SAM_API_KEY) {
    recordTest('api_sam_key_present', 'API_CONTRACT', false,
      'SAM_API_KEY set', 'Missing', 'SCOUT',
      'CRITICAL: SAM_API_KEY environment variable not set');
    return;
  }

  try {
    const res = await fetch(
      'https://api.sam.gov/opportunities/v2/search?api_key=' +
      SAM_API_KEY + '&limit=1&naicsCode=236220'
    );

    // Auth failure = HALT trigger
    if (res.status === 403 || res.status === 401) {
      recordTest('api_sam_auth', 'API_CONTRACT', false,
        'Status 200', 'Status ' + res.status, 'SCOUT',
        'CRITICAL: SAM API authentication failed — key expired or revoked');
      return;
    }

    if (res.ok) {
      const data = await res.json();
      const hasTotal = typeof data.totalRecords !== 'undefined';
      const hasOpps  = Array.isArray(data.opportunitiesData);

      recordTest('api_sam_schema_valid', 'API_CONTRACT',
        hasTotal && hasOpps,
        'totalRecords + opportunitiesData array',
        'totalRecords: ' + hasTotal + ', opportunitiesData: ' + hasOpps, 'SCOUT',
        (!hasTotal || !hasOpps) ? 'SAM API response schema changed — fields missing' : null);

      // Check individual record fields if we got results
      if (hasOpps && data.opportunitiesData.length > 0) {
        const record         = data.opportunitiesData[0];
        const expectedFields = ['solicitationNumber', 'title', 'naicsCode', 'type'];
        const missingFields  = expectedFields.filter(f => !(f in record));

        recordTest('api_sam_record_fields', 'API_CONTRACT',
          missingFields.length === 0,
          'All required fields present',
          missingFields.length + ' missing: ' + missingFields.join(', '), 'SCOUT',
          missingFields.length > 0
            ? 'SAM record missing fields: ' + missingFields.join(', ')
            : null);

        // Update api_schemas snapshot
        await supabase.from('api_schemas').update({
          last_validated:   new Date().toISOString(),
          status:           missingFields.length === 0 ? 'valid' : 'mismatch',
          mismatch_details: missingFields.length > 0 ? 'Missing: ' + missingFields.join(', ') : null,
          last_mismatch:    missingFields.length > 0 ? new Date().toISOString() : null,
        }).eq('schema_key', 'sam_v2');
      }
    }
  } catch (err) {
    recordTest('api_sam_reachable', 'API_CONTRACT', false,
      'SAM API reachable', 'Error: ' + err.message, 'SCOUT',
      'SAM API unreachable: ' + err.message);
  }
}

// 5. DELIVERY: Verify Brandi email was sent in last 25 hours
async function testBrandiDelivery() {
  const { data: logs } = await supabase
    .from('audit_log')
    .select('*')
    .eq('agent', 'BRANDI')
    .gte('created_at', new Date(Date.now() - 25 * 3600000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const sent = logs && logs.length > 0;
  recordTest('brandi_sent_today', 'DELIVERY',
    sent,
    'Brief sent in last 25 hours',
    sent ? 'Sent at ' + logs[0].created_at : 'No brief found', 'BRANDI',
    !sent ? 'No morning brief sent in the last 25 hours' : null);
}

// 6. DATABASE HEALTH: Verify all 30 tables exist and audit trail is active
async function testDatabaseHealth() {
  const requiredTables = [
    'opportunities', 'bids', 'active_contracts', 'compliance', 'incumbents',
    'competitor_prices', 'job_costs', 'audit_log', 'co_contacts',
    'prompt_payment_claims', 'retainage_tracker', 'sub_payments',
    'debrief_tracker', 'compliance_matrices', 'capability_statements',
    'certified_payroll', 'sub_plans', 'cpars_ratings', 'contract_modifications',
    'sam_health_checks', 'distributor_prices', 'gao_protests', 'osdbu_events',
    'bid_bonds', 'prime_help', 'test_results', 'api_schemas', 'system_config',
    'suppliers', 'supplier_matches',
  ];

  for (const table of requiredTables) {
    try {
      const { error } = await supabase.from(table).select('id').limit(1);
      recordTest('db_table_exists_' + table, 'DB_HEALTH',
        !error, 'Table accessible',
        error ? 'Error: ' + error.message : 'OK', 'SYSTEM',
        error ? 'Table ' + table + ' inaccessible: ' + error.message : null);
    } catch (err) {
      recordTest('db_table_exists_' + table, 'DB_HEALTH', false,
        'Table accessible', 'Error: ' + err.message, 'SYSTEM',
        'Table ' + table + ' threw exception');
    }
  }

  // Audit log must have entries in last 30 days
  const { data: auditCheck } = await supabase
    .from('audit_log')
    .select('id')
    .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .limit(1);

  const hasAudit = auditCheck && auditCheck.length > 0;
  recordTest('db_audit_trail_active', 'DB_HEALTH',
    hasAudit,
    'Audit entries in last 30 days',
    hasAudit ? 'Active' : 'EMPTY', 'SYSTEM',
    !hasAudit ? 'No audit log entries in 30 days — agents may not be logging' : null);
}

// 7. SUPPLIER HEALTH: Validate recon-suppliers output
async function testSupplierHealth() {
  const { data: suppliers } = await supabase
    .from('suppliers')
    .select('id, name, naics_codes, uei')
    .limit(50);

  if (!suppliers || suppliers.length === 0) {
    recordTest('supplier_db_populated', 'DB_HEALTH', true,
      'Suppliers table exists (may be empty before first scan)', '0', 'RECON', null);
    return;
  }

  recordTest('supplier_db_populated', 'DB_HEALTH',
    suppliers.length > 0,
    'Suppliers table has rows',
    suppliers.length + ' suppliers', 'RECON', null);

  // Match scores must be 0-100
  const { data: matchSample } = await supabase
    .from('supplier_matches')
    .select('match_score')
    .limit(20);

  if (matchSample && matchSample.length > 0) {
    const outOfRange = matchSample.filter(m => m.match_score < 0 || m.match_score > 100);
    recordTest('supplier_match_scores_valid', 'SCORE_VALIDATION',
      outOfRange.length === 0,
      'All match scores 0-100',
      outOfRange.length + ' out of range', 'RECON',
      outOfRange.length > 0 ? 'Supplier match scores outside 0-100 range' : null);
  }

  // Suppliers must have NAICS codes — empty naics_codes = never matches anything
  const { data: noNaics } = await supabase
    .from('suppliers')
    .select('id')
    .eq('naics_codes', '{}')
    .limit(5);

  recordTest('supplier_has_naics', 'DB_HEALTH',
    !noNaics || noNaics.length === 0,
    '0 suppliers with empty NAICS',
    noNaics && noNaics.length > 0
      ? noNaics.length + ' suppliers missing NAICS'
      : 'All have NAICS', 'RECON',
    noNaics && noNaics.length > 0
      ? noNaics.length + " suppliers have empty NAICS — they won't match any opportunities"
      : null);
}

// ── MAIN EXECUTION ─────────────────────────────────────────

async function runAllTests() {
  console.log('T.E.S.T. v2 — Starting validation run...');
  console.log('Time: ' + new Date().toISOString());

  // Check if T.E.S.T. itself is enabled before running
  const { data: selfCheck } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', 'test_enabled')
    .single();

  if (selfCheck?.value === 'false') {
    console.log('T.E.S.T. is disabled by system_config. Exiting.');
    return;
  }

  // Run all 7 test suites
  await testScoutOutput();
  await testJudgeScoring();
  await testExecFinancials();
  await testApiContracts();
  await testBrandiDelivery();
  await testDatabaseHealth();
  await testSupplierHealth();

  // Process results: assign tiers and determine HALT conditions
  let haltTriggered = false;
  for (const result of RESULTS) {
    if (!result.passed) {
      const consecutive    = await getConsecutiveFailures(result.testName);
      const newConsecutive = consecutive + 1;

      let tier   = 1;
      let action = 'LOG';

      if (newConsecutive >= 3) { tier = 2; action = 'ALERT'; }

      // HALT conditions: CRITICAL flag in error message or auth failure
      const isCritical = result.errorMsg && result.errorMsg.includes('CRITICAL');
      const isAuthFail = result.testName.includes('auth');

      if (isCritical || isAuthFail) {
        tier   = 3;
        action = 'HALT';
        if (result.agentTested && !haltTriggered) {
          await haltAgent(result.agentTested, result.errorMsg || result.testName);
          haltTriggered = true;
        }
      }

      result.tier               = tier;
      result.action             = action;
      result.consecutiveFailures = newConsecutive;
    } else {
      result.tier               = 0;
      result.action             = 'PASS';
      result.consecutiveFailures = 0;
    }
  }

  // Write all results to test_results table
  const rows = RESULTS.map(r => ({
    test_name:            r.testName,
    category:             r.category,
    tier:                 r.tier || 0,
    passed:               r.passed,
    expected:             r.expected,
    actual:               r.actual,
    error_message:        r.errorMsg,
    agent_tested:         r.agentTested,
    consecutive_failures: r.consecutiveFailures || 0,
    action_taken:         r.action || 'PASS',
    created_at:           new Date().toISOString(),
  }));

  await supabase.from('test_results').insert(rows);

  // Update last run timestamp
  await supabase.from('system_config').upsert({
    key: 'last_test_run', value: new Date().toISOString(), updated_by: 'TEST'
  });

  // Write to audit trail
  const passed = RESULTS.filter(r => r.passed).length;
  const failed = RESULTS.filter(r => !r.passed).length;
  const halts  = RESULTS.filter(r => r.action === 'HALT').length;
  const alerts = RESULTS.filter(r => r.action === 'ALERT').length;

  await supabase.from('audit_log').insert({
    agent:   'TEST',
    action:  'Validation run complete',
    details: { total: RESULTS.length, passed, failed, halts, alerts },
    outcome: failed === 0
      ? 'ALL CLEAR'
      : failed + ' failures (' + halts + ' halts, ' + alerts + ' alerts)',
  });

  console.log(
    'T.E.S.T. complete: ' + passed + ' passed, ' + failed + ' failed, ' +
    halts + ' halts, ' + alerts + ' alerts'
  );
}

runAllTests().catch(err => {
  console.error('T.E.S.T. CRITICAL ERROR:', err);
  process.exit(1);
});
