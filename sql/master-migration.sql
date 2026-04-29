-- ================================================================
-- PRIME IQE MASTER MIGRATION — Axiom Federal Solutions
-- Version: 2026-04-29 (clean install for axiom-federal-solutions org)
--
-- HOW TO USE:
--   1. Go to your new Supabase project → SQL Editor → New Query
--   2. Paste this ENTIRE file
--   3. Click Run
--   4. Verify the final SELECT at the bottom shows 30 tables
--
-- This file is the single source of truth for the PRIME IQE schema.
-- It is safe to re-run — all CREATE statements use IF NOT EXISTS.
-- ================================================================


-- ================================================================
-- PART 1: CORE TABLES (9 tables)
-- ================================================================

-- TABLE 1: opportunities
-- Every federal contract found by SCOUT. One row per solicitation.
CREATE TABLE IF NOT EXISTS opportunities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitation_number   TEXT UNIQUE NOT NULL,
  title                 TEXT NOT NULL,
  agency                TEXT,
  sub_office            TEXT,
  naics                 TEXT,
  set_aside             TEXT,
  location              TEXT,
  state                 TEXT,
  value                 DECIMAL(12,2),
  posted_date           DATE,
  deadline              DATE,
  description_url       TEXT,
  source                TEXT DEFAULT 'SAM',
  -- Scoring columns (all three verticals)
  prime_score           INTEGER,          -- Construction PRIME Score (0-100)
  acq_score             NUMERIC(5,2),     -- Supply ACQ Score (0-100)
  lease_score           INTEGER,          -- Real Estate LEASE Score (0-100)
  pre_prime_score       INTEGER,          -- Quick pre-score before full JUDGE run
  -- Vertical and category routing
  vertical              TEXT DEFAULT 'construction',  -- 'construction', 'supply', 'realestate'
  supply_category       VARCHAR(20),      -- 'fuel','jan','ppe','office','food','chem','safety','uni'
  -- Status and workflow
  status                TEXT DEFAULT 'new'
                        CHECK (status IN ('new','reviewing','pursuing','passed','expired','scored','rejected')),
  passed_at             TIMESTAMPTZ,
  passed_reason         TEXT,
  needs_scoring         BOOLEAN DEFAULT false,
  -- Alert tracking
  alert_level           TEXT,
  alert_sent            BOOLEAN DEFAULT false,
  alert_sent_at         TIMESTAMPTZ,
  -- Scoring detail
  score_factors         JSONB DEFAULT '{}',
  scoring_factors       JSONB DEFAULT '{}',
  recommendation        TEXT,
  tier                  TEXT,
  reasoning             TEXT,
  -- Additional fields
  type                  TEXT DEFAULT 'construction',
  place_of_performance  TEXT,
  description           TEXT,
  raw_data              JSONB DEFAULT '{}',
  -- Site visit (Construction)
  site_visit_required   BOOLEAN DEFAULT false,
  site_visit_date       DATE,
  site_visit_location   TEXT,
  site_visit_attended   BOOLEAN DEFAULT false,
  -- Decision tracking
  scored_at             TIMESTAMPTZ,
  decision_made_at      TIMESTAMPTZ,
  decision_age_days     INTEGER,
  -- Legacy columns (kept for backward compat)
  pricing_data          JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opps_status           ON opportunities (status);
CREATE INDEX IF NOT EXISTS idx_opps_prime_score      ON opportunities (prime_score DESC);
CREATE INDEX IF NOT EXISTS idx_opps_deadline         ON opportunities (deadline);
CREATE INDEX IF NOT EXISTS idx_opps_naics            ON opportunities (naics);
CREATE INDEX IF NOT EXISTS idx_opps_vertical         ON opportunities (vertical);
CREATE INDEX IF NOT EXISTS idx_opps_supply_category  ON opportunities (supply_category) WHERE supply_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opps_status_score     ON opportunities (status, prime_score DESC NULLS LAST);


-- TABLE 2: bids
CREATE TABLE IF NOT EXISTS bids (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id        UUID REFERENCES opportunities(id),
  status                TEXT DEFAULT 'pending_pricing',
  decision              TEXT,
  decision_date         DATE,
  proposal_url          TEXT,
  proposal_data         JSONB DEFAULT '{}',
  pricing_data          JSONB DEFAULT '{}',
  compliance_matrix_id  UUID,
  bond_required         BOOLEAN DEFAULT false,
  bond_received         BOOLEAN DEFAULT false,
  submitted_date        DATE,
  result                TEXT,
  debrief_requested     BOOLEAN DEFAULT false,
  prime_score           INTEGER,
  compliance_checks     JSONB DEFAULT '[]',
  compliance_status     TEXT,
  compliance_date       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bids_opportunity ON bids (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_bids_status      ON bids (status);
CREATE INDEX IF NOT EXISTS idx_bids_result      ON bids (result);


-- TABLE 3: active_contracts
CREATE TABLE IF NOT EXISTS active_contracts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number       TEXT UNIQUE NOT NULL,
  opportunity_id        UUID REFERENCES opportunities(id),
  agency                TEXT,
  title                 TEXT,
  value                 DECIMAL(12,2),
  start_date            DATE,
  end_date              DATE,
  status                TEXT DEFAULT 'active',
  retainage_held        DECIMAL(14,2) DEFAULT 0,
  total_invoiced        DECIMAL(14,2) DEFAULT 0,
  total_paid            DECIMAL(14,2) DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_status ON active_contracts (status);


-- TABLE 4: compliance
CREATE TABLE IF NOT EXISTS compliance (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  issuer      TEXT,
  number      TEXT,
  issue_date  DATE,
  expiry_date DATE,
  state       TEXT,
  status      TEXT DEFAULT 'active',
  renewal_url TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_status ON compliance (status);
CREATE INDEX IF NOT EXISTS idx_compliance_expiry ON compliance (expiry_date);


-- TABLE 5: incumbents
-- Includes naics, agency, state, source — required by recon.js upsert
CREATE TABLE IF NOT EXISTS incumbents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitation_number TEXT UNIQUE,
  incumbent_name      TEXT NOT NULL,
  naics               TEXT,
  contract_value      DECIMAL(12,2),
  start_date          DATE,
  end_date            DATE,
  recompete_date      DATE,
  agency              TEXT,
  state               TEXT,
  source              TEXT DEFAULT 'FPDS',
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incumbents_recompete ON incumbents (recompete_date);
CREATE INDEX IF NOT EXISTS idx_incumbents_naics     ON incumbents (naics);


-- TABLE 6: competitor_prices
CREATE TABLE IF NOT EXISTS competitor_prices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitation_number TEXT,
  competitor_name     TEXT NOT NULL,
  bid_amount          DECIMAL(12,2),
  is_winner           BOOLEAN DEFAULT false,
  source              TEXT,
  recorded_date       DATE DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ DEFAULT now()
);


-- TABLE 7: job_costs
CREATE TABLE IF NOT EXISTS job_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  UUID REFERENCES active_contracts(id),
  category     TEXT NOT NULL,
  description  TEXT,
  budgeted     DECIMAL(10,2),
  actual       DECIMAL(10,2),
  variance_pct DECIMAL(5,2),
  period       TEXT,
  source       TEXT DEFAULT 'quickbooks',
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_costs_contract ON job_costs (contract_id);


-- TABLE 8: audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent      TEXT NOT NULL,
  action     TEXT NOT NULL,
  details    JSONB DEFAULT '{}',
  outcome    TEXT,
  approver   TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_agent      ON audit_log (agent);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log (created_at DESC);


-- TABLE 9: co_contacts
CREATE TABLE IF NOT EXISTS co_contacts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  title                TEXT,
  agency               TEXT,
  sub_office           TEXT,
  email                TEXT,
  phone                TEXT,
  opportunities_linked INTEGER DEFAULT 0,
  last_interaction     DATE,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);


-- ================================================================
-- PART 2: EXTENDED TABLES (16 tables)
-- ================================================================

CREATE TABLE IF NOT EXISTS prompt_payment_claims (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      TEXT NOT NULL,
  invoice_number   TEXT NOT NULL,
  invoice_date     DATE NOT NULL,
  invoice_amount   DECIMAL(12,2) DEFAULT 0,
  payment_due      DATE NOT NULL,
  payment_received DATE,
  days_late        INTEGER,
  treasury_rate    DECIMAL(5,4),
  interest_owed    DECIMAL(10,2),
  claim_status     TEXT DEFAULT 'pending',
  claim_letter_url TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retainage_tracker (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id          TEXT NOT NULL,
  total_contract_value DECIMAL(12,2),
  retainage_rate       DECIMAL(4,2) DEFAULT 0.10,
  retainage_held       DECIMAL(12,2) DEFAULT 0,
  release_requested    BOOLEAN DEFAULT false,
  release_request_date DATE,
  release_received     BOOLEAN DEFAULT false,
  followup_count       INTEGER DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sub_payments (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id                TEXT NOT NULL,
  sub_name                   TEXT NOT NULL,
  sub_invoice_amount         DECIMAL(10,2),
  govt_payment_received_date DATE,
  sub_payment_due            DATE,
  sub_payment_sent_date      DATE,
  days_to_pay                INTEGER,
  compliant                  BOOLEAN,
  created_at                 TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS debrief_tracker (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id                   TEXT NOT NULL,
  solicitation_id          TEXT NOT NULL,
  agency                   TEXT,
  loss_date                DATE,
  debrief_requested        BOOLEAN DEFAULT false,
  debrief_request_deadline DATE,
  debrief_date             DATE,
  feedback_summary         TEXT,
  lessons                  JSONB DEFAULT '[]',
  applied_to_future        BOOLEAN DEFAULT false,
  created_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debrief_deadline ON debrief_tracker (debrief_request_deadline);

CREATE TABLE IF NOT EXISTS compliance_matrices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id          TEXT NOT NULL,
  solicitation_id TEXT NOT NULL,
  requirements    JSONB DEFAULT '[]',
  compliance_pct  DECIMAL(5,2) DEFAULT 0,
  generated_at    TIMESTAMPTZ DEFAULT now(),
  last_updated    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS capability_statements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_agency TEXT,
  target_naics  TEXT,
  version       INTEGER DEFAULT 1,
  content       JSONB,
  pdf_url       TEXT,
  generated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certified_payroll (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id          TEXT NOT NULL,
  week_ending          DATE NOT NULL,
  workers              JSONB DEFAULT '[]',
  wage_determination_id TEXT,
  total_hours          DECIMAL(8,2),
  total_gross_pay      DECIMAL(10,2),
  form_url             TEXT,
  submitted            BOOLEAN DEFAULT false,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_contract_week ON certified_payroll (contract_id, week_ending);

CREATE TABLE IF NOT EXISTS sub_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      TEXT NOT NULL,
  contract_value   DECIMAL(12,2),
  sb_goal_pct      DECIMAL(5,2),
  hubzone_goal_pct DECIMAL(5,2),
  eight_a_goal_pct DECIMAL(5,2),
  wosb_goal_pct    DECIMAL(5,2),
  sdvosb_goal_pct  DECIMAL(5,2),
  plan_doc_url     TEXT,
  compliant        BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cpars_ratings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id        TEXT NOT NULL,
  evaluation_date    DATE,
  overall_rating     TEXT,
  quality_rating     TEXT,
  schedule_rating    TEXT,
  cost_rating        TEXT,
  response_deadline  DATE,
  response_submitted BOOLEAN DEFAULT false,
  response_doc_url   TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_modifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     TEXT NOT NULL,
  mod_number      TEXT NOT NULL,
  mod_type        TEXT,
  description     TEXT,
  value_change    DECIMAL(12,2) DEFAULT 0,
  new_total_value DECIMAL(12,2),
  new_end_date    DATE,
  rea_required    BOOLEAN DEFAULT false,
  detected_date   DATE DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sam_health_checks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_date          DATE DEFAULT CURRENT_DATE,
  registration_status TEXT,
  expiration_date     DATE,
  days_to_expiry      INTEGER,
  naics_match         BOOLEAN,
  address_current     BOOLEAN,
  issues              JSONB DEFAULT '[]',
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- distributor_prices: avoid generated column issue — using view instead
CREATE TABLE IF NOT EXISTS distributor_prices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_name TEXT NOT NULL,
  product_category TEXT,
  unit_price       DECIMAL(10,2),
  quote_date       DATE NOT NULL,
  quote_expiry     DATE,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gao_protests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gao_case_number TEXT,
  solicitation_id TEXT,
  protester       TEXT,
  awardee         TEXT,
  agency          TEXT,
  filed_date      DATE,
  outcome         TEXT,
  impacts_walker  BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS osdbu_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency           TEXT NOT NULL,
  event_name       TEXT NOT NULL,
  event_date       DATE,
  event_type       TEXT,
  registration_url TEXT,
  registered       BOOLEAN DEFAULT false,
  attended         BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bid_bonds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id          TEXT NOT NULL,
  solicitation_id TEXT UNIQUE,
  bond_amount     DECIMAL(12,2),
  bond_pct        DECIMAL(5,2) DEFAULT 20.0,
  surety_agent    TEXT,
  request_sent    BOOLEAN DEFAULT false,
  bond_received   BOOLEAN DEFAULT false,
  bid_deadline    DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prime_help (
  id            TEXT PRIMARY KEY,
  term          TEXT NOT NULL,
  category      TEXT NOT NULL,
  explanation   TEXT NOT NULL,
  reading_level INTEGER DEFAULT 7,
  agent         TEXT,
  related_terms TEXT[] DEFAULT '{}',
  last_updated  TIMESTAMPTZ DEFAULT now(),
  auto_generated BOOLEAN DEFAULT true,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', term || ' ' || category || ' ' || explanation)
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_help_search   ON prime_help USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_help_category ON prime_help (category);


-- ================================================================
-- PART 3: SYSTEM TABLES (4 tables)
-- ================================================================

-- agent_logs: every action every agent takes
CREATE TABLE IF NOT EXISTS agent_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent      TEXT NOT NULL,
  action     TEXT NOT NULL,
  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_agent      ON agent_logs (agent);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs (created_at DESC);


-- system_config: key-value runtime settings + kill switch
CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);


-- agent_cost_log: Claude AI spend per agent per day
CREATE TABLE IF NOT EXISTS agent_cost_log (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent     TEXT NOT NULL,
  date      DATE NOT NULL,
  cost_usd  DECIMAL(10,6) DEFAULT 0,
  model     TEXT,
  details   JSONB DEFAULT '{}',
  logged_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_log_agent_date ON agent_cost_log (agent, date);
CREATE INDEX IF NOT EXISTS idx_cost_log_date       ON agent_cost_log (date DESC);


-- competitor_intel: FPDS award data — who won similar contracts
CREATE TABLE IF NOT EXISTS competitor_intel (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  naics        TEXT,
  award_value  DECIMAL(12,2),
  award_date   DATE,
  agency       TEXT,
  state        TEXT,
  source       TEXT DEFAULT 'FPDS',
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_unique ON competitor_intel (company_name, naics, award_date);
CREATE INDEX IF NOT EXISTS idx_competitor_naics ON competitor_intel (naics);


-- ================================================================
-- PART 4: T.E.S.T. + SUPPLIER INTEL TABLES
-- ================================================================

-- test_results: T.E.S.T. v2 assertion log
CREATE TABLE IF NOT EXISTS test_results (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name            TEXT NOT NULL,
  category             TEXT NOT NULL,
  tier                 INTEGER DEFAULT 0,
  passed               BOOLEAN NOT NULL,
  expected             TEXT,
  actual               TEXT,
  agent_target         TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  action_taken         TEXT DEFAULT 'PASS',
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_results_date   ON test_results (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_name   ON test_results (test_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_failed ON test_results (passed, created_at DESC) WHERE NOT passed;
CREATE INDEX IF NOT EXISTS idx_test_results_halts  ON test_results (action_taken, created_at DESC) WHERE action_taken = 'HALT';


-- api_schemas: external API health tracking
CREATE TABLE IF NOT EXISTS api_schemas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name         TEXT UNIQUE NOT NULL,
  endpoint_url     TEXT,
  endpoint         TEXT,
  expected_schema  JSONB DEFAULT '{}',
  last_validated   TIMESTAMPTZ,
  mismatch_details JSONB,
  schema_hash      TEXT,
  status           TEXT DEFAULT 'unknown',
  response_time_ms INTEGER,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);


-- suppliers: federal contractor database
CREATE TABLE IF NOT EXISTS suppliers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uei                     TEXT UNIQUE,
  sam_uei                 TEXT,
  name                    TEXT NOT NULL,
  dba                     TEXT,
  cage_code               TEXT,
  state                   TEXT,
  city                    TEXT,
  contact_name            TEXT,
  contact_email           TEXT,
  naics_codes             TEXT[] DEFAULT '{}',
  certifications          TEXT[] DEFAULT '{}',
  socioeconomic           TEXT[] DEFAULT '{}',
  sam_registered          BOOLEAN DEFAULT true,
  federal_contract_count  INTEGER DEFAULT 0,
  avg_contract_value      DECIMAL(14,2) DEFAULT 0,
  last_award_date         DATE,
  agencies_worked         INTEGER DEFAULT 0,
  capability_tier         TEXT DEFAULT 'small',
  specialties             TEXT[] DEFAULT '{}',
  sba_enriched_at         TIMESTAMPTZ,
  usaspending_enriched_at TIMESTAMPTZ,
  status                  TEXT DEFAULT 'active',
  source                  TEXT DEFAULT 'SAM',
  updated_at              TIMESTAMPTZ DEFAULT now(),
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_naics    ON suppliers USING GIN (naics_codes);
CREATE INDEX IF NOT EXISTS idx_suppliers_certs    ON suppliers USING GIN (certifications);
CREATE INDEX IF NOT EXISTS idx_suppliers_socio    ON suppliers USING GIN (socioeconomic);
CREATE INDEX IF NOT EXISTS idx_suppliers_state    ON suppliers (state);
CREATE INDEX IF NOT EXISTS idx_suppliers_status   ON suppliers (status);
CREATE INDEX IF NOT EXISTS idx_suppliers_cage     ON suppliers (cage_code);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_fts ON suppliers USING GIN (
  to_tsvector('english', coalesce(name, '') || ' ' || array_to_string(specialties, ' '))
);


-- supplier_matches: per-opportunity supplier recommendations
CREATE TABLE IF NOT EXISTS supplier_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  UUID REFERENCES opportunities(id) ON DELETE CASCADE,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_name   TEXT,
  naics           TEXT,
  match_score     INTEGER NOT NULL CHECK (match_score >= 0 AND match_score <= 100),
  match_type      TEXT NOT NULL,
  score_breakdown JSONB DEFAULT '{}',
  certifications  TEXT[],
  state           TEXT,
  fed_contract_count INTEGER DEFAULT 0,
  avg_contract_value DECIMAL(14,2) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (opportunity_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_matches_opp   ON supplier_matches (opportunity_id, match_score DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_matches_type  ON supplier_matches (match_type);
CREATE INDEX IF NOT EXISTS idx_supplier_matches_score ON supplier_matches (match_score DESC);


-- ================================================================
-- PART 5: VIEWS
-- ================================================================

CREATE OR REPLACE VIEW stale_prices AS
SELECT *, (quote_date < CURRENT_DATE - INTERVAL '14 days') AS is_stale_now
FROM distributor_prices;

CREATE OR REPLACE VIEW late_invoices AS
SELECT *, (CURRENT_DATE - payment_due) AS days_late_now
FROM prompt_payment_claims
WHERE payment_received IS NULL AND payment_due < CURRENT_DATE;

CREATE OR REPLACE VIEW noncompliant_sub_payments AS
SELECT *, (days_to_pay > 7) AS is_noncompliant
FROM sub_payments
WHERE days_to_pay IS NOT NULL;


-- ================================================================
-- PART 6: SEED DATA
-- ================================================================

-- system_config: kill switch + agent enable flags
INSERT INTO system_config (key, value, description) VALUES
  ('SYSTEM_HALT',             'false', 'Global emergency kill switch — halts ALL agents immediately'),
  ('SAM_CALLS_TODAY',         '0',     'Daily SAM.gov API call counter — reset at midnight'),
  ('AGENT_SCOUT_ENABLED',     'true',  'S.C.O.U.T. enable flag — set false to halt'),
  ('AGENT_JUDGE_ENABLED',     'true',  'J.U.D.G.E. enable flag — set false to halt'),
  ('AGENT_VAULT_ENABLED',     'true',  'V.A.U.L.T. enable flag — set false to halt'),
  ('AGENT_RECON_ENABLED',     'true',  'R.E.C.O.N. enable flag — set false to halt'),
  ('AGENT_DRAFT_ENABLED',     'true',  'D.R.A.F.T. enable flag — set false to halt'),
  ('AGENT_BIDENGINE_ENABLED', 'true',  'B.I.D. ENGINE enable flag — set false to halt'),
  ('AGENT_LEDGER_ENABLED',    'true',  'L.E.D.G.E.R. enable flag — set false to halt'),
  ('AGENT_EXEC_ENABLED',      'true',  'E.X.E.C. enable flag — set false to halt'),
  ('AGENT_TEST_ENABLED',      'true',  'T.E.S.T. enable flag'),
  ('AGENT_BRANDI_ENABLED',    'true',  'B.R.A.N.D.I. enable flag — set false to halt')
ON CONFLICT (key) DO NOTHING;

-- api_schemas: seed known external APIs (update Supabase URL after project creation)
INSERT INTO api_schemas (api_name, endpoint_url, endpoint, status) VALUES
  ('SAM.gov',    'https://api.sam.gov/opportunities/v2/search',   'https://api.sam.gov/opportunities/v2/search',   'unknown'),
  ('Supabase',   'https://czoyvxyfewqaoewzxlin.supabase.co', 'https://czoyvxyfewqaoewzxlin.supabase.co', 'unknown'),
  ('SendGrid',   'https://api.sendgrid.com/v3',                    'https://api.sendgrid.com/v3',                    'unknown'),
  ('Anthropic',  'https://api.anthropic.com/v1',                   'https://api.anthropic.com/v1',                   'unknown'),
  ('USASpending','https://api.usaspending.gov/api/v2',             'https://api.usaspending.gov/api/v2',             'unknown')
ON CONFLICT (api_name) DO NOTHING;


-- ================================================================
-- PART 7: ROW LEVEL SECURITY (RLS)
-- Dashboard uses anon key → read-only on 12 tables
-- Agents use service role key → bypass RLS entirely
-- ================================================================

-- Dashboard-facing tables: anon READ allowed
ALTER TABLE opportunities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids               ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_matches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE osdbu_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_contracts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_payment_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_intel   ENABLE ROW LEVEL SECURITY;
ALTER TABLE incumbents         ENABLE ROW LEVEL SECURITY;

-- Drop policies first so this file is safely re-runnable
DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'opportunities','bids','supplier_matches','suppliers','audit_log',
    'system_config','test_results','osdbu_events','active_contracts',
    'prompt_payment_claims','competitor_intel','incumbents'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_read" ON %I', t);
  END LOOP;
END $$;

CREATE POLICY "anon_read" ON opportunities       FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON bids                FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON supplier_matches    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON suppliers           FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON audit_log           FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON system_config       FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON test_results        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON osdbu_events        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON active_contracts    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON prompt_payment_claims FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON competitor_intel    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON incumbents          FOR SELECT TO anon USING (true);

-- Backend-only tables: RLS enabled, no anon policy = deny all
ALTER TABLE agent_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_cost_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_schemas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance            ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_prices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_costs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE co_contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE retainage_tracker     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE debrief_tracker       ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_matrices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE certified_payroll     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpars_ratings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE sam_health_checks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE distributor_prices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gao_protests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_bonds             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prime_help            ENABLE ROW LEVEL SECURITY;


-- ================================================================
-- VERIFICATION — Run this after everything above
-- Expected result: 30 tables listed
-- ================================================================
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns c
   WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS col_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_type   = 'BASE TABLE'
ORDER BY table_name;
