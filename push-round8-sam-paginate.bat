@echo off
REM =============================================================
REM push-round8-sam-paginate.bat — Round 8: SAM size cap + pagination
REM
REM Probe round 7 result:
REM   - state filter dropped, fetch unblocked, BUT
REM   - SAM rejected size=250: "Size Cannot Exceed 10 Records" (errorCode SCE)
REM
REM Fix: drop size to 10 (the SAM hard cap), iterate up to 10 pages per NAICS,
REM stop early when a page returns <10 records (last page reached).
REM Max API calls: 9 NAICS x 10 pages = 90 calls. Was 162 originally.
REM =============================================================

cd /d "%~dp0"

git status --short
echo.
git add agents/recon-suppliers.js
git add push-round8-sam-paginate.bat
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit. Pushing existing commits.
) else (
  git commit -m "Round 8: SAM Entity API size cap + pagination" -m "SAM Entity API hard caps at 10 records per page (errorCode SCE)." -m "Round 7 had size=250 which triggered immediate rejection." -m "" -m "Fix:" -m "- size=10 (SAM hard cap)" -m "- paginate up to MAX_PAGES=10 per NAICS" -m "- stop early when a page returns <10 records (no more data)" -m "- per-NAICS log line shows total kept after state filter" -m "" -m "Max calls: 9 NAICS x 10 pages = 90 (vs 162 in original buggy version)."
)

echo.
git push origin main

if %errorlevel% neq 0 (
  echo PUSH FAILED.
  pause
  exit /b 1
)

echo.
echo PUSH SUCCESSFUL.
echo Re-run RECON Supplier Scan ^(mode=full^).
echo Should land 50-200 suppliers across 18 target states.
echo.
pause
