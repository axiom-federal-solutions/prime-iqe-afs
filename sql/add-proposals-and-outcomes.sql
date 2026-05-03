-- ============================================================
-- ADD PROPOSALS + BID_OUTCOMES TABLES
-- 2026-05-03: Track bid drafts (Google Drive URLs) and win/loss/debrief data.
--
-- Pipeline:
--   1. JUDGE scores opp → bid created with status='pending_pricing'
--   2. BID ENGINE prices → status='priced'
--   3. Mr. Kemp approves → status='approved'
--   4. draft-bid agent creates Google Sheet → row in `proposals` w/ drive_file_id
--      → bid status='drafted'
--   5. Mr. Kemp submits → bid status='submitted'
--   6. Award decision → bid.result='won' or 'lost' → row in `bid_outcomes`
--      → if lost, ledger.js auto-stages debrief request (FAR 15.506)
--
-- WHEN TO RUN: Once, in Supabase SQL Editor for project czoyvxyfewqaoewzxlin.
-- SAFE TO RE-RUN: Yes — IF NOT EXISTS guards everywhere.
-- ============================================================

-- ── PROPOSALS — one row per draft ───────────────────────────────────
CREATE TABLE IF NOT EXISTS proposals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id              UUID REFERENCES bids(id) ON DELETE CASCADE,
  opportunity_id      UUID REFERENCES opportunities(id) ON DELETE SET NULL,

  -- Google Drive metadata
  drive_file_id       TEXT,            -- Google Drive file ID
  drive_folder_id     TEXT,            -- folder the file lives in
  sheet_url           TEXT,            -- shareable webViewLink for opening in browser
  sheet_title         TEXT,

  -- Lifecycle
  status              TEXT DEFAULT 'draft',
                          -- 'draft'        — generated, awaiting Mr. Kemp review
                          -- 'reviewed'     — Mr. Kemp opened, may have edited
                          -- 'submitted'    — sent to gov via SAM.gov
                          -- 'awarded'      — we won
                          -- 'lost'         — we lost
                          -- 'withdrawn'    — pulled before submission
  generated_at        TIMESTAMPTZ DEFAULT now(),
  reviewed_at         TIMESTAMPTZ,
  submitted_at        TIMESTAMPTZ,
  decision_at         TIMESTAMPTZ,

  -- Audit
  generated_by_agent  TEXT DEFAULT 'DRAFT-BID',
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_bid_id     ON proposals(bid_id);
CREATE INDEX IF NOT EXISTS idx_proposals_opp_id     ON proposals(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status     ON proposals(status);

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON proposals;
CREATE POLICY "anon_read" ON proposals FOR SELECT TO anon USING (true);


-- ── BID_OUTCOMES — one row per closed bid (won OR lost) ─────────────
-- Captures the WHY of every win and loss so the system learns over time.
-- Critical for the lost-bid debrief workflow (FAR 15.506).
CREATE TABLE IF NOT EXISTS bid_outcomes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id              UUID REFERENCES bids(id) ON DELETE CASCADE,
  opportunity_id      UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  proposal_id         UUID REFERENCES proposals(id) ON DELETE SET NULL,

  -- The decision
  result              TEXT NOT NULL,                  -- 'won' | 'lost' | 'no_award'
  decision_date       DATE NOT NULL,
  award_amount        DECIMAL(12,2),                  -- our final bid amount
  winning_bid_amount  DECIMAL(12,2),                  -- if known (FOIA/debrief)
  winner_name         TEXT,                           -- who won (if lost)

  -- FAR 15.506 — debrief request (lost bids only)
  debrief_requested        BOOLEAN DEFAULT false,
  debrief_request_date     DATE,
  debrief_request_deadline DATE,                      -- 3 days from notification
  debrief_received         BOOLEAN DEFAULT false,
  debrief_received_date    DATE,
  debrief_method           TEXT,                      -- 'written' | 'oral' | 'declined'
  debrief_notes            TEXT,                      -- transcript / summary

  -- Lessons learned — populated from debrief
  loss_category       TEXT,
                          -- 'price'                — beat on price
                          -- 'past_performance'     — competitor had better PP
                          -- 'technical'            — proposal scored lower technically
                          -- 'set_aside_mismatch'   — didn't qualify
                          -- 'compliance'           — failed a clause
                          -- 'unknown'              — debrief declined or unhelpful
                          -- 'multiple'             — combination of factors
  primary_factor      TEXT,
  secondary_factors   TEXT[] DEFAULT '{}',
  lessons_learned     TEXT,

  -- Performance impact
  reusable_content    TEXT,                           -- e.g. "PP narrative reusable for Tinker projects"
  scoring_factor_adj  JSONB DEFAULT '{}'::jsonb,      -- LEDGER feeds these back to JUDGE weights

  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bid_outcomes_result          ON bid_outcomes(result);
CREATE INDEX IF NOT EXISTS idx_bid_outcomes_decision_date   ON bid_outcomes(decision_date);
CREATE INDEX IF NOT EXISTS idx_bid_outcomes_loss_category   ON bid_outcomes(loss_category);
CREATE INDEX IF NOT EXISTS idx_bid_outcomes_debrief_request ON bid_outcomes(debrief_requested);

ALTER TABLE bid_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON bid_outcomes;
CREATE POLICY "anon_read" ON bid_outcomes FOR SELECT TO anon USING (true);


-- ── Verify ──────────────────────────────────────────────────────────
-- After running:
-- SELECT 'proposals' AS t, COUNT(*) FROM proposals
-- UNION ALL
-- SELECT 'bid_outcomes', COUNT(*) FROM bid_outcomes;
-- Both should return 0 rows (empty tables, ready for inserts).
