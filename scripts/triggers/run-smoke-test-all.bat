@echo off
:: =============================================================
:: run-smoke-test-all.bat
:: Triggers the Smoke-test all agents workflow.
:: Runs every agent once and reports pass/fail per agent.
:: Use this for broader coverage than No-human deploy.
:: =============================================================
set REPO=axiom-federal-solutions/prime-iqe-afs
set /p PAT=GitHub PAT:
echo Triggering Smoke-test all agents...
curl -s -w "HTTP %%{http_code}" -X POST ^
  -H "Authorization: Bearer %PAT%" ^
  -H "Accept: application/vnd.github.v3+json" ^
  -H "Content-Type: application/json" ^
  "https://api.github.com/repos/%REPO%/actions/workflows/smoke-test-all.yml/dispatches" ^
  -d "{\"ref\":\"main\"}"
echo.
echo Watch: https://github.com/%REPO%/actions/workflows/smoke-test-all.yml
pause
