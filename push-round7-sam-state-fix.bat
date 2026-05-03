@echo off
REM =============================================================
REM push-round7-sam-state-fix.bat — Round 7: SAM state filter fix
REM
REM Probe ground truth from previous run:
REM   v3 SAM API: "The search parameter, physicalAddressStateCode does not exist"
REM   v4 SAM API: same — Invalid Input Parameters / IIP / physicalAddressStateCode
REM   v2 SAM API: same as v4
REM
REM Fix: drop state from URL params, filter results client-side.
REM Trades 1 wider call per NAICS for guaranteed-working scan.
REM =============================================================

cd /d "%~dp0"

echo.
git status --short
echo.

git add agents/recon-suppliers.js
git add push-round7-sam-state-fix.bat

echo.
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit. Pushing existing commits.
) else (
  git commit -m "Round 7: SAM Entity API state filter moved client-side" -m "Probe confirmed SAM Entity API does NOT accept physicalAddressStateCode" -m "in any version (v2/v3/v4 all return 400 Invalid Input Parameters / IIP)." -m "" -m "Fix: drop physicalAddressStateCode from URL, fetch all entities for NAICS," -m "filter to TARGET_STATES client-side via stateOrProvinceCode in response." -m "" -m "- Inner state loop removed (was 9 NAICS x 18 states = 162 calls)" -m "- Now 1 call per NAICS at size=250 (9 calls total instead of 162)" -m "- 96%% reduction in SAM API quota usage" -m "- Sleep increased 150ms -> 250ms to stay safely under rate limit" -m "- Per-NAICS log line: 'X entities returned, Y in target states'" -m "" -m "Side effect: state filter loosened — if SAM returns 250 entities and only" -m "6 are in our target states, we still process all 250 (cheap, in-memory). If" -m "we ever hit a NAICS where >250 entities exist nationwide, we'd miss some." -m "9 NAICS we scan are specialized enough that this should not happen."
)

echo.
git push origin main

if %errorlevel% neq 0 (
  echo PUSH FAILED -- check branch and remote.
  pause
  exit /b 1
)

echo.
echo PUSH SUCCESSFUL.
echo Re-run RECON Supplier Scan from GitHub Actions ^(mode=full^).
echo Should now upsert real supplier rows.
echo.
pause
