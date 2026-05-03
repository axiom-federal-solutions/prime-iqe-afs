@echo off
REM =============================================================
REM push-round10-google-probe.bat — Round 10: Google OAuth foundation
REM
REM Phase 1 of the Drive + Sheets bid automation:
REM   - lib/google-auth.js: refresh-token to access-token helper with caching
REM   - agents/google-probe.js: 3-step smoke test (OAuth, Drive about, file list)
REM   - .github/workflows/google-probe.yml: manual trigger workflow
REM
REM Phase 2 (after probe verified) will add:
REM   - lib/google-drive.js: copy template, create folder, share permissions
REM   - lib/google-sheets.js: read template, write cells with auto-populate
REM   - agents/draft-bid.js: turn approved bid into Google Sheet draft
REM   - SQL: proposals + bid_outcomes tables
REM   - Workflow: triggers on bids.status = 'approved'
REM   - Win/loss tracking + lost-bid debrief automation
REM =============================================================

cd /d "%~dp0"

git status --short
echo.
git add lib/google-auth.js
git add agents/google-probe.js
git add .github/workflows/google-probe.yml
git add push-round10-google-probe.bat
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit.
) else (
  git commit -m "Round 10: Google OAuth foundation + smoke test workflow" -m "Phase 1 of bid-draft automation. Builds the auth helper that future" -m "Drive/Sheets integration sits on top of." -m "" -m "- lib/google-auth.js: refresh_token -> access_token exchange with 55-min" -m "  in-memory cache. Uses fetch only (no Google SDK dependency)." -m "- agents/google-probe.js: 3-step smoke test that calls OAuth + Drive APIs" -m "  and writes result to agent_logs." -m "- .github/workflows/google-probe.yml: manual workflow_dispatch trigger." -m "" -m "After this push, run the workflow ONCE manually. If it logs ALL CHECKS PASSED" -m "we proceed to Phase 2: lib/google-drive.js + lib/google-sheets.js + the" -m "actual draft-bid agent."
)

echo.
git push origin main
if %errorlevel% neq 0 (
  echo PUSH FAILED. & pause & exit /b 1
)

echo.
echo PUSH SUCCESSFUL.
echo.
echo NEXT: GitHub Actions ^> "Google OAuth + Drive Probe" ^> Run workflow
echo If it ends with "ALL CHECKS PASSED" — secrets are good, I build phase 2.
echo If it errors — paste me the error and we fix the OAuth setup before going further.
echo.
pause
