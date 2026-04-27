@echo off
echo ============================================
echo  PRIME System — Push to GitHub
echo ============================================
echo.

:: Move into the PRIME Build folder (where this script lives)
cd /d "%~dp0"

echo Step 1: Initializing git...
git init

echo.
echo Step 2: Setting your GitHub identity...
git config user.email "PrimeOpps1@gmail.com"
git config user.name "Axiom Federal Solutions"

echo.
echo Step 3: Adding all files...
git add .

echo.
echo Step 4: Creating first commit...
git commit -m "Initial PRIME system build — all 9 agents + workflows"

echo.
echo Step 5: Connecting to your GitHub repo...
git branch -M main
git remote add origin https://github.com/axiom-federal-solutions/prime-system.git

echo.
echo Step 6: Pushing to GitHub...
echo (A browser window or login prompt may appear — sign in with PrimeOpps1@gmail.com)
git push -u origin main

echo.
echo ============================================
if %ERRORLEVEL% == 0 (
  echo  SUCCESS! All files are now on GitHub.
) else (
  echo  Something went wrong. See the red text above.
  echo  Common fix: make sure you're signed into GitHub
  echo  in your browser, then run this script again.
)
echo ============================================
echo.
pause
