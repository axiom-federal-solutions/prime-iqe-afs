@echo off
REM =============================================================
REM push-round14b-node24.bat — Bump 5 workflows from Node 20 to Node 24
REM
REM RECON failed with: "Node.js 20 detected without native WebSocket support"
REM
REM Cause: Supabase JS v2 client initializes the Realtime subsystem on
REM createClient() which requires WebSocket. Node 20 doesn't have native
REM WebSocket; Node 22+ does.
REM
REM Workflows updated: exec-daily, ledger-weekly, recon-intel, seed-db,
REM vault-compliance. Other workflows already on Node 24.
REM =============================================================

cd /d "%~dp0"

git status --short
echo.
git add .github/workflows/exec-daily.yml
git add .github/workflows/ledger-weekly.yml
git add .github/workflows/recon-intel.yml
git add .github/workflows/seed-db.yml
git add .github/workflows/vault-compliance.yml
git add push-round14b-node24.bat
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel% equ 0 (
  echo Nothing new to commit.
) else (
  git commit -m "Round 14b: bump 5 workflows from Node 20 to Node 24" -m "RECON crashed with 'Node.js 20 detected without native WebSocket support'." -m "Supabase JS v2 client requires WebSocket for the Realtime subsystem;" -m "Node 22+ has it natively. Other workflows were already on Node 24." -m "Bumped: exec-daily, ledger-weekly, recon-intel, seed-db, vault-compliance"
)

echo.
git push origin main
if %errorlevel% neq 0 (
  echo PUSH FAILED. & pause & exit /b 1
)

echo.
echo PUSH SUCCESSFUL. Re-run RECON workflow now.
echo.
pause
