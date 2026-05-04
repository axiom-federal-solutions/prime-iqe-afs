-- ================================================================
-- Migration 004: Add vault_pending + compliance_hold bid statuses
-- Run in: Supabase Dashboard → SQL Editor → Run
-- ================================================================

-- Drop any existing CHECK constraint on bids.status
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.bids'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE 'ALTER TABLE public.bids DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- Add updated CHECK with all valid status values (including new ones)
ALTER TABLE public.bids
  ADD CONSTRAINT bids_status_check CHECK (
    status IN (
      'vault_pending',      -- JUDGE created, awaiting VAULT compliance gate
      'pending_pricing',    -- VAULT cleared, awaiting BID ENGINE pricing
      'compliance_hold',    -- VAULT flagged ineligible (expired certs, set-aside mismatch, etc.)
      'priced',             -- BID ENGINE priced, awaiting Mr. Kemp approval
      'approved',           -- Mr. Kemp approved — DRAFT will generate proposal
      'rejected',           -- Mr. Kemp rejected — no further action
      'draft_ready',        -- DRAFT generated proposal .docx
      'submitted',          -- Proposal submitted to agency
      'pending_review',     -- Under agency review
      'won',                -- Contract awarded
      'lost',               -- Award went to competitor
      'withdrawn'           -- Bid withdrawn before submission
    )
  );

-- Add compliance columns if not present
ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS compliance_checks  JSONB,
  ADD COLUMN IF NOT EXISTS compliance_status  TEXT,
  ADD COLUMN IF NOT EXISTS compliance_date    TIMESTAMPTZ;
