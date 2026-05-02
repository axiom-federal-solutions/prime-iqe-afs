@echo off
REM =============================================================
REM push-all-fixes.bat — One-click commit + push for the 2026-05-02 build
REM
REM Pushes BOTH:
REM   1. The JUDGE -> BIDENGINE -> DRAFT trigger-chain fixes (agent files)
REM   2. The unified Domain -> Category -> Sub-category filter system
REM      (dashboard/, index.html, deploy-dashboard.yml, scout.js, sql/)
REM
REM Run this once you've reviewed the changes (git diff origin/main).
REM =============================================================

cd /d "%~dp0"

echo.
echo ── Verifying repo state ─────────────────────────────────────
git status --short
echo.

echo ── Staging changed files ────────────────────────────────────
git add agents/bidengine.js
git add agents/draft.js
git add agents/exec.js
git add agents/recon-suppliers.js
git add agents/scout.js
git add .github/workflows/bidengine.yml
git add .github/workflows/draft.yml
git add .github/workflows/judge-scoring.yml
git add .github/workflows/deploy-dashboard.yml
git add dashboard/filter-system.js
git add dashboard/filter-system.css
git add dashboard/INTEGRATION.md
git add sql/add-psc-column.sql
git add index.html
git add push-all-fixes.bat

echo.
echo ── Files staged: ────────────────────────────────────────────
git diff --cached --name-only
echo.

echo ── Committing ───────────────────────────────────────────────
git commit -m "Fix trigger chain + add unified filter system (Supply/Construction/RealEstate + Command Center search)" -m "AGENT FIXES:" -m "- bidengine.js: batch mode drains pending_pricing queue; transitions status->priced" -m "- draft.js: batch mode targets status=approved (human-in-loop preserved)" -m "- exec.js + recon-suppliers.js: log empty-input skips" -m "- scout.js: capture PSC (classificationCode) so dashboard filter can use it" -m "" -m "WORKFLOW WIRING:" -m "- bidengine.yml: workflow_run after SCOUT + hourly cron + optional manual input" -m "- draft.yml: 9am/4pm CT cron + optional manual input" -m "- judge-scoring.yml: fix workflow_run name mismatch" -m "- deploy-dashboard.yml: also copy dashboard/ folder" -m "" -m "DASHBOARD:" -m "- New unified filter system: Domain -> Category -> Sub-category across all 3 verticals" -m "- Config-driven (TAXONOMY in dashboard/filter-system.js) with PSC > NAICS > NLP mapping" -m "- Command Center fuzzy search across title/desc/agency/NAICS/PSC/sol#" -m "- Replaces legacy SUPPLY_CATS/selectSupplyCat/filterBySupplyCat (deleted)" -m "- Refactored renderVertical, vtFilter, showStateDetail to use unified pipeline" -m "" -m "DB MIGRATION REQUIRED (run once in Supabase SQL Editor):" -m "  sql/add-psc-column.sql" -m "" -m "Refs memory: scout uses ncode for SAM v2; canonical project czoyvxyfewqaoewzxlin"

if %errorlevel% neq 0 (
  echo.
  echo COMMIT FAILED — nothing to push. Most likely no changes staged or git not initialized.
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
echo Next steps:
echo   1. Open Supabase SQL Editor for project czoyvxyfewqaoewzxlin
echo   2. Run sql/add-psc-column.sql once
echo   3. GitHub Actions will auto-deploy the dashboard
echo   4. Wait ^~30 seconds, then reload your dashboard URL
echo   5. Verify: Supply tab shows new filter panel on the left
echo   6. Verify: Command Center home tab has search bar at top
echo.
pause
