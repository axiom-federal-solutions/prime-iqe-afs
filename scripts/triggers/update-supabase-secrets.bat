@echo off
REM ================================================================
REM UPDATE-SUPABASE-SECRETS.BAT
REM Updates SUPABASE_URL and SUPABASE_SERVICE_KEY in GitHub Secrets
REM after migrating to a new Supabase project.
REM
REM Requirements:
REM   - GitHub PAT with repo+secrets scope
REM   - curl (built into Windows 10/11)
REM   - Python (for base64 key encryption step)
REM
REM NOTE: GitHub Secrets API requires public-key encryption.
REM       This script uses the GitHub CLI (gh) which handles that automatically.
REM       Install gh: https://cli.github.com
REM ================================================================

set REPO=axiom-federal-solutions/prime-iqe-afs

echo ================================================================
echo  PRIME IQE — Update Supabase Secrets
echo  Repo: %REPO%
echo ================================================================
echo.

REM Check if gh CLI is installed
where gh >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: GitHub CLI (gh) is not installed.
  echo Install it from: https://cli.github.com
  echo Then run: gh auth login
  pause
  exit /b 1
)

echo Step 1: Enter your new Supabase project details
echo (Get these from: supabase.com/dashboard/project/YOUR_ID/settings/api)
echo.

set /p NEW_PROJECT_ID=New Supabase Project ID (e.g. abcdefghijklmnop):
set NEW_URL=https://%NEW_PROJECT_ID%.supabase.co

echo.
set /p SERVICE_KEY=Service Role Key (starts with eyJ..., the SECRET one):

echo.
echo Step 2: Updating GitHub Secrets...
echo.

REM Update SUPABASE_URL
echo Updating SUPABASE_URL to %NEW_URL%...
echo %NEW_URL% | gh secret set SUPABASE_URL --repo %REPO%
if %ERRORLEVEL% EQU 0 (
  echo [OK] SUPABASE_URL updated
) else (
  echo [FAIL] SUPABASE_URL — check gh auth status
)

REM Update SUPABASE_SERVICE_KEY
echo Updating SUPABASE_SERVICE_KEY...
echo %SERVICE_KEY% | gh secret set SUPABASE_SERVICE_KEY --repo %REPO%
if %ERRORLEVEL% EQU 0 (
  echo [OK] SUPABASE_SERVICE_KEY updated
) else (
  echo [FAIL] SUPABASE_SERVICE_KEY — check gh auth status
)

echo.
echo ================================================================
echo Done! GitHub Secrets updated.
echo.
echo Next step: Run scripts\triggers\run-scout.bat to populate data
echo ================================================================
echo.
pause
