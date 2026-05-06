-- ============================================================
-- BACKFILL CONDITIONAL BIDS
-- 2026-05-04: JUDGE was previously only creating bid records for tier=BID
-- or tier=STRONG_BID (score ≥70). CONDITIONAL tier (55-69) was excluded,
-- so most opportunities never got priced and the dashboard's BID PRICING
-- panel showed "Run BID ENGINE" forever.
--
-- After the round-14 fix, JUDGE creates bids for any tier !== 'NO_BID'.
-- But the FIX only kicks in for opportunities scored AFTER the deploy.
-- This backfill script creates bid rows for already-scored CONDITIONAL
-- opps so BIDENGINE batch mode picks them up on the next 30-min run.
--
-- WHEN TO RUN: Once, after deploying the round-14 fixes.
-- SAFE TO RE-RUN: Yes — only inserts where no bid row exists yet.
-- ============================================================

-- Insert pending_pricing bids for every scored opp (tier != NO_BID) that
-- doesn't already have a bid row. CONDITIONAL is the main fill, but this
-- also catches any BID/STRONG_BID that JUDGE missed for whatever reason.
INSERT INTO bids (opportunity_id, status, prime_score)
SELECT o.id, 'pending_pricing',
       COALESCE(o.prime_score, o.acq_score, o.lease_score, 50)
FROM opportunities o
LEFT JOIN bids b ON b.opportunity_id = o.id
WHERE COALESCE(o.prime_score, o.acq_score, o.lease_score, 0) >= 55  -- CONDITIONAL+
  AND COALESCE(o.tier, '') != 'NO_BID'
  AND b.id IS NULL                                                    -- no existing bid
  AND (o.status IS NULL OR o.status IN ('new','scored','reviewing','pursuing'))
RETURNING id, opportunity_id, prime_score, status;

-- ── Verify ──────────────────────────────────────────────────────────
-- After running, check the queue:
--   SELECT status, COUNT(*) FROM bids GROUP BY status;
--
-- Expected: a chunk of new rows in 'pending_pricing'. They'll get drained
-- by BIDENGINE on the next 30-min cron tick. After ~10 hours of cron runs,
-- everything should transition to 'priced'.
--
-- To force immediate processing:
--   GitHub Actions → "BID ENGINE - Price Calculator" → Run workflow
--   (leave opportunity_id blank — batch mode picks up the queue)
