@echo off
set REPO=axiom-federal-solutions/prime-iqe-afs
set /p PAT=GitHub PAT:
echo Triggering EXEC-DAILY (cost + payroll sync)...
curl -s -w "HTTP %%{http_code}" -X POST -H "Authorization: Bearer %PAT%" -H "Accept: application/vnd.github.v3+json" -H "Content-Type: application/json" "https://api.github.com/repos/%REPO%/actions/workflows/exec-daily.yml/dispatches" -d "{\"ref\":\"main\"}"
echo.
echo Check: https://github.com/%REPO%/actions
pause
