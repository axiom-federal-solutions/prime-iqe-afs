-- =============================================================
-- PRIME — One-shot SCOUT diagnostic
-- HOW TO USE:
--   1. Push code changes to main + run scout-sam.yml manually from GitHub Actions
--   2. Wait for the SCOUT run to finish (~3 min)
--   3. Open Supabase → SQL Editor → New Query
--   4. Paste THIS ENTIRE FILE
--   5. Hit Run — read all 7 result blocks below
-- WHY IT EXISTS:
--   "Construction and supply data not showing" diagnostic. The new SCOUT
--   logging (probe + per-NAICS counts + per-vertical summary + upsert
--   failures) writes to agent_logs. This SQL reads it back as 7 reports.
-- AUDIT TRAIL: 2026-04-30 — built per No_Human_Build.skill troubleshooting
-- =============================================================


-- ── Q1. Schema parity — confirm canonical project has all expected tables ──
-- Skill expects 30 (legacy) or 40 (post-2026-04-30 update) tables.
SELECT
  COUNT(*) AS total_tables,
  STRING_AGG(table_name, ', ' ORDER BY table_name) AS table_names
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';


-- ── Q2. Opportunity row counts by vertical — the headline answer ──
-- If construction or supply rows are missing, this is where you see it.
SELECT
  COALESCE(vertical, '(null)') AS vertical,
  COUNT(*)                     AS rows,
  COUNT(value)                 AS rows_with_value,
  COUNT(DISTINCT naics)        AS distinct_naics,
  MIN(created_at)              AS earliest,
  MAX(created_at)              AS latest
FROM opportunities
GROUP BY vertical
ORDER BY rows DESC;


-- ── Q3. SAM.gov coverage per NAICS — proves whether SAM is empty for our NAICS ──
-- The NEW per-NAICS log captures this. If construction NAICS show 0 totalRecords,
-- the issue is SAM.gov has no opps for those NAICS this week — not a code bug.
SELECT
  created_at,
  metadata->>'vertical'       AS vertical,
  metadata->>'total_unique'   AS unique_opps,
  metadata->>'api_calls'      AS api_calls,
  jsonb_pretty(metadata->'naics_counts') AS naics_counts
FROM agent_logs
WHERE action = 'SAM.gov NAICS scan results'
ORDER BY created_at DESC
LIMIT 6;


-- ── Q4. Per-vertical scan summary — insert/failure counts ──
-- Tells you whether opps are being collected then failing on write,
-- vs never being collected at all.
SELECT
  created_at,
  metadata->>'vertical'        AS vertical,
  metadata->>'unique_opps'     AS unique_opps,
  metadata->>'inserted'        AS inserted,
  metadata->>'failures'        AS failures,
  metadata->>'api_calls_used'  AS api_calls
FROM agent_logs
WHERE action = 'Vertical scan complete'
ORDER BY created_at DESC
LIMIT 9;


-- ── Q5. SAM.gov probe results — confirms API key + base call works ──
-- If probe count is 0, your SAM key is broken or the date range is bad.
SELECT
  created_at,
  metadata->>'vertical'      AS vertical,
  metadata->>'probe_naics'   AS probe_naics,
  metadata->>'total_records' AS total_records,
  metadata->>'sample_count'  AS sample_count,
  metadata->'response_keys'  AS response_keys
FROM agent_logs
WHERE action IN ('SAM.gov probe', 'SAM.gov probe failed')
ORDER BY created_at DESC
LIMIT 6;


-- ── Q6. Upsert failures — show me the Postgres error code per failed row ──
-- If construction/supply rows are being collected but rejected by Postgres,
-- this is where we'd see it. Empty result = no write rejections.
SELECT
  created_at,
  metadata->>'vertical'            AS vertical,
  metadata->>'naics'               AS naics,
  metadata->>'solicitation_number' AS sol,
  metadata->>'error_code'          AS code,
  metadata->>'error'               AS error_message
FROM agent_logs
WHERE action IN ('Upsert failed', 'DIBBS upsert failed', 'Aborted — consecutive upsert failures')
ORDER BY created_at DESC
LIMIT 30;


-- ── Q7. Recent SCOUT runs — overall timeline + sam_calls counter ──
-- Sanity check: how often is SCOUT actually running? Quota usage?
SELECT
  created_at,
  action,
  metadata->>'new_opportunities' AS new_opps,
  metadata->>'sam_calls_used'    AS sam_calls,
  metadata->>'error'             AS error
FROM agent_logs
WHERE agent = 'SCOUT' AND action IN ('Scan complete','Scan failed','Aborted — consecutive upsert failures')
ORDER BY created_at DESC
LIMIT 12;


-- ── Q8. Bonus — sample 5 construction & 5 supply rows if any exist ──
-- Eyeball the actual data: are values populating? deadlines in range?
(SELECT 'construction sample' AS bucket, solicitation_number, naics, value, deadline, place_of_performance, set_aside
 FROM opportunities WHERE vertical = 'construction'
 ORDER BY created_at DESC LIMIT 5)
UNION ALL
(SELECT 'supply sample',          solicitation_number, naics, value, deadline, place_of_performance, set_aside
 FROM opportunities WHERE vertical = 'supply'
 ORDER BY created_at DESC LIMIT 5)
UNION ALL
(SELECT 'realestate sample',      solicitation_number, naics, value, deadline, place_of_performance, set_aside
 FROM opportunities WHERE vertical = 'realestate'
 ORDER BY created_at DESC LIMIT 5)
ORDER BY bucket, naics;
