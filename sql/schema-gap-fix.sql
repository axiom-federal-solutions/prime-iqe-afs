-- ============================================================
-- PRIME IQE — Schema Gap Fix Migration
-- Run in Supabase SQL Editor for project czoyvxyfewqaoewzxlin
-- https://supabase.com → Your Project → SQL Editor → New Query
-- ============================================================

-- ─── 1. ADD VERTICAL COLUMN TO OPPORTUNITIES ──────────────────
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS vertical text DEFAULT 'construction';

-- Backfill vertical from NAICS code
UPDATE opportunities SET vertical = 'supply'
-- 2026-04-30: removed 541511/541512/541519/611430/541611 — IT/SAP/training out of scope
WHERE naics IN ('541330','561110','561210',
                '424410','332999','339999','611420',
                '541618','488490');

UPDATE opportunities SET vertical = 'realestate'
WHERE naics IN ('531110','531120','531210','531311','531312','531390');

-- Everything else stays 'construction' (the default)

-- ─── 2. CREATE suppliers TABLE ────────────────────────────────
-- Used by: recon.js, draft.js, bidengine.js
CREATE TABLE IF NOT EXISTS suppliers (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name                text NOT NULL,
  dba                 text,
  cage_code           text,
  uei                 text UNIQUE,
  certifications      text[],
  naics_codes         text[],
  state               text,
  city                text,
  contact_name        text,
  contact_email       text,
  fed_contract_count  integer DEFAULT 0,
  avg_contract_value  numeric DEFAULT 0,
  last_award_date     date,
  source              text DEFAULT 'SAM',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_naics ON suppliers USING GIN (naics_codes);
CREATE INDEX IF NOT EXISTS idx_suppliers_state ON suppliers (state);
CREATE INDEX IF NOT EXISTS idx_suppliers_cage ON suppliers (cage_code);

-- ─── 3. CREATE supplier_matches TABLE ────────────────────────
-- Used by: brandi.js, draft.js, bidengine.js, recon.js, index.html
CREATE TABLE IF NOT EXISTS supplier_matches (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id      uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  supplier_id         uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_name       text,
  naics               text,
  match_score         integer CHECK (match_score BETWEEN 0 AND 100),
  match_type          text,           -- 'naics_exact', 'naics_prefix', 'state', 'cert'
  certifications      text[],
  state               text,
  fed_contract_count  integer DEFAULT 0,
  avg_contract_value  numeric DEFAULT 0,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_matches_opp ON supplier_matches (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_supplier_matches_score ON supplier_matches (match_score DESC);

-- ─── 4. CREATE test_results TABLE ────────────────────────────
-- Used by: test.js, brandi.js, index.html System tab
CREATE TABLE IF NOT EXISTS test_results (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  test_name     text NOT NULL,
  category      text NOT NULL,   -- DATA_INTEGRITY, SCORE_VALIDATION, FINANCIAL_MATH, etc.
  passed        boolean NOT NULL,
  expected      text,
  actual        text,
  agent_target  text,            -- which agent this test validates
  run_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_results_category ON test_results (category);
CREATE INDEX IF NOT EXISTS idx_test_results_run_at ON test_results (run_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_passed ON test_results (passed);

-- ─── 5. CREATE api_schemas TABLE ─────────────────────────────
-- Used by: test.js API_CONTRACTS category
CREATE TABLE IF NOT EXISTS api_schemas (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  api_name        text NOT NULL UNIQUE,  -- 'SAM.gov', 'Supabase', 'SendGrid', etc.
  endpoint        text,
  last_validated  timestamptz,
  schema_hash     text,
  status          text DEFAULT 'unknown',  -- 'healthy', 'degraded', 'down', 'unknown'
  response_time_ms integer,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

-- Seed with known APIs
INSERT INTO api_schemas (api_name, endpoint, status) VALUES
  ('SAM.gov',   'https://api.sam.gov/opportunities/v2/search', 'unknown'),
  ('Supabase',  'https://czoyvxyfewqaoewzxlin.supabase.co',   'unknown'),
  ('SendGrid',  'https://api.sendgrid.com/v3',                 'unknown'),
  ('Anthropic', 'https://api.anthropic.com/v1',               'unknown'),
  ('USASpending','https://api.usaspending.gov/api/v2',         'unknown')
ON CONFLICT (api_name) DO NOTHING;

-- ─── VERIFICATION ─────────────────────────────────────────────
-- Run this after to confirm everything was created:
SELECT table_name,
  (SELECT COUNT(*) FROM information_schema.columns c
   WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS col_count
FROM information_schema.tables t
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  AND table_name IN ('opportunities','suppliers','supplier_matches','test_results','api_schemas')
ORDER BY table_name;
