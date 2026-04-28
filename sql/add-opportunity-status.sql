-- ============================================================
-- PRIME IQE — Opportunity Status Column
-- Run in: Supabase → SQL Editor → New Query → Paste → Run
-- Project: lsgaifejjoxqudjhkeev (prime-db)
-- ============================================================

-- Step 1: Add the status column
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new'
  CHECK (status IN ('new','reviewing','pursuing','passed','expired'));

-- Step 2: Backfill existing rows
--   If a bid exists → pursuing
--   If deadline has passed → expired
--   Otherwise → new
UPDATE opportunities o
SET status = CASE
  WHEN EXISTS (SELECT 1 FROM bids b WHERE b.opportunity_id = o.id) THEN 'pursuing'
  WHEN o.response_deadline IS NOT NULL AND o.response_deadline < NOW() THEN 'expired'
  ELSE 'new'
END;

-- Step 3: Add index for fast dashboard filtering
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities (status);
CREATE INDEX IF NOT EXISTS idx_opportunities_status_score
  ON opportunities (status, prime_score DESC NULLS LAST);

-- Step 4: Add passed_at timestamp for the archive
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS passed_at timestamptz,
  ADD COLUMN IF NOT EXISTS passed_reason text;

-- Step 5: Verify
SELECT
  status,
  COUNT(*) AS count
FROM opportunities
GROUP BY status
ORDER BY count DESC;
