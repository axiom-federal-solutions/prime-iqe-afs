@echo off
:: =============================================================
:: run-no-human-deploy.bat
:: Triggers the No-human deploy + diagnose workflow on GitHub.
:: Runs the full skill Step 4 sequence (T.E.S.T. -> SCOUT -> JUDGE
:: -> RECON -> BRANDI -> T.E.S.T.) and posts diagnostic SQL results
:: to the GitHub Run Summary. Use this after pushing a fix.
:: =============================================================
set REPO=axiom-federal-solutions/prime-iqe-afs
set /p PAT=GitHub PAT:
echo Triggering No-human deploy + diagnose...
curl -s -w "HTTP %%{http_code}" -X POST ^
  -H "Authorization: Bearer %PAT%" ^
  -H "Accept: application/vnd.github.v3+json" ^
  -H "Content-Type: application/json" ^
  "https://api.github.com/repos/%REPO%/actions/workflows/no-human-deploy.yml/dispatches" ^
  -d "{\"ref\":\"main\"}"
echo.
echo Watch: https://github.com/%REPO%/actions/workflows/no-human-deploy.yml
pause
