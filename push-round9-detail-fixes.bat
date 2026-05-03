@echo off
REM =============================================================
REM push-round9-detail-fixes.bat — Round 9: detail panel + map UX fixes
REM
REM 1. Filter panel collapses to LEFT (36px strip), not up/down.
REM    Right side (map + opps) gets the freed-up width.
REM 2. Detail panel: response_deadline -> getDeadline() reads either field.
REM    Fixes blank Deadline / Remaining everywhere.
REM 3. Score breakdown always renders — pending factors show as 0 with note.
REM 4. Description: detects URL vs synopsis, renders link clearly when URL.
REM 5. Market Comps: falls back to incumbents when competitor_intel empty.
REM 6. State letters now color-coded by license:
REM    construction: green=licensed, blue=reciprocal/pending, red=no license
REM    supply: all green (drop-ship, no state license)
REM    realestate: green=asset on file, blue=pending, red=no asset
REM 7. Monte Carlo moved BELOW Interest/Late/Resolved KPI row in Money tab.
REM =============================================================

cd /d "%~dp0"

git status --short
echo.
git add index.html
git add dashboard/filter-system.js
git add dashboard/filter-system.css
git add push-round9-detail-fixes.bat
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit. Pushing existing.
) else (
  git commit -m "Round 9: filter collapse-to-left + detail panel field fixes + license-based state colors" -m "FILTER:" -m "- Collapses to 36px vertical strip on left (was up/down accordion)" -m "- Right column (map + opps) reclaims full width when collapsed" -m "" -m "DETAIL PANEL:" -m "- Bug fix: dashboard read o.response_deadline but SCOUT writes o.deadline" -m "  Result: Deadline + Remaining were blank everywhere. Now reads either via getDeadline()" -m "- Score breakdown: always renders, pending factors show as 0 with (pending) tag" -m "- Description: detects URL-only descriptions and renders as clickable link card instead of raw URL text" -m "- Market Comps: falls back to incumbents table when competitor_intel is empty" -m "" -m "STATE MAP:" -m "- State letter colors driven by LICENSE STATUS, not opp count:" -m "  construction: green=LA (home), blue=MS/AL/TX/AR/OK (reciprocal), red=others" -m "  supply: all green (drop-ship requires no state license)" -m "  realestate: green=active asset on file, blue=pending asset, red=no asset" -m "- Legend bar above the map explains the colors per vertical" -m "" -m "MONEY TAB:" -m "- Monte Carlo moved BELOW the Interest/Late/Resolved KPI row per user feedback"
)

echo.
git push origin main
if %errorlevel% neq 0 (
  echo PUSH FAILED. & pause & exit /b 1
)

echo.
echo PUSH SUCCESSFUL.
echo Reload dashboard to see all fixes.
echo.
pause
