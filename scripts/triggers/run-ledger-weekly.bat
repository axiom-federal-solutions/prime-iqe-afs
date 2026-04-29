@echo off
set REPO=axiom-federal-solutions/prime-iqe-afs
set /p PAT=GitHub PAT:
echo Triggering LEDGER-WEEKLY (weekly P^&L summary)...
curl -s -w "HTTP %%{http_code}" -X POST -H "Authorization: Bearer %PAT%" -H "Accept: application/vnd.github.v3+json" -H "Content-Type: application/json" "https://api.github.com/repos/%REPO%/actions/workflows/ledger-weekly.yml/dispatches" -d "{\"ref\":\"main\"}"
echo.
echo Check: https://github.com/%REPO%/actions
pause
