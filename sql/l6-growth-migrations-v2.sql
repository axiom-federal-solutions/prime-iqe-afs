-- ============================================================
-- PRIME IQE — Level 6 Growth Features Migration v2
-- Run in Supabase SQL Editor for project czoyvxyfewqaoewzxlin
-- Features: L6-02 Proposal Scoring, L6-03 Teaming Agreements,
--           L6-05 Past Performance, SAM Registration Alert,
--           Subcontractor Payment Compliance Log
-- ============================================================

-- ─── 1. PROPOSAL_SCORES — Post-award proposal quality rubric ──────────────
-- L6-02: LEDGER scores proposals after each win/loss outcome.
-- After 20 scored proposals, LEDGER trains a second ML model on proposal
-- quality (not just opportunity fit) to improve future proposal writing.
CREATE TABLE IF NOT EXISTS proposal_scores (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  bid_id              uuid        REFERENCES bids(id) ON DELETE CASCADE,
  solicitation_number text,
  result              text        CHECK (result IN ('won','lost')),

  -- Scoring rubric — 5 criteria, each 0-20 points = 100 total
  score_technical     integer     DEFAULT 0 CHECK (score_technical     BETWEEN 0 AND 20),
  score_price         integer     DEFAULT 0 CHECK (score_price         BETWEEN 0 AND 20),
  score_past_perf     integer     DEFAULT 0 CHECK (score_past_perf     BETWEEN 0 AND 20),
  score_management    integer     DEFAULT 0 CHECK (score_management    BETWEEN 0 AND 20),
  score_compliance    integer     DEFAULT 0 CHECK (score_compliance    BETWEEN 0 AND 20),

  total_score         integer     GENERATED ALWAYS AS
    (score_technical + score_price + score_past_perf + score_management + score_compliance)
    STORED,

  -- Gap analysis — what the evaluator likely cared about
  strengths           text,         -- What we did well (AI-generated)
  weaknesses          text,         -- Where we lost points (AI-generated)
  improvement_notes   text,         -- Action items for next proposal

  -- Context
  agency              text,
  naics               text,
  contract_value      numeric,
  scored_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_scores_bid_id ON proposal_scores (bid_id);
CREATE INDEX IF NOT EXISTS idx_proposal_scores_result  ON proposal_scores (result);
CREATE INDEX IF NOT EXISTS idx_proposal_scores_scored  ON proposal_scores (scored_at DESC);

-- ─── 2. TEAMING_AGREEMENTS — Partner and sub-contractor registry ──────────
-- L6-03: SCOUT checks this table when scoring opportunities.
-- If our NAICS codes don't cover a requirement, SCOUT surfaces a matching
-- teaming partner instead of marking the opportunity as ineligible.
CREATE TABLE IF NOT EXISTS teaming_agreements (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_name        text        NOT NULL,
  role                text        NOT NULL CHECK (role IN ('prime','sub','mentor_protege','jv')),

  -- What work they can perform
  naics_codes         text[]      NOT NULL DEFAULT '{}',
  capabilities        text,         -- Free-text description of services

  -- Compliance and capacity
  set_aside_certs     text[]      DEFAULT '{}',  -- e.g. ['SDB','SDVOSB','8a']
  bonding_capacity    numeric,      -- Max single project bond amount
  bonding_limit       numeric,      -- Aggregate bond limit

  -- Agreement details
  agreement_type      text        DEFAULT 'MOU',  -- MOU, NDA, JV_AGREEMENT, SUBCONTRACT
  expiration_date     date,
  active              boolean     DEFAULT true,

  -- Contact
  contact_name        text,
  contact_email       text,
  contact_phone       text,

  -- Metadata
  past_projects       integer     DEFAULT 0,  -- Number of contracts worked together
  notes               text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- GIN index so SCOUT can quickly check if any partner covers a NAICS code
CREATE INDEX IF NOT EXISTS idx_teaming_naics_gin ON teaming_agreements USING GIN (naics_codes);
CREATE INDEX IF NOT EXISTS idx_teaming_active     ON teaming_agreements (active);

-- ─── 3. PAST_PERFORMANCE — Federal contract history repository ────────────
-- L6-05: Used by BRANDI to auto-draft past performance narratives.
-- Evaluators weight this heavily — a structured repository beats ad-hoc entries.
CREATE TABLE IF NOT EXISTS past_performance (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- SAM.gov / contract identifiers
  contract_number     text        NOT NULL UNIQUE,
  task_order_number   text,         -- If this was a task order off a base contract
  solicitation_number text,

  -- Contract details
  agency              text        NOT NULL,
  program_office      text,
  description         text        NOT NULL,   -- Short scope of work
  naics               text,
  contract_type       text        DEFAULT 'FFP',  -- FFP, CPFF, T&M, IDIQ, etc.
  set_aside           text,
  prime_or_sub        text        NOT NULL CHECK (prime_or_sub IN ('prime','sub')),

  -- Financials
  award_value         numeric,
  final_value         numeric,      -- What it actually cost (may differ from award)

  -- Performance period
  performance_start   date,
  performance_end     date,
  option_years        integer       DEFAULT 0,

  -- Evaluation results
  cpars_rating        text        CHECK (cpars_rating IN ('exceptional','very_good','satisfactory','marginal','unsatisfactory')),
  cpars_url           text,
  ppirs_rating        text,

  -- Government POC — needed for references during proposal evaluation
  poc_name            text,
  poc_title           text,
  poc_email           text,
  poc_phone           text,

  -- Narrative — BRANDI generates this from the other fields
  narrative           text,        -- Full past performance write-up for proposals
  narrative_generated_at timestamptz,

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_past_perf_agency ON past_performance (agency);
CREATE INDEX IF NOT EXISTS idx_past_perf_naics  ON past_performance (naics);
CREATE INDEX IF NOT EXISTS idx_past_perf_end    ON past_performance (performance_end DESC);

-- ─── 4. SUB_PAYMENT_LOG — Federal prompt payment compliance tracker ────────
-- Federal law requires prime contractors to pay subs within 14 days of
-- receiving payment from the government (Prompt Payment Act, FAR 52.232-27).
-- BRANDI flags overdue payments in the daily brief and escalates at 7 days late.
CREATE TABLE IF NOT EXISTS sub_payment_log (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id         uuid        REFERENCES active_contracts(id) ON DELETE SET NULL,
  contract_number     text,

  -- Subcontractor details
  subcontractor_name  text        NOT NULL,
  subcontractor_ein   text,         -- Stored encrypted — never log plain

  -- Payment details
  invoice_number      text,
  invoice_date        date        NOT NULL,
  invoice_amount      numeric     NOT NULL,
  description         text,         -- What the invoice covers

  -- Federal prompt payment tracking
  -- Prime receives payment → must pay sub within 14 days
  prime_received_date date,         -- When prime got paid by government
  required_pay_date   date          GENERATED ALWAYS AS
    (prime_received_date + INTERVAL '14 days') STORED,
  actual_pay_date     date,

  -- Status tracking
  status              text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','overdue','disputed','waived')),
  days_late           integer,      -- Updated by BRANDI on each check
  alert_sent          boolean     DEFAULT false,
  escalation_sent     boolean     DEFAULT false,  -- 7-day late escalation

  notes               text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subpay_status        ON sub_payment_log (status);
CREATE INDEX IF NOT EXISTS idx_subpay_required_date ON sub_payment_log (required_pay_date);
CREATE INDEX IF NOT EXISTS idx_subpay_contract      ON sub_payment_log (contract_id);

-- ─── 5. SYSTEM_CONFIG SEEDS — Feature flags and SAM registration ──────────

-- L6-02: Proposal scoring feature flag
INSERT INTO system_config (key, value, description) VALUES
  ('L6_02_PROPOSAL_SCORING_ACTIVE', 'false', 'Auto-activates after 20 bid outcomes')
ON CONFLICT (key) DO NOTHING;

-- L6-03: Teaming intelligence flag
INSERT INTO system_config (key, value, description) VALUES
  ('L6_03_TEAMING_ACTIVE', 'false', 'Activates when teaming_agreements table has >= 1 active partner')
ON CONFLICT (key) DO NOTHING;

-- L6-05: Past performance flag
INSERT INTO system_config (key, value, description) VALUES
  ('L6_05_PAST_PERF_ACTIVE', 'false', 'Activates when past_performance has >= 1 record')
ON CONFLICT (key) DO NOTHING;

-- SAM.gov entity registration expiration date
-- UPDATE THIS after checking SAM.gov: https://sam.gov/entity/USMQMFAGL9M4
INSERT INTO system_config (key, value, description) VALUES
  ('SAM_REGISTRATION_EXPIRY', '2025-10-01', 'SAM.gov entity registration expiry — check sam.gov annually')
ON CONFLICT (key) DO NOTHING;

-- Sub payment alert threshold (days before required date to start warning)
INSERT INTO system_config (key, value, description) VALUES
  ('SUB_PAYMENT_WARN_DAYS', '3', 'Warn BRANDI this many days before prompt payment deadline')
ON CONFLICT (key) DO NOTHING;

-- ─── 6. VERIFY ────────────────────────────────────────────────────────────
SELECT 'proposal_scores'     AS tbl, count(*) FROM proposal_scores
UNION ALL
SELECT 'teaming_agreements',          count(*) FROM teaming_agreements
UNION ALL
SELECT 'past_performance',            count(*) FROM past_performance
UNION ALL
SELECT 'sub_payment_log',             count(*) FROM sub_payment_log
UNION ALL
SELECT 'system_config_l6_keys',       count(*) FROM system_config
  WHERE key IN ('L6_02_PROPOSAL_SCORING_ACTIVE','L6_03_TEAMING_ACTIVE',
                'L6_05_PAST_PERF_ACTIVE','SAM_REGISTRATION_EXPIRY','SUB_PAYMENT_WARN_DAYS');
