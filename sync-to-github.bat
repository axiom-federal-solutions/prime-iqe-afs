@echo off
echo ============================================
echo  PRIME System — Sync All Files to GitHub
echo ============================================
echo.

:: Move into the PRIME Build folder (where this script lives)
cd /d "%~dp0"

echo Step 1: Adding all new and updated files...
git add .

echo.
echo Step 2: Committing changes...
git commit -m "PRIME build: add 12 workflows + 11 agent sub-files (Walker Contractors build doc 100%%)"

echo.
echo Step 3: Pushing to GitHub...
git push

echo.
echo ============================================
if %ERRORLEVEL% == 0 (
  echo  SUCCESS! All files are now on GitHub.
  echo.
  echo  Next steps:
  echo  1. Go to Supabase SQL Editor (prime-db)
  echo  2. Run config\flush-bad-data.sql
  echo  3. Go to GitHub Actions tab
  echo  4. Trigger "SCOUT - SAM.gov Scan" manually
  echo  5. Wait 3 min, check opportunities table
) else (
  echo  Push failed. Try these fixes:
  echo  - Run: git remote -v  (check remote URL)
  echo  - Run: git status     (check what changed)
  echo  - If first push: run push-to-github.bat instead
)
echo ============================================
echo.
pause
