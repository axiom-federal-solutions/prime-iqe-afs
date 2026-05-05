@echo off
REM =============================================================
REM push-round13-sdvosb-search.bat — Round 13: SDVOSB tab + search click fix
REM
REM 1. NEW SDVOSB tab (sidebar after Real Estate ^& Rental):
REM    - Cross-vertical view: every opp with SDVOSB / Service-Disabled Veteran-Owned
REM      set-asides, pulled from construction + supply + real estate at once
REM    - 4-KPI breakdown by vertical
REM    - Score tier filter (ALL / 🔥 ≥85 / ✅ ≥70 / ⏳ unscored) with counts
REM    - Eligibility note: Walker is SDB, not SDVOSB — pursue these via teaming
REM
REM 2. BUG FIX: Command Center search results were not clickable.
REM    _openOppFromSearch in filter-system.js called openDetail/openOpp which
REM    don't exist. Actual handler is showDetail(idx). Now wired correctly.
REM =============================================================

cd /d "%~dp0"

git status --short
echo.
git add index.html
git add dashboard/filter-system.js
git add push-round13-sdvosb-search.bat
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit.
) else (
  git commit -m "Round 13: SDVOSB cross-vertical tab + search click bug fix" -m "NEW SDVOSB TAB:" -m "- Sidebar: 🎖️ SDVOSB after Real Estate ^& Rental" -m "- Aggregates every active opp where set_aside matches SDVOSB / VETERAN / SDV / VOSB / SERVICE-DISABLED" -m "- 4 KPIs: Construction count, Supply count, Real Estate count, Total" -m "- Score tier filter (ALL / 🔥 above 85 / ✅ 70-84 / ⏳ unscored) with counts" -m "- Eligibility caveat displayed: Walker is SDB-certified, NOT SDVOSB — these require an SDVOSB teaming partner as prime" -m "- Reuses existing oppRow renderer; opps are clickable straight to detail panel" -m "" -m "BUG FIX:" -m "- _openOppFromSearch called openDetail/openOpp which don't exist in index.html" -m "- Now calls showDetail(idx) — Command Center search results open the detail panel"
)

echo.
git push origin main
if %errorlevel% neq 0 (
  echo PUSH FAILED. & pause & exit /b 1
)

echo.
echo PUSH SUCCESSFUL.
echo.
echo Reload dashboard. Two changes to verify:
echo   1. Sidebar shows new "🎖️ SDVOSB" item under Real Estate ^& Rental
echo   2. Command Center: type a search query, click any result row — opens detail panel
echo.
pause
