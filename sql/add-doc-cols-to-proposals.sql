-- ============================================================
-- ADD DOC COLUMNS TO PROPOSALS
-- 2026-05-03: Round 11 added proposals tracking the Sheet URL.
-- This round adds the matching Doc URL columns so a proposal row
-- carries BOTH the Google Sheet (data) and the Google Doc (narrative
-- bid template populated from Mr. Kemp's WalkerContractors_BidTemplate.docx).
--
-- WHEN TO RUN: Once, in Supabase SQL Editor.
-- SAFE TO RE-RUN: Yes — IF NOT EXISTS guards.
-- ============================================================

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS doc_file_id TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS doc_url     TEXT;

COMMENT ON COLUMN proposals.doc_file_id IS
  'Google Doc file ID — populated when GOOGLE_TEMPLATE_DOC_ID env var is configured.';
COMMENT ON COLUMN proposals.doc_url IS
  'webViewLink for the populated Doc — opens in browser.';
