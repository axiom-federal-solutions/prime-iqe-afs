@echo off
REM =============================================================
REM push-round11-bid-draft.bat — Round 11: Drive + Sheets bid draft generator
REM
REM Phase 2 of Drive automation. Builds on the OAuth foundation from Round 10.
REM
REM What this round adds:
REM   - lib/google-drive.js: folder + file ops (ensureFolder, copyFile, createSheet)
REM   - lib/google-sheets.js: writeRange, batchUpdate, buildDraftRows
REM   - agents/draft-bid.js: main agent, batch mode + single-bid mode
REM   - .github/workflows/bid-draft.yml: hourly cron + manual workflow_dispatch
REM   - sql/add-proposals-and-outcomes.sql: 2 new tables for tracking
REM =============================================================

cd /d "%~dp0"

git status --short
echo.
git add lib/google-drive.js
git add lib/google-sheets.js
git add agents/draft-bid.js
git add .github/workflows/bid-draft.yml
git add sql/add-proposals-and-outcomes.sql
git add push-round11-bid-draft.bat
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit.
) else (
  git commit -m "Round 11: Drive + Sheets bid draft generator (Phase 2)" -m "Builds on Round 10 OAuth foundation. Mr. Kemp approving a bid now triggers" -m "auto-creation of a Google Sheet pre-populated with all relevant data." -m "" -m "FILES:" -m "- lib/google-drive.js: ensureFolder, copyFile, createSheetInFolder, getFileMeta" -m "- lib/google-sheets.js: writeRange, batchUpdate, renameFirstTab, buildDraftRows" -m "- agents/draft-bid.js: single + batch mode; pulls bid + opp + compliance + suppliers;" -m "  creates Sheet in PRIME — Federal Bid Drafts folder; saves URL to proposals table" -m "- .github/workflows/bid-draft.yml: hourly cron (15 past) + manual dispatch" -m "" -m "SQL MIGRATIONS REQUIRED (run in Supabase):" -m "  sql/add-proposals-and-outcomes.sql" -m "  - Adds proposals (drive_file_id, sheet_url, status lifecycle)" -m "  - Adds bid_outcomes (debrief tracking, lessons learned, FAR 15.506)" -m "" -m "PIPELINE:" -m "  JUDGE -> bid pending_pricing -> BID ENGINE -> priced -> Mr. Kemp approves" -m "    -> bid status=approved -> hourly bid-draft.yml fires -> Google Sheet appears" -m "    in PrimeOps1@gmail.com Drive -> proposals row inserted -> bid status=drafted" -m "" -m "Round 12 (next, after Mr. Kemp manually approves first bid and verifies the" -m "Sheet looks right) will add the lost-bid debrief automation + win/loss" -m "Performance tab updates."
)

echo.
git push origin main
if %errorlevel% neq 0 (
  echo PUSH FAILED. & pause & exit /b 1
)

echo.
echo PUSH SUCCESSFUL.
echo.
echo NEXT STEPS:
echo   1. Run sql/add-proposals-and-outcomes.sql in Supabase SQL Editor
echo   2. To test the agent end-to-end:
echo      a. Find a bid id in the bids table
echo      b. UPDATE bids SET status='approved' WHERE id='YOUR_BID_ID';
echo      c. GitHub Actions ^> BID DRAFT - Generate Google Sheet ^> Run workflow
echo         ^(leave bid_id blank to use batch mode^)
echo      d. Check primeopps1@gmail.com Drive — should see "PRIME — Federal Bid Drafts"
echo         folder with a new Sheet
echo      e. Open the Sheet — should be pre-populated with opp/pricing/compliance
echo.
pause
