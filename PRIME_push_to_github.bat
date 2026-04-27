@echo off
echo ================================================
echo  PRIME IQE — Pushing code to GitHub
echo  axiom-federal-solutions/prime-iqe-afs
echo ================================================
echo.

cd /d "C:\Users\renke\OneDrive\Documents\Claude\Projects\AFS_PRIME\Prime Build\PRIME Build"

echo Initializing git...
git init

echo Adding all files...
git add .

echo Creating commit...
git commit -m "Initial PRIME IQE system — 50 files, 9 agents, 29 tables, dual-vertical contracting automation"

echo Setting remote origin...
git remote remove origin 2>nul
git remote add origin https://github.com/axiom-federal-solutions/prime-iqe-afs.git

echo.
echo ================================================
echo  Pushing to GitHub...
echo  When prompted, enter your GitHub username.
echo  For password: use a Personal Access Token (NOT your GitHub password).
echo  Create one at: github.com/settings/tokens
echo  Check the "repo" scope and copy the token.
echo ================================================
echo.

git branch -M main
git push -u origin main

echo.
if %ERRORLEVEL% EQU 0 (
    echo SUCCESS! Code is on GitHub.
    echo https://github.com/axiom-federal-solutions/prime-iqe-afs
) else (
    echo Push failed. Check your Personal Access Token and try again.
)
echo.
pause
