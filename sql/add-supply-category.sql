-- =============================================================
-- MIGRATION: add-supply-category.sql
-- Adds supply_category column to opportunities table
-- This column is stamped by SCOUT and re-confirmed by JUDGE
-- so the dashboard can filter the supply map by category
-- without doing NAICS prefix parsing on the client side.
-- =============================================================

-- Add supply_category to opportunities (safe — skips if column already exists)
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS supply_category VARCHAR(20);

-- Add acq_score to opportunities (separate from prime_score — supply-only field)
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS acq_score NUMERIC(5,2);

-- Index for fast category filtering on the supply tab
CREATE INDEX IF NOT EXISTS idx_opportunities_supply_category
  ON opportunities (supply_category)
  WHERE supply_category IS NOT NULL;

-- Ensure incumbents table conflict key is correct for our upsert pattern
-- (company_name + naics + period_start must be unique)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'incumbents_company_name_naics_period_start_key'
  ) THEN
    ALTER TABLE incumbents
      ADD CONSTRAINT incumbents_company_name_naics_period_start_key
      UNIQUE (company_name, naics, period_start);
  END IF;
END$$;

-- Backfill supply_category for any existing supply opportunities
-- This runs a one-time update using the same NAICS prefix logic as the agents
UPDATE opportunities
SET supply_category = CASE
  WHEN naics LIKE '424710%' OR naics LIKE '424720%' THEN 'fuel'
  WHEN naics LIKE '561720%' OR naics LIKE '424130%' THEN 'jan'
  WHEN naics LIKE '339113%' OR naics LIKE '423440%' THEN 'ppe'
  WHEN naics LIKE '424120%' OR naics LIKE '453210%' THEN 'office'
  WHEN naics LIKE '424490%' OR naics LIKE '311999%' THEN 'food'
  WHEN naics LIKE '424690%'                          THEN 'chem'
  WHEN naics LIKE '423450%'                          THEN 'safety'
  WHEN naics LIKE '424310%' OR naics LIKE '315990%' THEN 'uni'
  ELSE NULL
END
WHERE vertical = 'supply'
  AND supply_category IS NULL;
