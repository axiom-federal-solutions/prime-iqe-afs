-- ============================================================
-- ADD PSC COLUMN — Product Service Code on opportunities
-- 2026-05-02: required by the unified dashboard filter system.
-- The mapping engine (dashboard/filter-system.js) prefers PSC over
-- NAICS when classifying an opp into Domain → Category → Sub-category.
-- PSC is more specific than NAICS for federal contracts and yields
-- fewer false positives.
--
-- WHEN TO RUN: Once, in Supabase SQL Editor for project czoyvxyfewqaoewzxlin.
-- SAFE TO RE-RUN: Yes — IF NOT EXISTS guards prevent duplicates.
-- ============================================================

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS psc TEXT;

-- Index for filter queries — PSC prefix matching is the primary use case
CREATE INDEX IF NOT EXISTS idx_opportunities_psc
  ON opportunities (psc);

-- Comment so future-you knows where this column came from
COMMENT ON COLUMN opportunities.psc IS
  'Product Service Code from SAM.gov (classificationCode field). '
  'Used by dashboard filter-system.js for PSC > NAICS > NLP classification. '
  'Populated by SCOUT after 2026-05-02; nullable for older rows.';

-- ── BACKFILL HINT ─────────────────────────────────────────────
-- Old opportunities (pre-2026-05-02) have psc=NULL. The mapping engine
-- gracefully falls back to NAICS + keyword matching for those, so no
-- backfill is strictly required. If you want to backfill from raw_data
-- BEFORE JUDGE has nulled it out, uncomment and run:
--
-- UPDATE opportunities
--   SET psc = COALESCE(
--     raw_data->>'classificationCode',
--     raw_data->>'productOrServiceCode'
--   )
--   WHERE psc IS NULL
--     AND raw_data IS NOT NULL;
