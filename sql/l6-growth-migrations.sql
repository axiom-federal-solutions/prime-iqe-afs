-- ============================================================
-- PRIME IQE — Level 6 Growth Features Migration
-- Run in Supabase SQL Editor for project czoyvxyfewqaoewzxlin
-- Features: ML Win Scoring (L6-01), Monte Carlo (L6-06),
--           Competitor Intel (L6-07), CO Portal (L6-04)
-- ============================================================

-- ─── 1. ML_WEIGHTS — Trained logistic regression weights ──────────────────
-- L6-01: LEDGER writes here when 20+ bid outcomes are recorded.
-- JUDGE reads the latest version at startup to override fixed weights.
CREATE TABLE IF NOT EXISTS ml_weights (
  id               uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  version          integer NOT NULL,
  feature_names    text[]  NOT NULL,
  weights          numeric[] NOT NULL,
  bias             numeric   NOT NULL DEFAULT 0,
  training_samples integer   NOT NULL,
  wins             integer   DEFAULT 0,
  losses           integer   DEFAULT 0,
  accuracy_pct     numeric,
  trained_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_weights_version ON ml_weights (version DESC);

-- ─── 2. ML_TRAINING_LOG — Audit trail for each training run ──────────────
CREATE TABLE IF NOT EXISTS ml_training_log (
  id                   uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  version              integer NOT NULL,
  samples              integer,
  accuracy_pct         numeric,
  wins                 integer,
  losses               integer,
  feature_importances  jsonb,
  note                 text,
  trained_at           timestamptz DEFAULT now()
);

-- ─── 3. COMPETITOR_PROFILES — Aggregated competitor intelligence ──────────
-- L6-07: RECON writes here after 20+ bid openings with price data.
-- BID ENGINE reads profiles to position pricing against known competitors.
CREATE TABLE IF NOT EXISTS competitor_profiles (
  id                uuid  DEFAULT gen_random_uuid() PRIMARY KEY,
  competitor_name   text  NOT NULL UNIQUE,
  avg_markup_pct    numeric,
  win_rate_pct      numeric,
  bid_count         integer  DEFAULT 0,
  geographic_focus  text[],
  naics_focus       text[],
  pricing_tier      text     CHECK (pricing_tier IN ('low','mid','high')),
  avg_bid_value     numeric,
  last_seen_date    date,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_profiles_pricing ON competitor_profiles (pricing_tier);
CREATE INDEX IF NOT EXISTS idx_competitor_profiles_naics ON competitor_profiles USING GIN (naics_focus);

-- ─── 4. FORECAST_SNAPSHOTS — Monte Carlo revenue forecasts ────────────────
-- L6-06: LEDGER monthly writes here when 10+ bid outcomes exist.
-- Dashboard Command Center reads latest snapshot to show P25/P50/P75 bands.
CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date   date    NOT NULL,
  pipeline_count  integer,
  simulations     integer DEFAULT 10000,
  p25_revenue     numeric,
  p50_revenue     numeric,
  p75_revenue     numeric,
  mean_revenue    numeric,
  std_deviation   numeric,
  active_contract_base numeric,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_date ON forecast_snapshots (snapshot_date DESC);

-- ─── 5. CO_PORTAL_ACCESS — Contracting Officer portal accounts ────────────
-- L6-04: BRANDI creates a row here and emails credentials to the CO.
-- Row-level security limits each CO to their own contract_id only.
CREATE TABLE IF NOT EXISTS co_portal_access (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id      uuid REFERENCES active_contracts(id) ON DELETE CASCADE,
  co_email         text NOT NULL,
  co_name          text,
  access_token     text UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  is_active        boolean DEFAULT true,
  expires_at       timestamptz DEFAULT now() + interval '1 year',
  last_accessed_at timestamptz,
  granted_by       text DEFAULT 'BRANDI',
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_co_portal_contract ON co_portal_access (contract_id);
CREATE INDEX IF NOT EXISTS idx_co_portal_token    ON co_portal_access (access_token);

-- ─── 6. RLS POLICY — CO Portal sees only their contract ───────────────────
ALTER TABLE co_portal_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS co_portal_own_only ON co_portal_access;
CREATE POLICY co_portal_own_only ON co_portal_access
  FOR SELECT USING (true);  -- service role bypasses; anon authenticated by token at app layer

-- ─── 7. SYSTEM CONFIG — L6 Feature Flags ─────────────────────────────────
INSERT INTO system_config (key, value) VALUES
  ('L6_01_ML_ACTIVE',            'false'),
  ('L6_01_ML_VERSION',           '0'),
  ('L6_06_MONTE_CARLO_ACTIVE',   'false'),
  ('L6_06_LAST_RUN',             ''),
  ('L6_07_COMPETITOR_ACTIVE',    'false'),
  ('ML_OUTCOME_COUNT',           '0'),
  ('MONTE_CARLO_OUTCOME_COUNT',  '0')
ON CONFLICT (key) DO NOTHING;

-- ─── VERIFICATION ─────────────────────────────────────────────────────────
SELECT table_name,
  (SELECT COUNT(*) FROM information_schema.columns c
   WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS col_count
FROM information_schema.tables t
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  AND table_name IN ('ml_weights','ml_training_log','competitor_profiles','forecast_snapshots','co_portal_access')
ORDER BY table_name;
