@echo off
:: ============================================================
:: PRIME IQE — Full System Test Run
:: Run this AFTER wiping data in Supabase SQL Editor
:: Requires: GitHub CLI (gh) installed + authenticated
:: Repo: axiom-federal-solutions/prime-iqe-afs
:: ============================================================

set REPO=axiom-federal-solutions/prime-iqe-afs

echo.
echo ========================================
echo  PRIME IQE — FULL SYSTEM TEST
echo ========================================
echo.

:: Step 1: Push latest code
echo [1/6] Pushing latest code to GitHub...
cd /d "%~dp0"
git add -A
git commit -m "chore: pre-test commit — fresh data run" --allow-empty
git push origin main
echo Done.
echo.

:: Step 2: Pre-flight T.E.S.T. (DB health check)
echo [2/6] Running T.E.S.T. pre-flight (DB health)...
gh workflow run test-validation.yml --repo %REPO% --field reason="Pre-flight: DB wipe verification"
echo Triggered. Waiting 45 seconds for results...
timeout /t 45 /nobreak >nul
echo.

:: Step 3: Run SCOUT — pull all 32 NAICS from SAM.gov
echo [3/6] Running SCOUT — scanning SAM.gov across all 32 NAICS...
gh workflow run scout-sam.yml --repo %REPO%
echo Triggered. Waiting 90 seconds for SCOUT to complete...
timeout /t 90 /nobreak >nul
echo.

:: Step 4: Run JUDGE — score all new opportunities
echo [4/6] Running JUDGE — scoring all new opportunities...
gh workflow run judge-score.yml --repo %REPO%
echo Triggered. Waiting 60 seconds for JUDGE to complete...
timeout /t 60 /nobreak >nul
echo.

:: Step 5: Run RECON — build supplier matches
echo [5/6] Running RECON — building supplier intelligence...
gh workflow run recon-suppliers.yml --repo %REPO%
echo Triggered. Waiting 45 seconds...
timeout /t 45 /nobreak >nul
echo.

:: Step 6: Final T.E.S.T. validation
echo [6/6] Running T.E.S.T. final validation...
gh workflow run test-validation.yml --repo %REPO% --field reason="Post-run: full system validation"
echo Triggered.
echo.

echo ========================================
echo  ALL WORKFLOWS TRIGGERED
echo ========================================
echo.
echo Next steps:
echo  1. Open GitHub Actions to monitor runs:
echo     https://github.com/%REPO%/actions
echo  2. Open index.html in Chrome to see live data
echo  3. Check PrimeOpps1@gmail.com for BRANDI morning brief
echo.
echo Opening GitHub Actions now...
start "" "https://github.com/%REPO%/actions"
echo.
pause
