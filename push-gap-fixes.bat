@echo off
REM =============================================================
REM push-gap-fixes.bat — Round 2: NAICS coverage + BID ENGINE completion
REM
REM Fixes from this round:
REM   1. SCOUT now scans 14 supply NAICS (was 7) — fills empty filter buckets
REM   2. SUPPLY_NAICS_PREFIXES synced between scout.js and index.html
REM   3. BID ENGINE: real estate pricing path added (was missing — RE bids fell through)
REM   4. BID ENGINE: supply pricing graceful when distributor_prices is empty
REM   5. BID ENGINE: stale-price block scoped per-NAICS (not global)
REM   6. Filter UI: empty buckets dimmed but kept visible (.is-empty class)
REM   7. Removed duplicate construction.specialty.janitorial_svc from TAXONOMY
REM =============================================================

cd /d "%~dp0"

echo.
echo ── Verifying repo state ─────────────────────────────────────
git status --short
echo.

echo ── Staging changed files ────────────────────────────────────
git add agents/scout.js
git add agents/bidengine.js
git add dashboard/filter-system.js
git add dashboard/filter-system.css
git add index.html
git add push-gap-fixes.bat

echo.
echo ── Files staged: ────────────────────────────────────────────
git diff --cached --name-only
echo.

echo ── Committing ───────────────────────────────────────────────
git commit -m "Round 2: NAICS coverage + complete BID ENGINE + filter UI polish" -m "NAICS COVERAGE:" -m "- scout.js SUPPLY_NAICS expanded 7 -> 14 (added 424720, 339113, 423450, 424410, 311999, 453210, 315990)" -m "- index.html SUPPLY_NAICS_PREFIXES synced with scout.js (was inconsistent, mis-routed opps)" -m "- Empty filter buckets in Supply tab will now populate as SCOUT runs" -m "" -m "BID ENGINE:" -m "- Added calculateRealEstatePrice() (was missing entirely; RE STRONG_BIDs got bid rows but no pricing)" -m "  - 4 sub-models: lease offers (5311xx), property mgmt (53131x), advisory (5312/53139), equipment rental (5321/5324)" -m "- Supply pricing: graceful fallback when distributor_prices empty (was returning $0 bids)" -m "- Supply pricing: stale-price block scoped to current NAICS (was global, blocked all supply bids)" -m "- _deriveBidVertical() helper so BID ENGINE doesn't depend on dashboard's getVertical()" -m "" -m "FILTER UI:" -m "- Empty domain/category/sub buckets now show with .is-empty styling (45% opacity, dashed count border)" -m "- Hovers brighten so user knows they're still clickable" -m "- Tooltips explain why bucket is empty" -m "- Removed duplicate construction.specialty.janitorial_svc (561720 routes to supply via getVertical)"

if %errorlevel% neq 0 (
  echo.
  echo COMMIT FAILED — nothing to push. Most likely no changes staged.
  pause
  exit /b 1
)

echo.
echo ── Pushing to origin/main ───────────────────────────────────
git push origin main

if %errorlevel% neq 0 (
  echo.
  echo PUSH FAILED — check your branch ^(git branch --show-current^) and remote ^(git remote -v^).
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  PUSH SUCCESSFUL
echo ============================================================
echo.
echo Next steps (no SQL migration needed this round):
echo   1. GitHub Actions auto-deploys the dashboard ^(~30 sec^)
echo   2. SCOUT will pick up the new NAICS on its next cron tick (next 6-hour boundary)
echo      OR run No-human-deploy workflow manually to scan immediately
echo   3. Reload dashboard. Empty filter buckets should populate after ^~10 minutes
echo   4. Try BID ENGINE on a real estate opp ^(it now actually prices them^)
echo.
pause
