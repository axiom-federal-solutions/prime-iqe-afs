@echo off
REM =============================================================
REM push-round14-pricing-comps-coverage.bat
REM
REM Round 14: Fix silent breaks preventing pricing + market comps from auto-populating.
REM
REM 1. JUDGE: now creates bid records for ANY non-NO_BID tier (was only BID/STRONG_BID)
REM    - Score 55-69 CONDITIONAL opps no longer skipped — pricing reaches 95%% of opps
REM
REM 2. RECON FPDS scanner rewritten:
REM    - Dynamically pulls every NAICS in the live opportunities table (was 11 hardcoded)
REM    - Falls back to the 32-NAICS SCOUT list to seed coverage
REM    - Loops through 10 states per NAICS (was just LA — split bug took only [0])
REM    - Bumped max-records 25 -^> 50
REM    - incumbents now populated for ALL verticals (was supply-only)
REM
REM 3. BIDENGINE BATCH_LIMIT 10 -^> 30, cron hourly -^> every 30 min
REM    - 240/day -^> 1440/day max throughput
REM
REM 4. NEW SQL: sql/backfill-conditional-bids.sql — creates bid rows for already-scored
REM    CONDITIONAL opps so BIDENGINE picks them up retroactively
REM =============================================================

cd /d "%~dp0"

git status --short
echo.
git add agents/judge.js
git add agents/recon.js
git add agents/bidengine.js
git add .github/workflows/bidengine.yml
git add sql/backfill-conditional-bids.sql
git add push-round14-pricing-comps-coverage.bat
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit.
) else (
  git commit -m "Round 14: pricing + market comps auto-populate fixes" -m "JUDGE:" -m "- Now creates bids for any non-NO_BID tier (was only BID/STRONG_BID)" -m "- CONDITIONAL tier (score 55-69) was the most common bucket, never priced" -m "" -m "RECON FPDS scanner:" -m "- Dynamic NAICS from opportunities table (was 11 hardcoded codes)" -m "- 10-state loop per NAICS (was using only LA due to .split(',')[0] bug)" -m "- max-records 25 -^> 50" -m "- incumbents populated for ALL verticals (was supply-only)" -m "" -m "BIDENGINE:" -m "- BATCH_LIMIT 10 -^> 30 (pricing is pure math, no API)" -m "- Cron hourly -^> every 30 min" -m "- Throughput: 1440 bids/day vs 240/day" -m "" -m "MIGRATION REQUIRED:" -m "  sql/backfill-conditional-bids.sql ^(creates bid rows for existing CONDITIONAL opps^)"
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
echo   1. Run sql/backfill-conditional-bids.sql in Supabase
echo      (creates bid rows for existing CONDITIONAL opps)
echo   2. GitHub Actions ^> "BID ENGINE" ^> Run workflow ^> empty input
echo      (force-drains the new queue immediately)
echo   3. GitHub Actions ^> "RECON - Market Intelligence" ^> Run workflow
echo      (populates competitor_intel + incumbents for all live NAICS)
echo   4. Reload dashboard. Opps should now show:
echo      - BID PRICING populated (after BIDENGINE finishes)
echo      - MARKET COMPS populated (after RECON finishes)
echo      - WHO HAD THIS CONTRACT LAST populated (after RECON finishes)
echo.
pause
