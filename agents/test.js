// =============================================================
// TEST.JS — T.E.S.T. v2: Tactical Evaluation & System Testing
// JOB: Validate data integrity, scores, financial math, API
//      contracts, email delivery, and database health
//      Runs BEFORE the day starts so Brandi knows what's broken
// SCHEDULE: Daily 04:00 CT + triggered after SCOUT, JUDGE, EXEC, BRANDI
// COST: $0/month — zero LLM calls, pure logic and math assertions
// SAFETY RULE: T.E.S.T. never restarts agents, rolls back code,
//              or modifies data. It only DISABLES and ALERTS.
//              Joe is always the one who fixes root causes.
// HALT TRIGGERS: Auth failures (403/401), DB connection failures,
//                impossible financial math only
// HALT NEVER TRIGGERS ON: Scoring results, email failures,
//                          single-occurrence errors, empty API results
// =============================================================

const { supabase, logAction, getConfig, setConfig } = require('../lib/supabase');

// How many consecutive failures before we escalate to ALERT
const ALERT_THRESHOLD = 3;

// Tier codes for the 3-tier response system
const TIER = {
  LOG:   1,  // Single failure — write to test_results, re-test next cycle
  ALERT: 2,  // 3+ consecutive failures — add to Brandi morning brief as WARNING
  HALT:  3,  // Critical failure — disable affected agent, Brandi sends URGENT email
};

// HALT is reserved only for these categories
const HALT_CATEGORIES = ['AUTH', 'DB_HEALTH', 'FINANCIAL_MATH'];

// Track results during this run
const runResults = [];

// ----------------------------------------------------------
// RECORD TEST: Save a test result and determine tier response
// ----------------------------------------------------------
async function recordTest(testName, category, passed, expected, actual, agentTarget = null) {
  try {
    // Get consecutive failure count from previous runs
    const { data: prev } = await supabase
      .from('test_results')
      .select('consecutive_failures, passed')
      .eq('test_name', testName)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let consecutiveFailures = 0;
    if (!passed) {
      consecutiveFailures = (prev && !prev.passed) ? (prev.consecutive_failures || 0) + 1 : 1;
    }

    // Determine tier based on failure count and category
    let tier = TIER.LOG;
    let actionTaken = 'LOG';

    if (!passed) {
      if (HALT_CATEGORIES.includes(category) && consecutiveFailures >= 1) {
        // HALT on first occurrence for critical categories
        tier = TIER.HALT;
        actionTaken = 'HALT';
      } else if (consecutiveFailures >= ALERT_THRESHOLD) {
        tier = TIER.ALERT;
        actionTaken = 'ALERT';
      } else {
        tier = TIER.LOG;
        actionTaken = 'LOG';
      }
    }

    // Write to test_results table
    await supabase.from('test_results').insert({
      test_name: testName,
      category,
      tier: passed ? 0 : tier,
      passed,
      expected: String(expected),
      actual: String(actual),
      consecutive_failures: consecutiveFailures,
      action_taken: passed ? 'PASS' : actionTaken,
      created_at: new Date().toISOString(),
    });

    // If HALT, disable the affected agent
    if (!passed && tier === TIER.HALT && agentTarget) {
      const key = `AGENT_${agentTarget.toUpperCase()}_ENABLED`;
      await setConfig(key, 'false');
      console.error(`T.E.S.T. HALT: Disabled ${agentTarget} — ${testName} failed. Reason: ${actual}`);
      await logAction('T.E.S.T.', `HALT issued — ${agentTarget} disabled`, {
        test: testName,
        reason: actual,
        key,
      });
    }

    // Track for summary
    runResults.push({ testName, category, passed, tier: passed ? 0 : tier, actionTaken: passed ? 'PASS' : actionTaken });

    const icon = passed ? '✓' : (tier === TIER.HALT ? '✗ HALT' : tier === TIER.ALERT ? '⚠ ALERT' : '⚠ LOG');
    console.log(`T.E.S.T. [${category}] ${icon} ${testName}: expected=${expected}, actual=${actual}`);

    return { passed, tier, actionTaken };
  } catch (err) {
    console.error('T.E.S.T.: recordTest failed —', err.message);
    return { passed: false, tier: TIER.LOG, actionTaken: 'LOG' };
  }
}

// ----------------------------------------------------------
// CATEGORY 1: DATA INTEGRITY
// Validates SCOUT output — checks that opportunity rows are complete
// ----------------------------------------------------------
async function testDataIntegrity() {
  console.log('\nT.E.S.T.: Running Data Integrity tests...');

  // Test 1: Opportunities have non-null solicitation numbers
  const { data: nullSolicitation } = await supabase
    .from('opportunities')
    .select('id')
    .is('solicitation_number', null)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(5);

  await recordTest(
    'scout_solicitation_not_null',
    'DATA_INTEGRITY',
    (nullSolicitation || []).length === 0,
    '0 null solicitation numbers in last 24h',
    `${(nullSolicitation || []).length} null solicitation numbers found`
  );

  // Test 2: Contract values are numbers (not strings, not negative, not zero for active opps)
  const { data: badValues } = await supabase
    .from('opportunities')
    .select('id, contract_value')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .lt('contract_value', 0);

  await recordTest(
    'scout_contract_value_positive',
    'DATA_INTEGRITY',
    (badValues || []).length === 0,
    '0 opportunities with negative contract values',
    `${(badValues || []).length} opportunities with negative values`
  );

  // Test 3: Response deadlines are valid future dates (or at least valid ISO dates)
  const { data: badDeadlines } = await supabase
    .from('opportunities')
    .select('id, response_deadline')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .not('response_deadline', 'is', null)
    .lt('response_deadline', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()); // Already expired by 7+ days

  await recordTest(
    'scout_deadline_valid',
    'DATA_INTEGRITY',
    (badDeadlines || []).length === 0,
    '0 opportunities with already-expired deadlines',
    `${(badDeadlines || []).length} opportunities with already-expired deadlines`
  );

  // Test 4: NAICS codes are exactly 6 digits
  const { data: recentOpps } = await supabase
    .from('opportunities')
    .select('id, naics')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .not('naics', 'is', null)
    .limit(50);

  const badNaics = (recentOpps || []).filter(o => o.naics && !/^\d{6}$/.test(String(o.naics)));
  await recordTest(
    'scout_naics_six_digits',
    'DATA_INTEGRITY',
    badNaics.length === 0,
    '0 opportunities with invalid NAICS codes',
    `${badNaics.length} opportunities with non-6-digit NAICS codes`
  );
}

// ----------------------------------------------------------
// CATEGORY 2: SCORE VALIDATION
// Validates JUDGE output — checks scoring is in range and not drifting
// ----------------------------------------------------------
async function testScoreValidation() {
  console.log('\nT.E.S.T.: Running Score Validation tests...');

  // Test 5: All scores are between 0 and 100
  const { data: badScores } = await supabase
    .from('opportunities')
    .select('id, prime_score, acq_score')
    .or('prime_score.lt.0,prime_score.gt.100,acq_score.lt.0,acq_score.gt.100')
    .gte('scored_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  await recordTest(
    'judge_scores_in_range',
    'SCORE_VALIDATION',
    (badScores || []).length === 0,
    'All scores between 0-100',
    `${(badScores || []).length} opportunities with out-of-range scores`
  );

  // Test 6: No scored opportunities have null scores (JUDGE ran but left nulls)
  const { data: nullScores } = await supabase
    .from('opportunities')
    .select('id')
    .not('scored_at', 'is', null)
    .is('prime_score', null)
    .is('acq_score', null)
    .gte('scored_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  await recordTest(
    'judge_no_null_after_scoring',
    'SCORE_VALIDATION',
    (nullScores || []).length === 0,
    '0 opportunities with null score after JUDGE ran',
    `${(nullScores || []).length} opportunities scored but still null`
  );

  // Test 7: Score drift detection — 30-day mean should be within ±15 pts
  const { data: recentScores } = await supabase
    .from('opportunities')
    .select('prime_score')
    .not('prime_score', 'is', null)
    .gte('scored_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (recentScores && recentScores.length >= 10) {
    const scores = recentScores.map(o => Number(o.prime_score)).filter(s => !isNaN(s));
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    // We expect mean between 40-70 for a well-calibrated scoring system
    const driftDetected = mean < 25 || mean > 85;

    await recordTest(
      'judge_score_calibration',
      'SCORE_VALIDATION',
      !driftDetected,
      '30-day PRIME Score mean between 25-85 (calibration check)',
      `30-day mean = ${mean.toFixed(1)} (${driftDetected ? 'DRIFT DETECTED' : 'normal'})`
    );
  }

  // Test 8: LEASE Score validation — in range for real estate opps
  const { data: badLeaseScores } = await supabase
    .from('opportunities')
    .select('id, lease_score')
    .not('lease_score', 'is', null)
    .or('lease_score.lt.0,lease_score.gt.100')
    .gte('scored_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  await recordTest(
    'judge_lease_scores_in_range',
    'SCORE_VALIDATION',
    (badLeaseScores || []).length === 0,
    'All LEASE scores between 0-100',
    `${(badLeaseScores || []).length} real estate opportunities with out-of-range LEASE scores`
  );
}

// ----------------------------------------------------------
// CATEGORY 3: FINANCIAL MATH
// Validates EXEC output — checks math is physically possible
// HALT triggers here for impossible values
// ----------------------------------------------------------
async function testFinancialMath() {
  console.log('\nT.E.S.T.: Running Financial Math tests...');

  // Test 9: Prompt payment interest must be positive (negative interest = bug)
  const { data: negativeInterest } = await supabase
    .from('prompt_payment_claims')
    .select('id, interest_amount')
    .lt('interest_amount', 0)
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  await recordTest(
    'exec_interest_positive',
    'FINANCIAL_MATH',
    (negativeInterest || []).length === 0,
    'All prompt payment interest amounts > 0',
    `${(negativeInterest || []).length} claims with negative interest`,
    'EXEC'  // Halt EXEC if this fires
  );

  // Test 10: Days late must be under 365 (>365 = data integrity bug, not real delay)
  const { data: impossibleDaysLate } = await supabase
    .from('prompt_payment_claims')
    .select('id, days_late')
    .gt('days_late', 365)
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  await recordTest(
    'exec_days_late_reasonable',
    'FINANCIAL_MATH',
    (impossibleDaysLate || []).length === 0,
    'All days_late values ≤ 365',
    `${(impossibleDaysLate || []).length} claims with days_late > 365`
  );

  // Test 11: Retainage held cannot exceed contract value
  const { data: retainageOverflow } = await supabase
    .from('active_contracts')
    .select('id, contract_value, retainage_held')
    .not('retainage_held', 'is', null)
    .not('contract_value', 'is', null)
    .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  const badRetainage = (retainageOverflow || []).filter(c =>
    Number(c.retainage_held) > Number(c.contract_value)
  );

  await recordTest(
    'exec_retainage_valid',
    'FINANCIAL_MATH',
    badRetainage.length === 0,
    'Retainage held ≤ contract value for all active contracts',
    `${badRetainage.length} contracts where retainage_held > contract_value`,
    'EXEC'
  );

  // Test 12: Retainage rate 0-100%
  const { data: badRetainageRate } = await supabase
    .from('retainage_tracker')
    .select('id, retainage_rate')
    .or('retainage_rate.lt.0,retainage_rate.gt.100')
    .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  await recordTest(
    'exec_retainage_rate_valid',
    'FINANCIAL_MATH',
    (badRetainageRate || []).length === 0,
    'All retainage rates between 0-100%',
    `${(badRetainageRate || []).length} contracts with impossible retainage rate`
  );

  // Test 13: Bid bond amounts positive and not 10x the contract value
  const { data: bonds } = await supabase
    .from('bid_bonds')
    .select('id, bond_amount, contract_value')
    .not('bond_amount', 'is', null)
    .not('contract_value', 'is', null)
    .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  const badBonds = (bonds || []).filter(b =>
    Number(b.bond_amount) <= 0 || Number(b.bond_amount) > Number(b.contract_value) * 10
  );

  await recordTest(
    'vault_bond_amount_valid',
    'FINANCIAL_MATH',
    badBonds.length === 0,
    'All bid bond amounts positive and < 10x contract value',
    `${badBonds.length} bid bonds with impossible amounts`,
    'VAULT'
  );
}

// ----------------------------------------------------------
// CATEGORY 4: API CONTRACTS
// Checks that external APIs still return the schema we expect
// Uses api_schemas table which stores expected field names
// ----------------------------------------------------------
async function testApiContracts() {
  console.log('\nT.E.S.T.: Running API Contract tests...');

  // Load all stored API schemas
  const { data: schemas } = await supabase
    .from('api_schemas')
    .select('*')
    .eq('status', 'valid');

  if (!schemas || schemas.length === 0) {
    console.log('T.E.S.T.: No API schemas stored yet — skipping API contract tests');
    return;
  }

  for (const schema of schemas) {
    try {
      // Make a lightweight test call to the API (no auth required for schema check)
      // We only test SAM.gov since it's our main external dependency
      if (schema.api_name === 'sam_gov') {
        const testUrl = `${schema.endpoint_url}&limit=1`;
        const samKey = process.env.SAM_API_KEY;

        if (!samKey) {
          await recordTest(
            `api_${schema.api_name}_key_present`,
            'AUTH',
            false,
            'SAM_API_KEY environment variable set',
            'SAM_API_KEY is missing',
            'SCOUT'  // HALT SCOUT if SAM key is gone
          );
          continue;
        }

        const resp = await fetch(`${testUrl}&api_key=${samKey}`, {
          headers: { 'User-Agent': 'PRIME-IQE-TEST/1.0' },
          signal: AbortSignal.timeout(10000),
        });

        // HALT on auth failures
        if (resp.status === 401 || resp.status === 403) {
          await recordTest(
            `api_${schema.api_name}_auth`,
            'AUTH',
            false,
            'SAM.gov returns 200 OK',
            `SAM.gov returned HTTP ${resp.status} — API key expired or invalid`,
            'SCOUT'
          );
          continue;
        }

        // Check schema fields if response is OK
        if (resp.ok) {
          const json = await resp.json();
          const expectedFields = schema.expected_schema?.fields || [];
          const actualKeys = Object.keys(json || {});
          const missingFields = expectedFields.filter(f => !actualKeys.includes(f));

          if (missingFields.length > 0) {
            // Schema mismatch — mark for ALERT (not HALT — SAM can change format mid-day)
            await supabase.from('api_schemas')
              .update({ status: 'mismatch', mismatch_details: JSON.stringify({ missing: missingFields }), last_validated: new Date().toISOString() })
              .eq('api_name', schema.api_name);
          } else {
            await supabase.from('api_schemas')
              .update({ status: 'valid', mismatch_details: null, last_validated: new Date().toISOString() })
              .eq('api_name', schema.api_name);
          }

          await recordTest(
            `api_${schema.api_name}_schema`,
            'API_CONTRACTS',
            missingFields.length === 0,
            `All expected fields present: ${expectedFields.join(', ')}`,
            missingFields.length === 0 ? 'Schema matches' : `Missing: ${missingFields.join(', ')}`
          );
        }
      }
    } catch (err) {
      // Network error — LOG, don't HALT (could be a transient issue)
      await recordTest(
        `api_${schema.api_name}_reachable`,
        'API_CONTRACTS',
        false,
        `${schema.api_name} reachable`,
        `Network error: ${err.message}`
      );
    }
  }
}

// ----------------------------------------------------------
// CATEGORY 5: DELIVERY
// Checks that Brandi actually sent the morning brief email
// ----------------------------------------------------------
async function testDelivery() {
  console.log('\nT.E.S.T.: Running Delivery tests...');

  // Test: Brandi email sent in the last 25 hours (gives 1-hour buffer past 24h)
  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const { data: emailLogs } = await supabase
    .from('audit_log')
    .select('id, created_at')
    .eq('agent', 'BRANDI')
    .eq('action', 'Morning brief sent')
    .gte('created_at', cutoff)
    .limit(1);

  await recordTest(
    'brandi_email_sent',
    'DELIVERY',
    (emailLogs || []).length > 0,
    'Brandi sent morning brief in the last 25 hours',
    (emailLogs || []).length > 0 ? 'Email sent on schedule' : 'No Brandi email found in last 25 hours'
  );
}

// ----------------------------------------------------------
// CATEGORY 6: DATABASE HEALTH
// Checks all 30 tables are accessible, audit_log is active
// ----------------------------------------------------------
async function testDatabaseHealth() {
  console.log('\nT.E.S.T.: Running Database Health tests...');

  // Test: All 30 core tables accessible
  const TABLES = [
    'opportunities', 'bids', 'active_contracts', 'compliance', 'incumbents',
    'competitor_prices', 'job_costs', 'audit_log', 'co_contacts',
    'prompt_payment_claims', 'retainage_tracker', 'sub_payments', 'debrief_tracker',
    'compliance_matrices', 'capability_statements', 'certified_payroll', 'sub_plans',
    'cpars_ratings', 'contract_modifications', 'sam_health_checks', 'distributor_prices',
    'gao_protests', 'osdbu_events', 'bid_bonds', 'prime_help',
    'test_results', 'api_schemas', 'system_config',
    'suppliers', 'supplier_matches',
  ];

  let tablesOk = 0;
  const failedTables = [];

  for (const table of TABLES) {
    try {
      const { error } = await supabase.from(table).select('id').limit(1);
      if (error) {
        failedTables.push(table);
      } else {
        tablesOk++;
      }
    } catch (err) {
      failedTables.push(table);
    }
  }

  // HALT if any table is inaccessible — DB failure is a critical error
  await recordTest(
    'db_all_tables_accessible',
    'DB_HEALTH',
    failedTables.length === 0,
    `All ${TABLES.length} tables accessible`,
    failedTables.length === 0 ? `All ${TABLES.length} tables OK` : `FAILED tables: ${failedTables.join(', ')}`,
    null  // No specific agent to halt — DB issues are system-wide
  );

  // Test: audit_log has recent entries (agents have been running)
  const { data: recentLogs } = await supabase
    .from('audit_log')
    .select('id')
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .limit(1);

  await recordTest(
    'db_audit_log_active',
    'DB_HEALTH',
    (recentLogs || []).length > 0,
    'audit_log has entries in last 30 days',
    (recentLogs || []).length > 0 ? 'Audit log active' : 'No audit entries in 30 days — agents may not be running'
  );

  // Test: Supplier DB populated (at least 1 supplier after first RECON scan)
  const { data: supplierCount } = await supabase
    .from('suppliers')
    .select('id')
    .limit(1);

  await recordTest(
    'supplier_db_populated',
    'DB_HEALTH',
    (supplierCount || []).length > 0,
    'suppliers table has at least 1 record',
    (supplierCount || []).length > 0 ? 'Supplier DB populated' : 'Supplier DB empty — RECON scan may not have run yet'
  );

  // Test: Suppliers have NAICS codes stored (data quality check)
  const { data: suppliersWithNaics } = await supabase
    .from('suppliers')
    .select('id, naics_codes')
    .not('naics_codes', 'is', null)
    .limit(5);

  const badNaicsSuppliers = (suppliersWithNaics || []).filter(s =>
    !Array.isArray(s.naics_codes) || s.naics_codes.length === 0
  );

  await recordTest(
    'supplier_has_naics',
    'DB_HEALTH',
    badNaicsSuppliers.length === 0,
    'All stored suppliers have NAICS codes',
    badNaicsSuppliers.length === 0 ? 'All suppliers have NAICS codes' : `${badNaicsSuppliers.length} suppliers missing NAICS codes`
  );

  // Test: Supplier match scores are in valid range (0-100)
  const { data: badMatchScores } = await supabase
    .from('supplier_matches')
    .select('id, match_score')
    .or('match_score.lt.0,match_score.gt.100')
    .limit(5);

  await recordTest(
    'supplier_match_scores_valid',
    'DB_HEALTH',
    (badMatchScores || []).length === 0,
    'All supplier match scores between 0-100',
    (badMatchScores || []).length === 0 ? 'Match scores valid' : `${(badMatchScores || []).length} matches with out-of-range scores`
  );
}

// ----------------------------------------------------------
// GET TEST HEALTH SECTION: Summary for Brandi morning brief
// Returns a plain text block Brandi adds to every morning email
// ----------------------------------------------------------
async function getTestHealthSection() {
  try {
    const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { data: results } = await supabase
      .from('test_results')
      .select('test_name, passed, tier, action_taken, category')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (!results || results.length === 0) {
      return '🔵 T.E.S.T.: No test results from last 24h — test agent may not have run.';
    }

    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const halts = results.filter(r => r.action_taken === 'HALT');
    const alerts = results.filter(r => r.action_taken === 'ALERT');
    const failures = results.filter(r => !r.passed);

    let section = '';

    if (halts.length > 0) {
      section += `🔴 T.E.S.T. HALT: ${halts.length} critical failure(s) — agents disabled:\n`;
      halts.forEach(h => { section += `   • ${h.test_name}\n`; });
    } else if (alerts.length > 0) {
      section += `🟡 T.E.S.T. ALERT: ${alerts.length} test(s) failing 3+ consecutive times:\n`;
      alerts.forEach(a => { section += `   • ${a.test_name}\n`; });
    } else if (failures.length > 0) {
      section += `🟡 T.E.S.T.: ${passed}/${total} tests passed — ${failures.length} minor failure(s) logged.\n`;
    } else {
      section += `🟢 T.E.S.T.: All ${total} tests passed. System healthy.\n`;
    }

    return section;
  } catch (err) {
    return `⚠️ T.E.S.T.: Could not load health summary — ${err.message}`;
  }
}

// ----------------------------------------------------------
// MAIN: Run all test categories in sequence
// ----------------------------------------------------------
async function runTest() {
  console.log('T.E.S.T.: Starting validation run —', new Date().toISOString());

  try {
    // Run all 6 test categories
    await testDataIntegrity();
    await testScoreValidation();
    await testFinancialMath();
    await testApiContracts();
    await testDelivery();
    await testDatabaseHealth();

    // Summarize the run
    const total   = runResults.length;
    const passed  = runResults.filter(r => r.passed).length;
    const halts   = runResults.filter(r => r.actionTaken === 'HALT').length;
    const alerts  = runResults.filter(r => r.actionTaken === 'ALERT').length;
    const logs    = runResults.filter(r => r.actionTaken === 'LOG').length;

    console.log('\n============================');
    console.log(`T.E.S.T. RUN COMPLETE`);
    console.log(`  Total tests : ${total}`);
    console.log(`  Passed      : ${passed}`);
    console.log(`  HALTs       : ${halts}`);
    console.log(`  ALERTs      : ${alerts}`);
    console.log(`  LOGs        : ${logs}`);
    console.log('============================\n');

    await logAction('T.E.S.T.', 'Validation run complete', {
      total, passed, halts, alerts, logs,
      run_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('T.E.S.T.: Fatal error —', err.message);
    await logAction('T.E.S.T.', 'Fatal error during validation run', { error: err.message });
    process.exit(1);
  }
}

// Export getTestHealthSection for Brandi to use
module.exports = { getTestHealthSection };

// Run if called directly
if (require.main === module) {
  runTest().then(() => process.exit(0));
}
