@echo off
REM =============================================================
REM push-round5-fixes.bat — Round 5: UI overhaul + VAULT visibility + suppliers fix
REM
REM Big batch:
REM   1. Logo swap to logo 2; sidebar reorder (OSDBU above Performance); halved Passed Archive number box
REM   2. Monte Carlo moved to Money Recovery (Revenue) tab; L6-06 label dropped
REM   3. Intelligence Features panel moved to Market Intel tab; L6 label dropped
REM   4. Agent Feed moved to System tab; Cost Breakdown removed from System
REM   5. Top Opportunities explainer card added; section reasoning visible
REM   6. VAULT alerts now appear in Action Queue (system_issues + cert/license expiry + INELIGIBLE bids)
REM   7. VAULT compliance rows seedable via sql/seed-compliance-records.sql; loadComplianceFromDb reads bonding capacity
REM   8. Region/all-states filter added to all 3 vertical tabs (10 regions, multi-select)
REM   9. Filter panels collapsible (▲ button on header) — collapsed view shows summary
REM  10. recon-supplier-scan.yml workflow_run name fixed ("JUDGE Scoring" -> "JUDGE - Opportunity Scoring")
REM  11. TAXONOMY keywords expanded with federal contracting terminology (MILCON, USACE, IDIQ, BPA, MAS, AbilityOne, BAH, etc.)
REM  12. distributor_prices seed file rewritten to match actual schema (4 columns, not 11)
REM =============================================================

cd /d "%~dp0"

echo.
echo -- Verifying repo state ---
git status --short
echo.

echo -- Staging changed files ---
git add index.html
git add agents/vault.js
git add dashboard/filter-system.js
git add dashboard/filter-system.css
git add .github/workflows/recon-supplier-scan.yml
git add sql/seed-distributor-prices.sql
git add sql/seed-compliance-records.sql
git add push-round5-fixes.bat

echo.
echo -- Files staged: ---
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit. Push step will sync any unpushed commits.
) else (
  echo -- Committing ---
  git commit -m "Round 5: UI overhaul + VAULT visibility + region filter + suppliers fix" -m "DASHBOARD UI:" -m "- Logo swapped to Prime logo 2.png" -m "- Sidebar: OSDBU Events moved above Performance" -m "- Passed Archive count box halved (60px wide, smaller fonts)" -m "- Monte Carlo Revenue Forecast moved from home to Money Recovery (Revenue) tab" -m "- Intelligence Features panel moved from home to Market Intel tab" -m "- Agent Feed moved from home to System tab" -m "- Cost Breakdown removed from System tab (operational cost stays internal)" -m "- L6-XX labels stripped from visible UI (Monte Carlo, Intel Features)" -m "- Top Opportunities section now has explainer card describing scoring logic" -m "" -m "ACTION QUEUE:" -m "- VAULT alerts surface as cards in Action Queue (system_issues + expiry + INELIGIBLE bids)" -m "- New 3-column KPI row: Urgent / New 24hr / VAULT Alerts" -m "" -m "VAULT:" -m "- New sql/seed-compliance-records.sql: 6 baseline rows so NOT TRACKED clears" -m "- loadComplianceFromDb extended to read bonding_capacity from compliance table" -m "  - Bonding limit auto-extracted from number field, surety from issuer field" -m "" -m "FILTER SYSTEM:" -m "- New region selector: 10 US regions, multi-select, 'All States' / 'Select all regions' shortcuts" -m "- filterContracts now applies region filter before taxonomy filter" -m "- Filter panels collapsible (▲ toggle on header); collapsed view shows active filter summary" -m "- TAXONOMY keywords expanded with federal contracting terms:" -m "  Construction: MILCON, USACE, NAVFAC, MATOC, IDIQ, sustainment, modernization" -m "  Office: GSA Schedule 75, BPA, MAS, FSS, AbilityOne, JWOD" -m "  Food: MRE, galley, DFAC, troop subsistence, prime vendor" -m "  RE Lease: RLP, SFO, build-to-suit, GSA Form 1364, RSF/USF" -m "  RE Residential: BAH, MHPI, RCI, dormitory, TLF" -m "  Facilities: BOS, BOSS, FACOPS, LOGCAP, FRP" -m "" -m "AGENTS:" -m "- recon-supplier-scan.yml: workflow_run name fixed (was 'JUDGE Scoring', actual is 'JUDGE - Opportunity Scoring')" -m "  - Auto-trigger now fires after JUDGE; supplier matches will populate" -m "" -m "SQL:" -m "- sql/seed-distributor-prices.sql rewritten for actual table schema (4 columns + naics + is_stale)" -m "- sql/seed-compliance-records.sql NEW — seeds 6 compliance rows (SAM, LA license, GL, WC, SDB, bonding)" -m "" -m "MIGRATIONS REQUIRED (run in Supabase SQL Editor):" -m "  sql/seed-distributor-prices.sql       (re-run; safe with idempotent ALTERs)" -m "  sql/seed-compliance-records.sql       (new)" -m "" -m "MANUAL ACTION:" -m "  Trigger 'RECON Supplier Scan' workflow manually with mode=full ONCE." -m "  Without this the suppliers table stays empty until next Monday 9am UTC."
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
echo Pending Supabase SQL migrations:
echo   1. sql/seed-distributor-prices.sql   ^(re-run with new shape^)
echo   2. sql/seed-compliance-records.sql   ^(new — fixes NOT TRACKED^)
echo.
echo Manual action — run once:
echo   GitHub Actions ^> RECON Supplier Scan ^> Run workflow ^> mode=full
echo   This populates the suppliers table; without it match-only finds nothing.
echo.
pause
