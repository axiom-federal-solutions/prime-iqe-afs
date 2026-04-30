-- ============================================================
-- PRIME IQE — Full Data Wipe
-- Clears all pulled pipeline data. Keeps schema intact.
-- Run in: Supabase → SQL Editor → New Query → Paste → Run
-- Project: czoyvxyfewqaoewzxlin (prime-db)
-- ============================================================

-- Step 1: Clear all opportunity pipeline data
TRUNCATE TABLE opportunities     RESTART IDENTITY CASCADE;
TRUNCATE TABLE bids              RESTART IDENTITY CASCADE;
TRUNCATE TABLE supplier_matches  RESTART IDENTITY CASCADE;
TRUNCATE TABLE test_results      RESTART IDENTITY CASCADE;
TRUNCATE TABLE agent_logs        RESTART IDENTITY CASCADE;

-- Step 2: Clear financial / active project data
TRUNCATE TABLE prompt_payment_claims  RESTART IDENTITY CASCADE;
TRUNCATE TABLE active_contracts       RESTART IDENTITY CASCADE;
TRUNCATE TABLE retainage_tracker      RESTART IDENTITY CASCADE;
TRUNCATE TABLE sub_payments           RESTART IDENTITY CASCADE;
TRUNCATE TABLE job_costs              RESTART IDENTITY CASCADE;
TRUNCATE TABLE certified_payroll      RESTART IDENTITY CASCADE;
TRUNCATE TABLE contract_modifications RESTART IDENTITY CASCADE;
TRUNCATE TABLE debrief_tracker        RESTART IDENTITY CASCADE;

-- Step 3: Clear intel / market data
TRUNCATE TABLE incumbents         RESTART IDENTITY CASCADE;
TRUNCATE TABLE competitor_prices  RESTART IDENTITY CASCADE;
TRUNCATE TABLE cpars_ratings      RESTART IDENTITY CASCADE;
TRUNCATE TABLE gao_protests       RESTART IDENTITY CASCADE;
TRUNCATE TABLE osdbu_events       RESTART IDENTITY CASCADE;
TRUNCATE TABLE distributor_prices RESTART IDENTITY CASCADE;
TRUNCATE TABLE sam_health_checks  RESTART IDENTITY CASCADE;
TRUNCATE TABLE bid_bonds          RESTART IDENTITY CASCADE;
TRUNCATE TABLE compliance_matrices RESTART IDENTITY CASCADE;

-- Step 4: Clear audit trail (fresh start)
TRUNCATE TABLE audit_log RESTART IDENTITY CASCADE;

-- Step 5: Reset SAM.gov quota counter to 0
UPDATE system_config
SET value = '0', updated_at = NOW()
WHERE key = 'SAM_CALLS_TODAY';

-- Step 6: Re-seed api_schemas if it was cleared
INSERT INTO api_schemas (api_name, endpoint, status) VALUES
  ('SAM.gov',    'https://api.sam.gov/opportunities/v2/search', 'unknown'),
  ('Supabase',   'https://czoyvxyfewqaoewzxlin.supabase.co',   'unknown'),
  ('SendGrid',   'https://api.sendgrid.com/v3',                 'unknown'),
  ('Anthropic',  'https://api.anthropic.com/v1',               'unknown'),
  ('USASpending','https://api.usaspending.gov/api/v2',         'unknown')
ON CONFLICT (api_name) DO NOTHING;

-- ── VERIFY: Count rows in key tables after wipe ────────────
SELECT 'opportunities'      AS table_name, COUNT(*) AS rows FROM opportunities
UNION ALL
SELECT 'bids',                              COUNT(*) FROM bids
UNION ALL
SELECT 'agent_logs',                        COUNT(*) FROM agent_logs
UNION ALL
SELECT 'test_results',                      COUNT(*) FROM test_results
UNION ALL
SELECT 'supplier_matches',                  COUNT(*) FROM supplier_matches
UNION ALL
SELECT 'system_config (SAM quota)',         COUNT(*) FROM system_config WHERE key = 'SAM_CALLS_TODAY'
ORDER BY table_name;

-- Expected result: all rows = 0 (except system_config = 1 with value '0')
