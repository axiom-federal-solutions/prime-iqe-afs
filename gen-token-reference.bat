@echo off
REM =============================================================
REM gen-token-reference.bat — One-click generate the token reference Word doc
REM
REM Output: PRIME-Bid-Template-Tokens.docx in the repo root
REM =============================================================

cd /d "%~dp0"

echo Installing docx package (one-time, if needed)...
call npm install --no-save --silent docx
if %errorlevel% neq 0 (
  echo.
  echo npm install failed. Make sure Node.js is installed.
  pause
  exit /b 1
)

echo.
echo Generating PRIME-Bid-Template-Tokens.docx...
node tools/gen-token-reference.js

if %errorlevel% neq 0 (
  echo.
  echo Generation failed. See error above.
  pause
  exit /b 1
)

echo.
echo Opening the document...
start "" "PRIME-Bid-Template-Tokens.docx"

echo.
echo Done. The doc is open in Word + saved at:
echo   %CD%\PRIME-Bid-Template-Tokens.docx
echo.
pause
