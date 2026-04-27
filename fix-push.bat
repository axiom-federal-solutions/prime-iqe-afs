@echo off
echo ============================================
echo  PRIME — Fix Push (agents + workflows)
echo ============================================
echo.

:: Create a temp folder outside of OneDrive
mkdir C:\Temp\prime-fix 2>nul
cd /d C:\Temp\prime-fix

echo Step 1: Cloning your repo into C:\Temp\prime-fix...
git clone https://github.com/axiom-federal-solutions/prime-system.git .

if %ERRORLEVEL% NEQ 0 (
  echo ERROR: Clone failed. Make sure you are signed into GitHub in your browser.
  pause
  exit /b 1
)

echo.
echo Step 2: Setting identity...
git config user.email "PrimeOpps1@gmail.com"
git config user.name "Axiom Federal Solutions"

echo.
echo Step 3: Creating folders...
mkdir agents 2>nul
mkdir .github\workflows 2>nul

echo.
echo Step 4: Writing agent files and workflows...
echo (This will take a moment)

:: ---- Write all agent and workflow files ----
:: The PowerShell command below writes each file from embedded content

powershell -Command "
$agents = @{
  'agents\scout.js' = @'
// scout.js - GitHub Actions entry point
const SAM_API = ''https://api.sam.gov/opportunities/v2/search'';
const NAICS_CODES = [''236220'',''238210'',''237990'',''236116'',''561730'',''424710'',''424130'',''424490'',''424120''];
const { supabase, logAction } = require(''../lib/supabase'');
let inserted = 0;

async function runScout() {
  console.log(''SCOUT: Starting scan at '' + new Date().toISOString());
  try {
    await scanSAM();
    await logAction(''SCOUT'', ''SAM scan complete'', { count: inserted });
    console.log(''SCOUT: Done. Found '' + inserted + '' new opportunities.'');
  } catch (err) {
    console.error(''SCOUT ERROR:'', err.message);
    await logAction(''SCOUT'', ''SAM scan failed'', { error: err.message });
    process.exit(1);
  }
}

async function scanSAM() {
  for (const naics of NAICS_CODES) {
    const params = new URLSearchParams({
      api_key: process.env.SAM_API_KEY,
      naicsCode: naics,
      postedFrom: getYesterdayISO(),
      limit: 100,
      offset: 0
    });
    try {
      const res = await fetch(SAM_API + ''?'' + params);
      if (!res.ok) continue;
      const data = await res.json();
      for (const opp of (data.opportunitiesData || [])) {
        await upsertOpportunity(opp);
      }
    } catch (err) {
      console.warn(''SCOUT: Failed NAICS '' + naics, err.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function upsertOpportunity(opp) {
  const record = {
    solicitation_number: opp.solicitationNumber || opp.noticeId,
    title: opp.title || ''Untitled'',
    agency: opp.department || null,
    naics: opp.naicsCode || null,
    set_aside: opp.typeOfSetAsideDescription || null,
    location: opp.placeOfPerformance?.city?.name || null,
    state: opp.placeOfPerformance?.state?.code || null,
    value: parseFloat(opp.baseAndAllOptionsValue) || null,
    posted_date: opp.postedDate ? opp.postedDate.split(''T'')[0] : null,
    deadline: opp.responseDeadLine ? opp.responseDeadLine.split(''T'')[0] : null,
    description_url: opp.uiLink || null,
    source: ''SAM'',
    status: ''new''
  };
  if (!record.solicitation_number) return;
  const { error } = await supabase.from(''opportunities'').upsert(record, { onConflict: ''solicitation_number'' });
  if (!error) inserted++;
}

function getYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split(''T'')[0];
}

runScout();
'@
}

foreach ($file in $agents.Keys) {
  $dir = Split-Path $file
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Set-Content -Path $file -Value $agents[$file] -Encoding UTF8
  Write-Host ('Written: ' + $file)
}
"

echo.
echo Step 5: Copying workflow files from your PRIME Build folder...

:: Copy workflow files from OneDrive PRIME Build folder if they exist
set "SRC=C:\Users\renke\OneDrive\Documents\Claude\Projects\AFS_PRIME\Prime Build\PRIME Build\.github\workflows"
if exist "%SRC%\scout-sam-scan.yml" (
  copy "%SRC%\*.yml" ".github\workflows\" >nul
  echo Workflows copied from OneDrive.
) else (
  echo Writing workflows directly...
  powershell -Command "
    $scout = @'
name: SCOUT - SAM.gov Scan
on:
  schedule:
    - cron: ''0 5,11,17,23 * * *''
  workflow_dispatch:
jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ''20''
          cache: npm
      - run: npm ci
      - name: Run SCOUT
        env:
          SAM_API_KEY: `${{ secrets.SAM_API_KEY }}
          SUPABASE_URL: `${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: `${{ secrets.SUPABASE_SERVICE_KEY }}
          SAM_UEI: `${{ secrets.SAM_UEI }}
        run: node agents/scout.js
      - name: Run JUDGE
        env:
          ANTHROPIC_API_KEY: `${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: `${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: `${{ secrets.SUPABASE_SERVICE_KEY }}
        run: node agents/judge.js
'@
    Set-Content -Path '.github\workflows\scout-sam-scan.yml' -Value $scout -Encoding UTF8
    Write-Host 'Scout workflow written.'
  "
)

echo.
echo Step 6: Committing and pushing...
git add .
git commit -m "Add agents folder and GitHub Actions workflows"
git push origin main

echo.
echo ============================================
if %ERRORLEVEL% == 0 (
  echo  SUCCESS! Agents and workflows are now on GitHub.
  echo  Go to your repo Actions tab to verify.
) else (
  echo  Push failed. See error above.
)
echo ============================================
echo.

:: Clean up temp folder
echo Cleaning up temp files...
cd /d C:\
rmdir /s /q C:\Temp\prime-fix

pause
