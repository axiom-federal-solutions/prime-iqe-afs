-- ============================================================
-- PRIME SYSTEM — Complete Database Setup
-- Paste this entire file into Supabase SQL Editor and click Run
-- Creates all 25 tables in the correct order
-- ============================================================


-- ============================================================
-- PART 1: CORE TABLES (9 tables)
-- These are the foundation — every agent uses at least one
-- ============================================================


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
  prime_score           INTEGER,
  acq_score             INTEGER,
  status                TEXT DEFAULT 'new',
  site_visit_required   BOOLEAN DEFAULT false,
  site_visit_date       TIMESTAMPTZ,
  site_visit_location   TEXT,
  site_visit_attended   BOOLEAN DEFAULT false,
  scored_at             TIMESTAMPTZ,
  decision_made_at      TIMESTAMPTZ,
  decision_age_days     INTEGER,
  scoring_factors       JSONB DEFAULT '{}',
  pricing_data          JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opps_status      ON opportunities (status);
CREATE INDEX IF NOT EXISTS idx_opps_prime_score ON opportunities (prime_score DESC);
CREATE INDEX IF NOT EXISTS idx_opps_deadline    ON opportunities (deadline);
CREATE INDEX IF NOT EXISTS idx_opps_naics       ON opportunities (naics);


-- TABLE 2: bids
-- Every bid decision, proposal draft, and submission.
CREATE TABLE IF NOT EXISTS bids (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id        UUID REFERENCES opportunities(id),
  status                TEXT DEFAULT 'draft',
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
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bids_opportunity ON bids (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_bids_status      ON bids (status);
CREATE INDEX IF NOT EXISTS idx_bids_result      ON bids (result);


-- TABLE 3: active_contracts
-- Every contract won and currently being performed.
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
  retainage_held        DECIMAL(12,2) DEFAULT 0,
  total_invoiced        DECIMAL(12,2) DEFAULT 0,
  total_paid            DECIMAL(12,2) DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_status ON active_contracts (status);


-- TABLE 4: compliance
-- Every certification, license, and insurance policy VAULT tracks.
CREATE TABLE IF NOT EXISTS compliance (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  issuer                TEXT,
  number                TEXT,
  issue_date            DATE,
  expiry_date           DATE,
  state                 TEXT,
  status                TEXT DEFAULT 'active',
  renewal_url           TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_status ON compliance (status);
CREATE INDEX IF NOT EXISTS idx_compliance_expiry ON compliance (expiry_date);


-- TABLE 5: incumbents
-- Who currently holds each contract. RECON populates from USAspending.
CREATE TABLE IF NOT EXISTS incumbents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitation_number   TEXT UNIQUE,
  incumbent_name        TEXT NOT NULL,
  contract_value        DECIMAL(12,2),
  start_date            DATE,
  end_date              DATE,
  recompete_date        DATE,
  source                TEXT DEFAULT 'USAspending',
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incumbents_recompete ON incumbents (recompete_date);


-- TABLE 6: competitor_prices
-- Public bid opening prices captured by BID ENGINE.
CREATE TABLE IF NOT EXISTS competitor_prices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitation_number   TEXT,
  competitor_name       TEXT NOT NULL,
  bid_amount            DECIMAL(12,2),
  is_winner             BOOLEAN DEFAULT false,
  source                TEXT,
  recorded_date         DATE DEFAULT CURRENT_DATE,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- TABLE 7: job_costs
-- Actual project costs compared to bid estimates.
CREATE TABLE IF NOT EXISTS job_costs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID REFERENCES active_contracts(id),
  category              TEXT NOT NULL,
  description           TEXT,
  budgeted              DECIMAL(10,2),
  actual                DECIMAL(10,2),
  variance_pct          DECIMAL(5,2),
  period                TEXT,
  source                TEXT DEFAULT 'quickbooks',
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_costs_contract ON job_costs (contract_id);


-- TABLE 8: audit_log
-- Every agent action. Complete audit trail for DCAA review.
CREATE TABLE IF NOT EXISTS audit_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent                 TEXT NOT NULL,
  action                TEXT NOT NULL,
  details               JSONB DEFAULT '{}',
  outcome               TEXT,
  approver              TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_agent      ON audit_log (agent);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log (created_at DESC);


-- TABLE 9: co_contacts
-- Contracting Officer contact database. RECON builds this.
CREATE TABLE IF NOT EXISTS co_contacts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  title                 TEXT,
  agency                TEXT,
  sub_office            TEXT,
  email                 TEXT,
  phone                 TEXT,
  opportunities_linked  INTEGER DEFAULT 0,
  last_interaction      DATE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- PART 2: EXTENDED TABLES (16 tables — money, compliance, intel)
-- ============================================================


-- EXTENDED TABLE 1: prompt_payment_claims
-- Late government payments + interest under FAR 52.232-25
CREATE TABLE IF NOT EXISTS prompt_payment_claims (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           TEXT NOT NULL,
  invoice_number        TEXT NOT NULL,
  invoice_date          DATE NOT NULL,
  invoice_amount        DECIMAL(12,2) DEFAULT 0,
  payment_due           DATE NOT NULL,
  payment_received      DATE,
  days_late             INTEGER,  -- Updated by EXEC agent when payment is recorded
  treasury_rate         DECIMAL(5,4),
  interest_owed         DECIMAL(10,2),
  claim_status          TEXT DEFAULT 'pending',
  claim_letter_url      TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 2: retainage_tracker
-- Holds-back monitoring and release request automation
CREATE TABLE IF NOT EXISTS retainage_tracker (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           TEXT NOT NULL,
  total_contract_value  DECIMAL(12,2),
  retainage_rate        DECIMAL(4,2) DEFAULT 0.10,
  retainage_held        DECIMAL(12,2) DEFAULT 0,
  release_requested     BOOLEAN DEFAULT false,
  release_request_date  DATE,
  release_received      BOOLEAN DEFAULT false,
  followup_count        INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 3: sub_payments
-- Enforces 7-day sub payment rule (FAR 52.232-27)
CREATE TABLE IF NOT EXISTS sub_payments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id                 TEXT NOT NULL,
  sub_name                    TEXT NOT NULL,
  sub_invoice_amount          DECIMAL(10,2),
  govt_payment_received_date  DATE,
  sub_payment_due             DATE,
  sub_payment_sent_date       DATE,
  days_to_pay                 INTEGER,
  compliant                   BOOLEAN,  -- Updated by EXEC agent when payment is recorded
  created_at                  TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 4: debrief_tracker
-- Automates post-loss debrief requests within 3-day FAR 15.506 window
CREATE TABLE IF NOT EXISTS debrief_tracker (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id                      TEXT NOT NULL,
  solicitation_id             TEXT NOT NULL,
  agency                      TEXT,
  loss_date                   DATE,
  debrief_requested           BOOLEAN DEFAULT false,
  debrief_request_deadline    DATE,
  debrief_date                DATE,
  feedback_summary            TEXT,
  lessons                     JSONB DEFAULT '[]',
  applied_to_future           BOOLEAN DEFAULT false,
  created_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debrief_deadline ON debrief_tracker (debrief_request_deadline);


-- EXTENDED TABLE 5: compliance_matrices
-- Maps every RFP requirement to proposal section
CREATE TABLE IF NOT EXISTS compliance_matrices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id                TEXT NOT NULL,
  solicitation_id       TEXT NOT NULL,
  requirements          JSONB DEFAULT '[]',
  compliance_pct        DECIMAL(5,2) DEFAULT 0,
  generated_at          TIMESTAMPTZ DEFAULT now(),
  last_updated          TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 6: capability_statements
-- Agency-tailored capability statement PDFs
CREATE TABLE IF NOT EXISTS capability_statements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_agency         TEXT,
  target_naics          TEXT,
  version               INTEGER DEFAULT 1,
  content               JSONB,
  pdf_url               TEXT,
  generated_at          TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 7: certified_payroll
-- WH-347 Davis-Bacon certified payroll records
CREATE TABLE IF NOT EXISTS certified_payroll (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           TEXT NOT NULL,
  week_ending           DATE NOT NULL,
  workers               JSONB DEFAULT '[]',
  wage_determination_id TEXT,
  total_hours           DECIMAL(8,2),
  total_gross_pay       DECIMAL(10,2),
  form_url              TEXT,
  submitted             BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_contract_week
  ON certified_payroll (contract_id, week_ending);


-- EXTENDED TABLE 8: sub_plans
-- Small business subcontracting plans for contracts over $750K
CREATE TABLE IF NOT EXISTS sub_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           TEXT NOT NULL,
  contract_value        DECIMAL(12,2),
  sb_goal_pct           DECIMAL(5,2),
  hubzone_goal_pct      DECIMAL(5,2),
  eight_a_goal_pct      DECIMAL(5,2),
  wosb_goal_pct         DECIMAL(5,2),
  sdvosb_goal_pct       DECIMAL(5,2),
  plan_doc_url          TEXT,
  compliant             BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 9: cpars_ratings
-- CPARS performance evaluations — 14-day response window
CREATE TABLE IF NOT EXISTS cpars_ratings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           TEXT NOT NULL,
  evaluation_date       DATE,
  overall_rating        TEXT,
  quality_rating        TEXT,
  schedule_rating       TEXT,
  cost_rating           TEXT,
  response_deadline     DATE,
  response_submitted    BOOLEAN DEFAULT false,
  response_doc_url      TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 10: contract_modifications
-- Tracks every mod — flags scope changes needing REA
CREATE TABLE IF NOT EXISTS contract_modifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           TEXT NOT NULL,
  mod_number            TEXT NOT NULL,
  mod_type              TEXT,
  description           TEXT,
  value_change          DECIMAL(12,2) DEFAULT 0,
  new_total_value       DECIMAL(12,2),
  new_end_date          DATE,
  rea_required          BOOLEAN DEFAULT false,
  detected_date         DATE DEFAULT CURRENT_DATE,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 11: sam_health_checks
-- Monthly SAM.gov registration validation
CREATE TABLE IF NOT EXISTS sam_health_checks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_date            DATE DEFAULT CURRENT_DATE,
  registration_status   TEXT,
  expiration_date       DATE,
  days_to_expiry        INTEGER,
  naics_match           BOOLEAN,
  address_current       BOOLEAN,
  issues                JSONB DEFAULT '[]',
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 12: distributor_prices
-- Supplier quotes — auto-flags stale prices older than 14 days
CREATE TABLE IF NOT EXISTS distributor_prices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_name      TEXT NOT NULL,
  product_category      TEXT,
  unit_price            DECIMAL(10,2),
  quote_date            DATE NOT NULL,
  quote_expiry          DATE,
  is_stale              BOOLEAN GENERATED ALWAYS AS (false) STORED,  -- Placeholder; see stale_prices view below
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 13: gao_protests
-- GAO bid protest docket monitoring
CREATE TABLE IF NOT EXISTS gao_protests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gao_case_number       TEXT,
  solicitation_id       TEXT,
  protester             TEXT,
  awardee               TEXT,
  agency                TEXT,
  filed_date            DATE,
  outcome               TEXT,
  impacts_walker        BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 14: osdbu_events
-- Agency matchmaking events — great for CO relationship building
CREATE TABLE IF NOT EXISTS osdbu_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency                TEXT NOT NULL,
  event_name            TEXT NOT NULL,
  event_date            DATE,
  event_type            TEXT,
  registration_url      TEXT,
  registered            BOOLEAN DEFAULT false,
  attended              BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 15: bid_bonds
-- Bid bond requirement detection and surety timeline management
CREATE TABLE IF NOT EXISTS bid_bonds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id                TEXT NOT NULL,
  solicitation_id       TEXT UNIQUE,
  bond_amount           DECIMAL(12,2),
  bond_pct              DECIMAL(5,2) DEFAULT 20.0,
  surety_agent          TEXT,
  request_sent          BOOLEAN DEFAULT false,
  bond_received         BOOLEAN DEFAULT false,
  bid_deadline          DATE,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- EXTENDED TABLE 16: prime_help
-- Searchable Help/FAQ knowledge base — all agents update this
CREATE TABLE IF NOT EXISTS prime_help (
  id                    TEXT PRIMARY KEY,
  term                  TEXT NOT NULL,
  category              TEXT NOT NULL,
  explanation           TEXT NOT NULL,
  reading_level         INTEGER DEFAULT 7,
  agent                 TEXT,
  related_terms         TEXT[] DEFAULT '{}',
  last_updated          TIMESTAMPTZ DEFAULT now(),
  auto_generated        BOOLEAN DEFAULT true,
  search_vector         TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', term || ' ' || category || ' ' || explanation)
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_help_search   ON prime_help USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_help_category ON prime_help (category);


-- ============================================================
-- VIEWS: Computed columns that need live date comparisons
-- (PostgreSQL generated columns can't use CURRENT_DATE)
-- ============================================================

-- stale_prices: replaces the is_stale generated column
-- VAULT and BID ENGINE query this view instead of the table directly
CREATE OR REPLACE VIEW stale_prices AS
SELECT *,
  (quote_date < CURRENT_DATE - INTERVAL '14 days') AS is_stale_now
FROM distributor_prices;

-- late_invoices: shows all unpaid invoices past their due date
CREATE OR REPLACE VIEW late_invoices AS
SELECT *,
  (CURRENT_DATE - payment_due) AS days_late_now
FROM prompt_payment_claims
WHERE payment_received IS NULL
  AND payment_due < CURRENT_DATE;

-- noncompliant_sub_payments: subs paid more than 7 days after gov payment
CREATE OR REPLACE VIEW noncompliant_sub_payments AS
SELECT *,
  (days_to_pay > 7) AS is_noncompliant
FROM sub_payments
WHERE days_to_pay IS NOT NULL;


-- ============================================================
-- PART 3: SYSTEM TABLES (4 tables — runtime infrastructure)
-- These support agent coordination, config, cost tracking, and intel
-- ============================================================


-- SYSTEM TABLE 1: agent_logs
-- Complete audit trail of every action every agent takes
-- Used by logAction() in lib/supabase.js
CREATE TABLE IF NOT EXISTS agent_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent       TEXT NOT NULL,
  action      TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_agent      ON agent_logs (agent);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs (created_at DESC);


-- SYSTEM TABLE 2: system_config
-- Key-value store for runtime settings, kill switch, and agent state
-- Used by getConfig()/setConfig() and SYSTEM_HALT kill switch
CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Seed the kill switch (OFF by default)
INSERT INTO system_config (key, value) VALUES ('SYSTEM_HALT', 'false')
  ON CONFLICT (key) DO NOTHING;

-- Seed daily SAM.gov call counter
INSERT INTO system_config (key, value) VALUES ('SAM_CALLS_TODAY', '0')
  ON CONFLICT (key) DO NOTHING;


-- SYSTEM TABLE 3: agent_cost_log
-- Tracks Claude AI spend per agent per day — enforces $2/day per-agent cap
-- Used by checkCostCap() and recordCost() in lib/cost-guard.js
CREATE TABLE IF NOT EXISTS agent_cost_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent       TEXT NOT NULL,
  date        DATE NOT NULL,
  cost_usd    DECIMAL(10,6) DEFAULT 0,
  model       TEXT,
  details     JSONB DEFAULT '{}',
  logged_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_log_agent_date ON agent_cost_log (agent, date);
CREATE INDEX IF NOT EXISTS idx_cost_log_date       ON agent_cost_log (date DESC);


-- SYSTEM TABLE 4: competitor_intel
-- Competitor award data from FPDS — who won similar contracts
-- Populated by RECON agent's FPDS scan
CREATE TABLE IF NOT EXISTS competitor_intel (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name  TEXT NOT NULL,
  naics         TEXT,
  award_value   DECIMAL(12,2),
  award_date    DATE,
  agency        TEXT,
  state         TEXT,
  source        TEXT DEFAULT 'FPDS',
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_unique
  ON competitor_intel (company_name, naics, award_date);
CREATE INDEX IF NOT EXISTS idx_competitor_naics ON competitor_intel (naics);


-- ============================================================
-- COLUMN ADDITIONS: Extend existing tables with new fields
-- Safe to re-run (IF NOT EXISTS equivalent via DO blocks)
-- ============================================================

DO $$
BEGIN
  -- opportunities: add type, place_of_performance, scoring, alert fields
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS type               TEXT DEFAULT 'construction';
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS place_of_performance TEXT;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS description        TEXT;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS raw_data           JSONB DEFAULT '{}';
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS needs_scoring      BOOLEAN DEFAULT false;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS alert_level        TEXT;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS alert_sent         BOOLEAN DEFAULT false;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS alert_sent_at      TIMESTAMPTZ;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS score_factors      JSONB DEFAULT '{}';
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS recommendation     TEXT;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tier               TEXT;
  ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS reasoning          TEXT;

  -- bids: add prime_score, compliance tracking, opportunity FK name
  ALTER TABLE bids ADD COLUMN IF NOT EXISTS prime_score        INTEGER;
  ALTER TABLE bids ADD COLUMN IF NOT EXISTS compliance_checks  JSONB DEFAULT '[]';
  ALTER TABLE bids ADD COLUMN IF NOT EXISTS compliance_status  TEXT;
  ALTER TABLE bids ADD COLUMN IF NOT EXISTS compliance_date    TIMESTAMPTZ;
  ALTER TABLE bids ADD COLUMN IF NOT EXISTS status             TEXT DEFAULT 'pending_pricing';

EXCEPTION WHEN OTHERS THEN
  -- If there are any conflicts, log and continue
  RAISE NOTICE 'Column addition note: %', SQLERRM;
END $$;


-- ============================================================
-- VERIFICATION: Count all 29 tables (25 original + 4 system)
-- Run this after the above to confirm everything created
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
