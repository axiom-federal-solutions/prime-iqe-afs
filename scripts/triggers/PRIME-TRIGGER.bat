@echo off
:: =============================================================
:: PRIME-TRIGGER.BAT — Manual workflow trigger menu
:: Usage: Double-click to launch, pick a number, hit Enter
:: Requires: curl (built into Windows 10/11)
:: PAT needs Actions: Read+Write scope on prime-iqe-afs repo
:: =============================================================

set REPO=axiom-federal-solutions/prime-iqe-afs
set /p PAT=Enter your GitHub PAT:

:MENU
cls
echo =====================================================
echo   PRIME SYSTEM — GitHub Actions Trigger Menu
echo =====================================================
echo.
echo   CORE AGENTS
echo   [1]  SCOUT     — SAM.gov + DIBBS scan (4x daily)
echo   [2]  SCOUT-STATE — State portal scan
echo   [3]  JUDGE     — Score new opportunities
echo   [4]  RECON     — Market intelligence run
echo   [5]  RECON-SUPPLIERS — Supplier match scan
echo   [6]  RECON-CONGRESSIONAL — Congressional intel
echo   [7]  BRANDI    — Morning brief (email)
echo   [8]  BRANDI-DAILY — Daily brief + supply digest
echo   [9]  VAULT     — Compliance check
echo   [10] VAULT-COMPLIANCE — Full compliance scan
echo   [11] BID ENGINE — Generate bid pricing
echo   [12] DRAFT     — Generate proposal draft
echo.
echo   FINANCIAL / COMPLIANCE
echo   [13] EXEC-DAILY — Cost + payroll sync
echo   [14] EXEC-CERTIFIED-PAYROLL — WH-347 check
echo   [15] EXEC-COST-SYNC — QuickBooks cost pull
echo   [16] LEDGER-WEEKLY — Weekly P^&L summary
echo   [17] LEDGER-MONTHLY — Monthly financial report
echo   [18] PROMPT-PAYMENT — Late payment checker
echo   [19] RETAINAGE — Retainage monitor
echo   [20] CPARS — CPARS rating monitor
echo.
echo   INTEL / ADMIN
echo   [21] GAO-PROTEST — GAO protest scanner
echo   [22] OSDBU — OSDBU event finder
echo   [23] SAM-HEALTH — SAM.gov registration check
echo   [24] TEST — Run T.E.S.T. validation suite
echo   [25] SEED-DB — Seed database with sample data
echo   [26] DEPLOY — Deploy dashboard to GitHub Pages
echo.
echo   COMPOSITE / DIAGNOSTIC
echo   [27] NO-HUMAN-DEPLOY — Skill Step 4 sequence + diagnostic
echo   [28] SMOKE-TEST-ALL — Run every agent once + pass/fail report
echo.
echo   [0]  EXIT
echo.
set /p CHOICE=Pick a number:

if "%CHOICE%"=="1"  call :TRIGGER scout-sam.yml
if "%CHOICE%"=="2"  call :TRIGGER scout-state-portals.yml
if "%CHOICE%"=="3"  call :TRIGGER judge-scoring.yml
if "%CHOICE%"=="4"  call :TRIGGER recon-intel.yml
if "%CHOICE%"=="5"  call :TRIGGER recon-supplier-scan.yml
if "%CHOICE%"=="6"  call :TRIGGER recon-congressional.yml
if "%CHOICE%"=="7"  call :TRIGGER brandi-briefing.yml
if "%CHOICE%"=="8"  call :TRIGGER brandi-daily.yml
if "%CHOICE%"=="9"  call :TRIGGER vault.yml
if "%CHOICE%"=="10" call :TRIGGER vault-compliance.yml
if "%CHOICE%"=="11" call :TRIGGER bidengine.yml
if "%CHOICE%"=="12" call :TRIGGER draft.yml
if "%CHOICE%"=="13" call :TRIGGER exec-daily.yml
if "%CHOICE%"=="14" call :TRIGGER exec-certified-payroll.yml
if "%CHOICE%"=="15" call :TRIGGER exec-cost-sync.yml
if "%CHOICE%"=="16" call :TRIGGER ledger-weekly.yml
if "%CHOICE%"=="17" call :TRIGGER ledger-monthly-report.yml
if "%CHOICE%"=="18" call :TRIGGER prompt-payment-check.yml
if "%CHOICE%"=="19" call :TRIGGER retainage-monitor.yml
if "%CHOICE%"=="20" call :TRIGGER cpars-monitor.yml
if "%CHOICE%"=="21" call :TRIGGER gao-protest-scan.yml
if "%CHOICE%"=="22" call :TRIGGER osdbu-event-finder.yml
if "%CHOICE%"=="23" call :TRIGGER sam-health-check.yml
if "%CHOICE%"=="24" call :TRIGGER test-validation.yml
if "%CHOICE%"=="25" call :TRIGGER seed-db.yml
if "%CHOICE%"=="26" call :TRIGGER deploy-dashboard.yml
if "%CHOICE%"=="27" call :TRIGGER no-human-deploy.yml
if "%CHOICE%"=="28" call :TRIGGER smoke-test-all.yml
if "%CHOICE%"=="0"  goto END

goto MENU

:TRIGGER
echo.
echo Triggering %1 ...
curl -s -o NUL -w "HTTP %%{http_code}" -X POST ^
  -H "Authorization: Bearer %PAT%" ^
  -H "Accept: application/vnd.github.v3+json" ^
  -H "Content-Type: application/json" ^
  "https://api.github.com/repos/%REPO%/actions/workflows/%1/dispatches" ^
  -d "{\"ref\":\"main\"}"
echo.
echo Done. Check: https://github.com/%REPO%/actions
echo.
pause
goto MENU

:END
exit
