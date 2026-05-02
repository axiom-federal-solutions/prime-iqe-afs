@echo off
REM =============================================================
REM push-vault-fixes.bat — Round 3: VAULT structural cleanup
REM
REM Fixes from this round:
REM   1. SUPPLY_NAICS in vault.js synced (was 7 codes, now 14) — supply bids no longer mis-routed to construction gate
REM   2. REAL_ESTATE_NAICS expanded 4 -> 9 — RE property mgmt + advisory bids hit correct gate
REM   3. NEW: assets table schema (sql/add-assets-table.sql) — RE asset ownership has somewhere to live
REM   4. VAULT now reads `compliance` table for live SAM/license/insurance expirations (was hardcoded)
REM   5. Asset ownership query uses new assets table; degrades gracefully if migration not yet run
REM   6. getAssetTypeFromNAICS expanded from 4 to 9 NAICS mappings
REM   7. Per-bid logAction calls so BRANDI can render INELIGIBLE reasons in morning brief
REM   8. Empty-input logging (logs "no pending bids" instead of silent return)
REM =============================================================

cd /d "%~dp0"

echo.
echo -- Verifying repo state ---
git status --short
echo.

echo -- Staging changed files ---
git add agents/vault.js
git add sql/add-assets-table.sql
git add push-vault-fixes.bat

echo.
echo -- Files staged: ---
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit. Push step will sync any unpushed commits.
) else (
  echo -- Committing ---
  git commit -m "Round 3: VAULT structural cleanup + assets table" -m "VAULT NAICS routing:" -m "- SUPPLY_NAICS synced 7->14 codes with scout.js / TAXONOMY (was mis-routing supply bids to construction gate)" -m "- REAL_ESTATE_NAICS expanded 4->9 codes (property mgmt 531311/531312, advisory 531210/531390, land 531190 were missing)" -m "- getAssetTypeFromNAICS expanded with 9 NAICS->asset_type mappings" -m "" -m "VAULT data sources:" -m "- NEW assets table (sql/add-assets-table.sql) holds owned property/equipment/vehicles" -m "  - Replaces previous broken pattern of querying `compliance` table (which is for certs, not assets)" -m "  - asset_type column matches getAssetTypeFromNAICS output" -m "  - RLS: anon read enabled, service-role write only" -m "- loadComplianceFromDb() reads `compliance` table for live SAM/license/insurance expirations" -m "  - Hardcoded values now act as fallback only" -m "  - Renewals are a DB row update, no code change required" -m "" -m "VAULT visibility:" -m "- Per-bid logAction calls (construction/supply/real estate) so BRANDI brief can show INELIGIBLE reasons" -m "- 'No pending bids to check' logged when input empty (was silent skip)" -m "- Asset table query failure surfaces as a check failure with migration hint" -m "" -m "MIGRATION REQUIRED (run once in Supabase SQL Editor for czoyvxyfewqaoewzxlin):" -m "  sql/add-assets-table.sql"
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
echo Next steps:
echo   1. Open Supabase SQL Editor for project czoyvxyfewqaoewzxlin
echo   2. Run sql/add-assets-table.sql once
echo   3. Insert at least one row per asset type Walker actually owns
echo      ^(see seed hint comments in the .sql file^)
echo   4. Optional: backfill `compliance` table with current SAM/license expirations
echo      so VAULT stops using the hardcoded defaults
echo.
pause
