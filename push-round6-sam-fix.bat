@echo off
REM =============================================================
REM push-round6-sam-fix.bat — Round 6: SAM Entity API 400 fix
REM
REM 1. Strip deprecated SAM Entity API params (purposeOfRegistrationCode=Z2,
REM    entityECAFlag=N, registrationStatus=Active) — were causing 400 on every call
REM 2. Switch primary endpoint to v4 (was v3); auto-fallback to v3 if v4 400's 3x in a row
REM 3. Log SAM error response BODY to agent_logs so we can diagnose without re-running
REM 4. New diagnostic workflow: RECON SAM Probe — one-shot test of v2/v3/v4 with full output
REM =============================================================

cd /d "%~dp0"

echo.
echo -- Verifying repo state ---
git status --short
echo.

echo -- Staging changed files ---
git add agents/recon-suppliers.js
git add .github/workflows/recon-sam-probe.yml
git add push-round6-sam-fix.bat

echo.
echo -- Files staged: ---
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit. Push step will sync any unpushed commits.
) else (
  echo -- Committing ---
  git commit -m "Round 6: Fix SAM Entity API 400 errors blocking supplier scan" -m "RECON-SUPPLIERS:" -m "- Removed deprecated params: purposeOfRegistrationCode='Z2', entityECAFlag='N', registrationStatus='Active'" -m "  - These were rejected by SAM v3+ and produced 400 on every call (zero suppliers loaded)" -m "- Primary endpoint now v4 ^(was v3^); auto-fallback to v3 after 3 consecutive 400s" -m "- Error response body now logged to agent_logs so future debugging doesn't need workflow logs" -m "- Reduced page size 100 -^> 50 ^(less latency on retries^)" -m "" -m "NEW WORKFLOW:" -m "- .github/workflows/recon-sam-probe.yml — one-shot diagnostic that hits v4, v3, v2 with curl" -m "  Prints full response body so we can see EXACTLY what SAM.gov rejects" -m "  Run manually from Actions tab when 400s recur"
)

echo.
echo -- Pushing to origin/main ---
git push origin main

if %errorlevel% neq 0 (
  echo PUSH FAILED -- check branch and remote.
  pause
  exit /b 1
)

echo.
echo =====================================================
echo  PUSH SUCCESSFUL
echo =====================================================
echo.
echo NEXT STEPS:
echo   1. GitHub Actions ^> RECON SAM Probe ^> Run workflow ^(one-shot diagnostic^)
echo      - Check the output. Tells us EXACTLY what SAM.gov returns now.
echo   2. GitHub Actions ^> RECON Supplier Scan ^> Run workflow ^> mode=full
echo      - Should now succeed with the new minimum param set
echo      - Check agent_logs for "SAM Entity API rejected request" if it still fails
echo.
pause
