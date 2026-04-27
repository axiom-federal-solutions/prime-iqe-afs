-- =====================================================
-- PRIME: Flush Bad IT Consulting Seed Data
-- Run this in Supabase SQL Editor for prime-db
-- This removes the wrong NAICS opportunities seeded
-- before the build doc was uploaded. After running,
-- trigger SCOUT manually to repopulate with real
-- Walker Contractors construction opportunities.
-- =====================================================

-- Step 1: Remove bids linked to bad opportunities
DELETE FROM bids;

-- Step 2: Remove the bad IT consulting opportunities
-- (seeded with NAICS 541511, 541512, 541519, 611430)
DELETE FROM opportunities;

-- Verify the tables are now empty
SELECT
  'opportunities' AS table_name,
  COUNT(*) AS rows_remaining
FROM opportunities
UNION ALL
SELECT
  'bids' AS table_name,
  COUNT(*) AS rows_remaining
FROM bids;

-- =====================================================
-- AFTER RUNNING THIS:
-- 1. Go to GitHub Actions tab in your repo
-- 2. Click "SCOUT - SAM.gov Scan"
-- 3. Click "Run workflow" → "Run workflow"
-- 4. Wait ~3 minutes
-- 5. Check Supabase: opportunities table should now
--    have real federal CONSTRUCTION contracts
--    (NAICS: 236220, 238210, 237990, 236116, 561730)
--    and SUPPLY contracts (424710, 424130, 424490, 424120)
-- =====================================================
