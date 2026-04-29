-- ============================================================
-- PRIME IQE SYSTEM — Row Level Security (RLS) Policies
-- ============================================================
--
-- SECURITY MODEL:
--
--   Backend Agents (SUPABASE_SERVICE_KEY / service role):
--     Supabase's service role BYPASSES RLS entirely by default.
--     No explicit policies are needed for agents — they always have
--     full read/write access to every table.
--
--   Dashboard (anon key, hardcoded in index.html):
--     The anon role gets READ-ONLY access to dashboard-facing tables.
--     No INSERT, UPDATE, or DELETE is granted to anon — ever.
--     Omitting a policy = deny by default in Supabase.
--
-- WHEN TO RUN:
--   Paste this entire file into the Supabase SQL Editor and click Run.
--   Safe to re-run — CREATE POLICY will error if policy already exists,
--   but ENABLE ROW LEVEL SECURITY is idempotent.
--   To re-run cleanly, drop existing policies first or use:
--     DROP POLICY IF EXISTS "anon_read" ON tablename;
--
-- TABLES WITH ANON READ ACCESS (dashboard-facing):
--   opportunities, bids, supplier_matches, suppliers, audit_log,
--   system_config, test_results, osdbu_events, active_contracts,
--   prompt_payment_claims, competitor_intel, incumbents
--
-- TABLES WITH NO ANON ACCESS (backend-only / sensitive):
--   agent_logs, agent_cost_log, api_schemas,
--   compliance, competitor_prices, job_costs, co_contacts,
--   retainage_tracker, sub_payments, debrief_tracker,
--   compliance_matrices, capability_statements, certified_payroll,
--   sub_plans, cpars_ratings, contract_modifications,
--   sam_health_checks, distributor_prices, gao_protests,
--   bid_bonds, prime_help
--
-- Generated: 2026-04-29
-- ============================================================


-- ============================================================
-- PART 1: DASHBOARD-FACING TABLES (anon READ allowed)
-- ============================================================


-- ═══ OPPORTUNITIES ═══
-- Core pipeline table — dashboard reads status, scores, deadlines
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON opportunities
  FOR SELECT TO anon USING (true);


-- ═══ BIDS ═══
-- Bid decisions and proposal status — visible on dashboard
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON bids
  FOR SELECT TO anon USING (true);


-- ═══ SUPPLIER_MATCHES ═══
-- Per-opportunity teaming/sub recommendations — dashboard display
ALTER TABLE supplier_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON supplier_matches
  FOR SELECT TO anon USING (true);


-- ═══ SUPPLIERS ═══
-- Federal contractor database — dashboard supplier search
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON suppliers
  FOR SELECT TO anon USING (true);


-- ═══ AUDIT_LOG ═══
-- Agent action trail — dashboard activity feed
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON audit_log
  FOR SELECT TO anon USING (true);


-- ═══ SYSTEM_CONFIG ═══
-- Runtime settings and kill switch — dashboard reads agent status
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON system_config
  FOR SELECT TO anon USING (true);


-- ═══ TEST_RESULTS ═══
-- T.E.S.T. assertions — dashboard health panel
ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON test_results
  FOR SELECT TO anon USING (true);


-- ═══ OSDBU_EVENTS ═══
-- Agency matchmaking events — dashboard event calendar
ALTER TABLE osdbu_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON osdbu_events
  FOR SELECT TO anon USING (true);


-- ═══ ACTIVE_CONTRACTS ═══
-- Contracts being performed — dashboard contract tracker
ALTER TABLE active_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON active_contracts
  FOR SELECT TO anon USING (true);


-- ═══ PROMPT_PAYMENT_CLAIMS ═══
-- Late payment interest claims — dashboard payment monitor
ALTER TABLE prompt_payment_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON prompt_payment_claims
  FOR SELECT TO anon USING (true);


-- ═══ COMPETITOR_INTEL ═══
-- FPDS competitor award data — dashboard competitive analysis
ALTER TABLE competitor_intel ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON competitor_intel
  FOR SELECT TO anon USING (true);


-- ═══ INCUMBENTS ═══
-- Current contract holders — dashboard opportunity research
ALTER TABLE incumbents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON incumbents
  FOR SELECT TO anon USING (true);


-- ============================================================
-- PART 2: BACKEND-ONLY TABLES (no anon access)
-- RLS enabled, but no anon policy = deny all anon by default
-- ============================================================


-- ═══ AGENT_LOGS ═══
-- Full agent action trace — sensitive operational data
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ AGENT_COST_LOG ═══
-- Claude AI spend tracking — financial/operational sensitive
ALTER TABLE agent_cost_log ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ API_SCHEMAS ═══
-- External API schema snapshots — internal T.E.S.T. infrastructure
ALTER TABLE api_schemas ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ COMPLIANCE ═══
-- Licenses, certs, insurance — sensitive company documents
ALTER TABLE compliance ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ COMPETITOR_PRICES ═══
-- Public bid prices — internal pricing strategy data
ALTER TABLE competitor_prices ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ JOB_COSTS ═══
-- Actual vs budgeted project costs — financial sensitive
ALTER TABLE job_costs ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ CO_CONTACTS ═══
-- Contracting Officer database — relationship intelligence
ALTER TABLE co_contacts ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ RETAINAGE_TRACKER ═══
-- Contract hold-back monitoring — financial sensitive
ALTER TABLE retainage_tracker ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ SUB_PAYMENTS ═══
-- Subcontractor payment compliance records — sensitive
ALTER TABLE sub_payments ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ DEBRIEF_TRACKER ═══
-- Post-loss debrief intelligence — competitive sensitive
ALTER TABLE debrief_tracker ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ COMPLIANCE_MATRICES ═══
-- RFP requirement mapping — proposal strategy sensitive
ALTER TABLE compliance_matrices ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ CAPABILITY_STATEMENTS ═══
-- Agency-tailored capability PDFs — internal marketing docs
ALTER TABLE capability_statements ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ CERTIFIED_PAYROLL ═══
-- WH-347 Davis-Bacon records — labor compliance sensitive
ALTER TABLE certified_payroll ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ SUB_PLANS ═══
-- Small business subcontracting plans — compliance sensitive
ALTER TABLE sub_plans ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ CPARS_RATINGS ═══
-- Performance evaluations — highly sensitive company record
ALTER TABLE cpars_ratings ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ CONTRACT_MODIFICATIONS ═══
-- Contract mod tracking and REA flags — operational sensitive
ALTER TABLE contract_modifications ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ SAM_HEALTH_CHECKS ═══
-- SAM.gov registration validation — internal compliance data
ALTER TABLE sam_health_checks ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ DISTRIBUTOR_PRICES ═══
-- Supplier quotes — pricing strategy sensitive
ALTER TABLE distributor_prices ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ GAO_PROTESTS ═══
-- Bid protest docket data — legal/competitive sensitive
ALTER TABLE gao_protests ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ BID_BONDS ═══
-- Surety bond tracking — financial/legal sensitive
ALTER TABLE bid_bonds ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ═══ PRIME_HELP ═══
-- Internal knowledge base — backend agent infrastructure
ALTER TABLE prime_help ENABLE ROW LEVEL SECURITY;
-- No anon policy: anon role has zero access


-- ============================================================
-- VERIFICATION QUERY
-- Run this after applying policies to confirm all tables
-- have RLS enabled. Expected: 33 rows with relrowsecurity = true
-- ============================================================
--
-- SELECT relname AS table_name, relrowsecurity AS rls_enabled
-- FROM pg_class
-- WHERE relname IN (
--   'opportunities', 'bids', 'supplier_matches', 'suppliers',
--   'audit_log', 'system_config', 'test_results', 'osdbu_events',
--   'active_contracts', 'prompt_payment_claims', 'competitor_intel',
--   'incumbents', 'agent_logs', 'agent_cost_log', 'api_schemas',
--   'compliance', 'competitor_prices', 'job_costs', 'co_contacts',
--   'retainage_tracker', 'sub_payments', 'debrief_tracker',
--   'compliance_matrices', 'capability_statements', 'certified_payroll',
--   'sub_plans', 'cpars_ratings', 'contract_modifications',
--   'sam_health_checks', 'distributor_prices', 'gao_protests',
--   'bid_bonds', 'prime_help'
-- )
-- ORDER BY table_name;
