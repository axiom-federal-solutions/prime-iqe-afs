@echo off
REM =============================================================
REM push-round4-fixes.bat — Round 4: RECON + LEDGER + BRANDI + bidengine
REM
REM Fixes from this round:
REM   1. RECON: empty-input logging in recon-gao.js, recon-cpars.js
REM   2. RECON-OSDBU: tightened event detection (was firing every Monday on every page)
REM   3. LEDGER ML: progress-toward-threshold logging (X of 20 outcomes)
REM   4. BRANDI: pendingRow renders BID ENGINE pricing + VAULT compliance status
REM   5. BRANDI: vertical detection synced with scout.js (was mis-classifying new supply NAICS)
REM   6. BIDENGINE: distributor pricing averages instead of summing (5 quotes x $100 was producing $500)
REM   7. NEW: sql/seed-distributor-prices.sql (32 baseline quotes across 14 supply NAICS)
REM =============================================================

cd /d "%~dp0"

echo.
echo -- Verifying repo state ---
git status --short
echo.

echo -- Staging changed files ---
git add agents/recon-gao.js
git add agents/recon-cpars.js
git add agents/recon-osdbu.js
git add agents/ledger.js
git add agents/brandi.js
git add agents/bidengine.js
git add sql/seed-distributor-prices.sql
git add push-round4-fixes.bat

echo.
echo -- Files staged: ---
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit. Push step will sync any unpushed commits.
) else (
  echo -- Committing ---
  git commit -m "Round 4: RECON visibility + LEDGER ML progress + BRANDI rendering + pricing fix" -m "RECON:" -m "- recon-gao.js: log empty-input when no recent losses in protest window" -m "- recon-cpars.js: log empty-input when cpars_ratings table empty" -m "- recon-osdbu.js: tightened event detection (require 2+ keywords AND date+CTA pattern)" -m "  - Was firing 'event found' weekly on every page because 'small business' is on every OSDBU site" -m "" -m "LEDGER:" -m "- checkMLThreshold: log ML training progress (X of 20 outcomes, days since last train)" -m "  - Dashboard can now show ML readiness without digging through console output" -m "" -m "BRANDI:" -m "- pendingRow rebuilt: renders BID ENGINE pricing + ESTIMATE/LIVE QUOTES badge" -m "- Real estate breakdown sub-line for lease, PM, advisory, rental sub-models" -m "- Supply pricing_source note rendered" -m "- VAULT compliance status block (ELIGIBLE green / INELIGIBLE red with failure reasons)" -m "- _bidVertical helper: vertical detection synced with scout.js / TAXONOMY" -m "  - Was using hardcoded 5-NAICS supply list — mis-classified new codes 339113/423450/etc." -m "" -m "BID ENGINE:" -m "- calculateSupplyPrice: averages distributor unit_prices instead of summing" -m "  - Bug: 5 quotes x $100 produced $500 material cost (should average to $100)" -m "  - Now reports min/max range so Mr. Kemp sees pricing room" -m "" -m "MIGRATION REQUIRED (run once in Supabase SQL Editor for czoyvxyfewqaoewzxlin):" -m "  sql/seed-distributor-prices.sql"
)

echo.
echo -- Pushing to origin/main ---
git push origin main

if %errorlevel% neq 0 (
  echo.
  echo PUSH FAILED -- check branch and remote.
  pause
  exit /b 1
)

echo.
echo =====================================================
echo  PUSH SUCCESSFUL
echo =====================================================
echo.
echo Pending Supabase SQL migrations (in order):
echo   1. sql/add-psc-column.sql              ^(if not yet run^)
echo   2. sql/add-assets-table.sql            ^(if not yet run^)
echo   3. sql/seed-distributor-prices.sql     ^(this round^)
echo.
echo After running #3, BID ENGINE will produce realistic supply bids
echo using averaged distributor quotes instead of the 65%% fallback.
echo.
pause
