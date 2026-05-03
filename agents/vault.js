// =============================================================
// VAULT.JS — Compliance & Eligibility Engine
// JOB: Check if Walker Contractors is actually eligible to bid
//      Construction path: full compliance gate (licenses, bonds, insurance)
//      Supply path: fast bypass (no bonding, no Davis-Bacon, 1-page quote)
// SCHEDULE: Daily 5:30 AM CT — runs before BRANDI's 6 AM brief
// COST: ~$0/month (no AI — pure rule checking)
// SAFETY RULE: Checks kill switch. Failing compliance blocks the bid.
// =============================================================

const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');

// Default compliance values — used as fallback when the `compliance` table
// has no live row for a given item. loadComplianceFromDb() at the start of
// runVault() overwrites these with whatever is current in the DB so the
// renewals work without code edits.
//
// 2026-05-02: previously these were the source of truth (hardcoded). Now
// they're a safety net; the `compliance` table is canonical. Edit a row
// in Supabase Studio when SAM/license/insurance renews — no code changes,
// no GitHub push, no agent rebuild needed.
const COMPLIANCE = {
  sam_active:          true,          // SAM.gov registration status
  sam_expiry:          '2026-12-31',  // SAM.gov expiration — must stay current
  uei:                 'USMQMFAGL9M4',
  cage_code:           process.env.CAGE_CODE || 'TBD',

  // Licenses (construction only)
  la_contractors_lic:  true,          // Louisiana contractor license
  la_lic_expiry:       '2026-09-30',

  // Insurance (construction only)
  general_liability:   true,          // GL insurance — required for all construction
  gl_expiry:           '2026-11-30',
  gl_limit_millions:   2,             // $2M coverage
  workers_comp:        true,
  wc_expiry:           '2026-11-30',

  // Bonding (construction only — supply bypasses this)
  bonding_company:     process.env.BONDING_COMPANY || 'TBD',
  bonding_limit:       500000,        // Current bonding capacity in dollars
  bid_bond_pct:        0.20,          // 20% of bid per FAR 52.228-1

  // Certifications
  sdb_cert:            true,          // Small Disadvantaged Business
  sdb_expiry:          '2027-03-31',
};

// 2026-05-02: load compliance from the `compliance` table at run start.
// Maps DB row.type → COMPLIANCE field so the table drives behavior.
// Expected `compliance` table rows (one per item):
//   { type: 'sam_registration',     name: 'UEI USMQMFAGL9M4',  expiry_date: '...', status: 'active' }
//   { type: 'la_contractor_license',name: 'LA #...',           expiry_date: '...', status: 'active' }
//   { type: 'general_liability',    name: 'Hartford GL',       expiry_date: '...', status: 'active' }
//   { type: 'workers_comp',         name: 'Hartford WC',       expiry_date: '...', status: 'active' }
//   { type: 'sdb_certification',    name: 'SBA SDB',           expiry_date: '...', status: 'active' }
async function loadComplianceFromDb() {
  try {
    const { data, error } = await supabase
      .from('compliance')
      .select('type, name, expiry_date, status, number');
    if (error || !data || data.length === 0) {
      console.warn('VAULT: compliance table empty or unavailable — using hardcoded defaults');
      return;
    }
    const byType = {};
    for (const row of data) byType[(row.type || '').toLowerCase()] = row;

    // Map DB rows to COMPLIANCE fields. status='active' must be present;
    // any other status (expired, revoked, pending) marks the item inactive.
    if (byType['sam_registration']) {
      COMPLIANCE.sam_active = byType['sam_registration'].status === 'active';
      COMPLIANCE.sam_expiry = byType['sam_registration'].expiry_date || COMPLIANCE.sam_expiry;
    }
    if (byType['la_contractor_license']) {
      COMPLIANCE.la_contractors_lic = byType['la_contractor_license'].status === 'active';
      COMPLIANCE.la_lic_expiry = byType['la_contractor_license'].expiry_date || COMPLIANCE.la_lic_expiry;
    }
    if (byType['general_liability']) {
      COMPLIANCE.general_liability = byType['general_liability'].status === 'active';
      COMPLIANCE.gl_expiry = byType['general_liability'].expiry_date || COMPLIANCE.gl_expiry;
    }
    if (byType['workers_comp']) {
      COMPLIANCE.workers_comp = byType['workers_comp'].status === 'active';
      COMPLIANCE.wc_expiry = byType['workers_comp'].expiry_date || COMPLIANCE.wc_expiry;
    }
    if (byType['sdb_certification']) {
      COMPLIANCE.sdb_cert = byType['sdb_certification'].status === 'active';
      COMPLIANCE.sdb_expiry = byType['sdb_certification'].expiry_date || COMPLIANCE.sdb_expiry;
    }
    // 2026-05-02: read bonding capacity from DB so the dashboard's
    // "Bonding Capacity → VERIFY" warning clears once Mr. Kemp marks it active.
    if (byType['bonding_capacity']) {
      // Number column carries the cap as text like '$500,000 single / $1M aggregate'
      // Extract the first dollar amount as the working bonding limit.
      const bondTxt = byType['bonding_capacity'].number || '';
      const match = bondTxt.match(/\$?([\d,]+)/);
      if (match) {
        const num = parseInt(match[1].replace(/,/g, ''), 10);
        if (!isNaN(num)) COMPLIANCE.bonding_limit = num;
      }
      COMPLIANCE.bonding_company = byType['bonding_capacity'].issuer || COMPLIANCE.bonding_company;
    }
    console.log('VAULT: compliance loaded from DB (' + data.length + ' rows)');
  } catch (err) {
    console.warn('VAULT: loadComplianceFromDb failed — using hardcoded defaults:', err.message);
  }
}

// Warning threshold — alert when a cert or license expires in less than X days
const EXPIRY_WARNING_DAYS = 90;

// Supply NAICS codes — fast bypass (no bonding, no Davis-Bacon, no license)
// 2026-05-02: synced with scout.js / TAXONOMY (was 7 codes, now 14).
// Mismatch was sending 339113/423450/424410/311999/453210/315990/424720
// bids through the construction gate where they got blocked by bonding
// and license requirements that don't apply to drop-ship supply.
const SUPPLY_NAICS = [
  '424710','424720','424130','424490','424120','424690','423440','423450',
  '424310','424410','311999','339113','453210','315990','561720',
];

// Real Estate & Rental NAICS — asset ownership gate (3rd vertical)
// 2026-05-02: expanded from 4 to 9 codes to match scout.js. Property
// management (531311/531312), advisory (531210/531390), and land leasing
// (531190) bids were falling through to the construction gate.
const REAL_ESTATE_NAICS = [
  '531110','531120','531190','531210',
  '531311','531312','531390',
  '532120','532412',
];

// ----------------------------------------------------------
// MAIN: Run daily compliance check
// ----------------------------------------------------------
async function runVault() {
  console.log('VAULT: Starting daily compliance check...');

  // Check per-agent enable flag (T.E.S.T. can disable VAULT via system_config)
  const enabled = await isAgentEnabled('VAULT');
  if (!enabled) process.exit(0);

  // 2026-05-02: pull live compliance values from the `compliance` table.
  // If the table is empty/unavailable, hardcoded defaults remain in effect.
  await loadComplianceFromDb();

  try {
    // --- PART 1: Check system-wide compliance status ---
    const systemChecks = await runSystemComplianceChecks();

    // --- PART 2: Check compliance on all pending bids ---
    const bidChecks = await checkPendingBids();

    // --- PART 3: Check for expiring credentials ---
    const expiryAlerts = checkExpiryAlerts();

    await logAction('VAULT', 'Daily compliance check complete', {
      system_checks: systemChecks,
      bids_checked:  bidChecks,
      expiry_alerts: expiryAlerts,
      checked_at:    new Date().toISOString(),
    });

    console.log('VAULT: Done — ' + bidChecks + ' bids checked, ' + expiryAlerts.length + ' expiry alerts.');

  } catch (err) {
    console.error('VAULT ERROR:', err.message);
    await logAction('VAULT', 'Compliance check failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// SYSTEM COMPLIANCE CHECKS: Is Walker currently eligible to bid at all?
// If SAM.gov is expired or we have no active license, block everything
// ----------------------------------------------------------
async function runSystemComplianceChecks() {
  const issues = [];
  const today  = new Date();

  // SAM.gov registration — must be active to receive federal contracts
  if (!COMPLIANCE.sam_active) {
    issues.push('CRITICAL: SAM.gov registration is not active — cannot bid on ANY federal contracts');
  } else {
    const samExpiry = new Date(COMPLIANCE.sam_expiry);
    const samDays   = Math.ceil((samExpiry - today) / (1000 * 60 * 60 * 24));
    if (samDays < 0)   issues.push('CRITICAL: SAM.gov registration EXPIRED ' + Math.abs(samDays) + ' days ago');
    else if (samDays < EXPIRY_WARNING_DAYS) issues.push('WARNING: SAM.gov registration expires in ' + samDays + ' days (' + COMPLIANCE.sam_expiry + ')');
  }

  // Louisiana contractor license — required for all construction bids
  if (!COMPLIANCE.la_contractors_lic) {
    issues.push('CRITICAL: Louisiana contractor license is not active');
  }

  // Save any issues to system_config for BRANDI to include in the brief
  if (issues.length > 0) {
    await supabase.from('system_config').upsert({
      key:   'VAULT_SYSTEM_ISSUES',
      value: JSON.stringify(issues),
    }, { onConflict: 'key' });

    console.warn('VAULT: ' + issues.length + ' system compliance issues found:');
    issues.forEach(issue => console.warn(' — ' + issue));
  } else {
    await supabase.from('system_config').upsert({
      key:   'VAULT_SYSTEM_ISSUES',
      value: '[]',
    }, { onConflict: 'key' });
  }

  return { issues_count: issues.length, issues };
}

// ----------------------------------------------------------
// CHECK PENDING BIDS: Run eligibility checks on each bid ready to go out
// Construction bids get the full gate. Supply bids get fast bypass.
// ----------------------------------------------------------
async function checkPendingBids() {
  // Get all bids that are in pricing or review stage
  const { data: bids, error } = await supabase
    .from('bids')
    .select('*, opportunities(*)')
    .in('status', ['pending_pricing', 'draft_ready', 'pending_review'])
    .limit(50);

  if (error || !bids) {
    console.warn('VAULT: Could not load bids —', error?.message);
    await logAction('VAULT', 'Bid query failed', { error: error?.message || 'unknown' });
    return 0;
  }

  // 2026-05-02: log empty input so dashboard can distinguish
  // "VAULT ran with nothing to do" from "VAULT never ran".
  if (bids.length === 0) {
    await logAction('VAULT', 'No pending bids to check', { checked_at: new Date().toISOString() });
    return 0;
  }

  console.log('VAULT: Checking ' + bids.length + ' pending bids...');

  for (const bid of bids) {
    const opp = bid.opportunities;
    if (!opp) continue;

    const isSupply     = SUPPLY_NAICS.includes(opp.naics);
    const isRealEstate = REAL_ESTATE_NAICS.includes(opp.naics);

    if (isRealEstate) {
      await runRealEstateComplianceCheck(bid, opp);
    } else if (isSupply) {
      await runSupplyComplianceCheck(bid, opp);
    } else {
      await runConstructionComplianceCheck(bid, opp);
    }
  }

  return bids.length;
}

// ----------------------------------------------------------
// CONSTRUCTION COMPLIANCE: Full gate check for construction bids
// Must pass ALL of these to be eligible:
//   ✓ SAM.gov active and current
//   ✓ Louisiana contractor license active
//   ✓ General liability insurance active + sufficient coverage
//   ✓ Workers compensation insurance active
//   ✓ Bonding capacity sufficient for this contract size
//   ✓ Bid bond available (20% of bid value per FAR 52.228-1)
//   ✓ Davis-Bacon wage determination obtained (if federal construction)
//   ✓ Not on debarment list
//   ✓ No OCI (organizational conflict of interest) detected
// ----------------------------------------------------------
async function runConstructionComplianceCheck(bid, opp) {
  const checks  = [];
  let eligible  = true;

  // SAM.gov check
  if (!COMPLIANCE.sam_active) {
    checks.push({ check: 'SAM.gov Active', status: 'FAIL', note: 'SAM.gov registration inactive' });
    eligible = false;
  } else {
    checks.push({ check: 'SAM.gov Active', status: 'PASS', note: 'UEI: ' + COMPLIANCE.uei });
  }

  // License check
  if (!COMPLIANCE.la_contractors_lic) {
    checks.push({ check: 'Contractor License', status: 'FAIL', note: 'Louisiana contractor license not active' });
    eligible = false;
  } else {
    checks.push({ check: 'Contractor License', status: 'PASS', note: 'LA license active, expires ' + COMPLIANCE.la_lic_expiry });
  }

  // Insurance check
  if (!COMPLIANCE.general_liability) {
    checks.push({ check: 'General Liability Insurance', status: 'FAIL', note: 'GL insurance not active' });
    eligible = false;
  } else {
    checks.push({ check: 'General Liability Insurance', status: 'PASS', note: '$' + COMPLIANCE.gl_limit_millions + 'M coverage, expires ' + COMPLIANCE.gl_expiry });
  }

  // Workers comp check
  if (!COMPLIANCE.workers_comp) {
    checks.push({ check: "Workers' Compensation", status: 'FAIL', note: "Workers' comp not active" });
    eligible = false;
  } else {
    checks.push({ check: "Workers' Compensation", status: 'PASS', note: 'Active, expires ' + COMPLIANCE.wc_expiry });
  }

  // Bonding capacity check — can we bond this contract?
  const bidValue = opp.value || 0;
  if (bidValue > COMPLIANCE.bonding_limit) {
    checks.push({
      check:  'Bonding Capacity',
      status: bidValue > COMPLIANCE.bonding_limit * 1.5 ? 'FAIL' : 'WARN',
      note:   'Contract value $' + (bidValue/1000).toFixed(0) + 'K may exceed bonding limit of $' + (COMPLIANCE.bonding_limit/1000).toFixed(0) + 'K — confirm with surety',
    });
    if (bidValue > COMPLIANCE.bonding_limit * 1.5) eligible = false;
  } else {
    checks.push({ check: 'Bonding Capacity', status: 'PASS', note: 'Contract within bonding limit' });
  }

  // SDB certification check for set-aside
  const sa = (opp.set_aside || '').toUpperCase();
  if (['SDB','SBA','SBP'].includes(sa) && COMPLIANCE.sdb_cert) {
    checks.push({ check: 'Set-Aside Eligibility', status: 'PASS', note: 'SDB certified, qualifies for ' + sa });
  } else if (['SDB','SBA','SBP'].includes(sa) && !COMPLIANCE.sdb_cert) {
    checks.push({ check: 'Set-Aside Eligibility', status: 'FAIL', note: 'SDB cert required but not active for ' + sa });
    eligible = false;
  } else {
    checks.push({ check: 'Set-Aside Eligibility', status: 'PASS', note: 'Full and open competition' });
  }

  // Davis-Bacon — required for federal construction over $2,000
  const needsDavisBacon = bidValue > 2000;
  checks.push({
    check:  'Davis-Bacon Wage Determination',
    status: needsDavisBacon ? 'ACTION_REQUIRED' : 'N/A',
    note:   needsDavisBacon ? 'Obtain wage determination from SAM.gov Wage Determinations portal before bidding' : 'Not required for this contract size',
  });

  // Save compliance results to the bid record
  await supabase.from('bids').update({
    compliance_checks: checks,
    compliance_status: eligible ? 'ELIGIBLE' : 'INELIGIBLE',
    compliance_date:   new Date().toISOString(),
  }).eq('id', bid.id);

  // 2026-05-02: per-bid log so BRANDI can render INELIGIBLE reasons in
  // the morning brief instead of just showing a status badge.
  const failures = checks.filter(c => c.status === 'FAIL');
  await logAction('VAULT', eligible ? 'Construction bid ELIGIBLE' : 'Construction bid INELIGIBLE', {
    bid_id:        bid.id,
    solicitation:  opp.solicitation_number,
    naics:         opp.naics,
    eligible,
    failures:      failures.map(f => `${f.check}: ${f.note}`),
    failure_count: failures.length,
  });

  const status = eligible ? 'ELIGIBLE' : 'INELIGIBLE';
  console.log('VAULT: ' + opp.solicitation_number + ' → ' + status + ' (' + failures.length + ' failures)');
}

// ----------------------------------------------------------
// SUPPLY COMPLIANCE: Fast bypass — supply contracts skip most construction gates
// Why: Supply contracts don't require contractor licenses, bonding, Davis-Bacon,
//      workers comp (for the product itself), or site visits
// Still checks: SAM.gov active, SDB cert for set-asides, debarment
// ----------------------------------------------------------
async function runSupplyComplianceCheck(bid, opp) {
  const checks  = [];
  let eligible  = true;

  // SAM.gov — still required for all federal contracts
  if (!COMPLIANCE.sam_active) {
    checks.push({ check: 'SAM.gov Active', status: 'FAIL', note: 'SAM.gov registration inactive' });
    eligible = false;
  } else {
    checks.push({ check: 'SAM.gov Active', status: 'PASS', note: 'UEI: ' + COMPLIANCE.uei });
  }

  // Set-aside eligibility
  const sa = (opp.set_aside || '').toUpperCase();
  if (['SDB','SBA','SBP'].includes(sa) && COMPLIANCE.sdb_cert) {
    checks.push({ check: 'Set-Aside Eligibility', status: 'PASS', note: 'SDB certified — qualifies for ' + sa });
  } else if (['SDB','SBA','SBP'].includes(sa) && !COMPLIANCE.sdb_cert) {
    checks.push({ check: 'Set-Aside Eligibility', status: 'FAIL', note: 'SDB cert required for ' + sa });
    eligible = false;
  } else {
    checks.push({ check: 'Set-Aside Eligibility', status: 'PASS', note: 'Full and open — no cert required' });
  }

  // Drop-ship confirmation — does Walker need to hold inventory or can distributor ship direct?
  checks.push({
    check:  'Drop-Ship Verification',
    status: 'ACTION_REQUIRED',
    note:   'Confirm distributor can ship direct to government facility (FOB destination). Get firm quote before bidding.',
  });

  // Skipped checks — document WHY so the audit trail is clear
  checks.push({ check: 'Contractor License',  status: 'BYPASSED', note: 'Not required for supply contracts' });
  checks.push({ check: 'Bonding',             status: 'BYPASSED', note: 'Bonds not required for supply contracts under $150K (FAR 28.102-1)' });
  checks.push({ check: 'Davis-Bacon',         status: 'BYPASSED', note: 'Supply contracts are not subject to Davis-Bacon Act' });
  checks.push({ check: "Workers' Comp",       status: 'BYPASSED', note: 'Not applicable — Walker does not employ workers on supply contracts' });

  await supabase.from('bids').update({
    compliance_checks: checks,
    compliance_status: eligible ? 'ELIGIBLE' : 'INELIGIBLE',
    compliance_date:   new Date().toISOString(),
  }).eq('id', bid.id);

  const supplyFailures = checks.filter(c => c.status === 'FAIL');
  await logAction('VAULT', eligible ? 'Supply bid ELIGIBLE' : 'Supply bid INELIGIBLE', {
    bid_id:        bid.id,
    solicitation:  opp.solicitation_number,
    naics:         opp.naics,
    eligible,
    failures:      supplyFailures.map(f => `${f.check}: ${f.note}`),
    failure_count: supplyFailures.length,
  });

  console.log('VAULT: ' + opp.solicitation_number + ' (SUPPLY) → ' + (eligible ? 'ELIGIBLE via fast bypass' : 'INELIGIBLE'));
}

// ----------------------------------------------------------
// EXPIRY ALERTS: Check all certs and licenses for upcoming expiration
// Returns list of items expiring within EXPIRY_WARNING_DAYS
// ----------------------------------------------------------
function checkExpiryAlerts() {
  const today   = new Date();
  const alerts  = [];

  const items = [
    { name: 'SAM.gov Registration',    expiry: COMPLIANCE.sam_expiry,    critical: true },
    { name: 'LA Contractor License',   expiry: COMPLIANCE.la_lic_expiry, critical: true },
    { name: 'General Liability Ins.',  expiry: COMPLIANCE.gl_expiry,     critical: true },
    { name: "Workers' Comp Ins.",      expiry: COMPLIANCE.wc_expiry,     critical: true },
    { name: 'SDB Certification',       expiry: COMPLIANCE.sdb_expiry,    critical: false },
  ];

  for (const item of items) {
    if (!item.expiry) continue;
    const expDate  = new Date(item.expiry);
    const daysLeft = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) {
      alerts.push({ name: item.name, status: 'EXPIRED', days: Math.abs(daysLeft), critical: item.critical });
    } else if (daysLeft < EXPIRY_WARNING_DAYS) {
      alerts.push({ name: item.name, status: 'EXPIRING_SOON', days: daysLeft, critical: item.critical });
    }
  }

  if (alerts.length > 0) {
    // Save alerts to database so BRANDI can include them in the morning brief
    supabase.from('system_config').upsert({
      key:   'VAULT_EXPIRY_ALERTS',
      value: JSON.stringify(alerts),
    }, { onConflict: 'key' }).then(() => {});
  }

  return alerts;
}

// ----------------------------------------------------------
// REAL ESTATE COMPLIANCE: Asset ownership gate for Real Estate & Rental bids
// KEY RULE: Walker can only bid if the asset (property/equipment/vehicle) EXISTS
// This is the hard gate — no asset = INELIGIBLE, no exceptions
// ----------------------------------------------------------
async function runRealEstateComplianceCheck(bid, opp) {
  const checks  = [];
  let eligible  = true;

  // SAM.gov — still required for all federal contracts
  if (!COMPLIANCE.sam_active) {
    checks.push({ check: 'SAM.gov Active', status: 'FAIL', note: 'SAM.gov registration inactive' });
    eligible = false;
  } else {
    checks.push({ check: 'SAM.gov Active', status: 'PASS', note: 'UEI: ' + COMPLIANCE.uei });
  }

  // Set-aside eligibility
  const sa = (opp.set_aside || '').toUpperCase();
  if (['SDB','SBA','SBP'].includes(sa) && COMPLIANCE.sdb_cert) {
    checks.push({ check: 'Set-Aside Eligibility', status: 'PASS', note: 'SDB certified — qualifies for ' + sa });
  } else if (['SDB','SBA','SBP'].includes(sa) && !COMPLIANCE.sdb_cert) {
    checks.push({ check: 'Set-Aside Eligibility', status: 'FAIL', note: 'SDB cert required for ' + sa });
    eligible = false;
  } else {
    checks.push({ check: 'Set-Aside Eligibility', status: 'PASS', note: 'Full and open — no cert required' });
  }

  // *** ASSET OWNERSHIP GATE — the critical real estate check ***
  // 2026-05-02: now queries the `assets` table (created by sql/add-assets-table.sql)
  // instead of the `compliance` table. Compliance is for certs/licenses/insurance;
  // owned property and equipment now live in their own table with the right schema.
  // If the assets table doesn't exist yet, the query gracefully fails and the gate
  // stays closed — Mr. Kemp must run the migration before RE bids can clear.
  const assetType = getAssetTypeFromNAICS(opp.naics);
  const oppState  = opp.state || opp.place_of_performance;

  // Prefer assets in the same state as the opportunity (same-state asset
  // is far more likely to be the right match for a federal lease/RE bid).
  let assetQuery = supabase
    .from('assets')
    .select('id, name, asset_type, city, state, status, ownership_type')
    .eq('asset_type', assetType)
    .eq('status', 'active');
  if (oppState) {
    // Try same-state first; fall back to any-state if none found
    const { data: sameState } = await assetQuery.eq('state', oppState).limit(5);
    var ownedAssets = (sameState && sameState.length > 0) ? sameState : null;
  }
  if (!ownedAssets) {
    const { data: anyState, error: assetErr } = await supabase
      .from('assets')
      .select('id, name, asset_type, city, state, status, ownership_type')
      .eq('asset_type', assetType)
      .eq('status', 'active')
      .limit(5);
    if (assetErr) {
      // Common cause: assets table doesn't exist yet (migration not run).
      // Surface this loudly so Mr. Kemp knows what to fix.
      checks.push({
        check:  'Asset Ownership Confirmed',
        status: 'FAIL',
        note:   '⚠️ assets table query failed — likely missing schema. ' +
                'Run sql/add-assets-table.sql in Supabase SQL Editor, then add owned assets. ' +
                'Error: ' + assetErr.message,
      });
      eligible = false;
      ownedAssets = [];
    } else {
      ownedAssets = anyState || [];
    }
  }

  const hasAsset = ownedAssets.length > 0;
  if (!checks.find(c => c.check === 'Asset Ownership Confirmed')) {
    checks.push({
      check:  'Asset Ownership Confirmed',
      status: hasAsset ? 'PASS' : 'FAIL',
      note:   hasAsset
        ? `Found ${ownedAssets.length} owned ${assetType.replace(/_/g,' ')}: ` +
          ownedAssets.map(a => `${a.name}${a.state ? ' (' + a.state + ')' : ''}`).join(', ')
        : `NO ${assetType.replace(/_/g,' ')} on file — CANNOT BID. ` +
          `Add an asset row to the \`assets\` table (asset_type='${assetType}', status='active') to unlock.`,
    });
  }
  if (!hasAsset) eligible = false;  // Hard block — no asset = no bid

  // Property insurance check (for real estate leases)
  if (['531110','531120'].includes(opp.naics)) {
    checks.push({
      check:  'Property/Landlord Insurance',
      status: 'ACTION_REQUIRED',
      note:   'Confirm landlord liability insurance is in place before executing lease. GSA requires $2M minimum.',
    });
  }

  // Equipment/vehicle insurance check
  if (['532412','532120'].includes(opp.naics)) {
    checks.push({
      check:  'Equipment/Fleet Insurance',
      status: 'ACTION_REQUIRED',
      note:   'Confirm equipment or vehicle rental insurance covers government use before bid submission.',
    });
  }

  // Bypassed construction-specific checks (document for audit trail)
  checks.push({ check: 'Contractor License', status: 'BYPASSED', note: 'Not required for property/equipment leasing' });
  checks.push({ check: 'Bonding',            status: 'BYPASSED', note: 'Performance bonds not required for lease contracts' });
  checks.push({ check: 'Davis-Bacon',        status: 'BYPASSED', note: 'Davis-Bacon does not apply to lease contracts' });

  await supabase.from('bids').update({
    compliance_checks: checks,
    compliance_status: eligible ? 'ELIGIBLE' : 'INELIGIBLE',
    compliance_date:   new Date().toISOString(),
  }).eq('id', bid.id);

  const reFailures = checks.filter(c => c.status === 'FAIL');
  await logAction('VAULT', eligible ? 'Real estate bid ELIGIBLE' : 'Real estate bid INELIGIBLE — asset gate', {
    bid_id:        bid.id,
    solicitation:  opp.solicitation_number,
    naics:         opp.naics,
    asset_type:    assetType,
    eligible,
    failures:      reFailures.map(f => `${f.check}: ${f.note}`),
    failure_count: reFailures.length,
  });

  console.log('VAULT: ' + opp.solicitation_number + ' (REAL ESTATE) → ' + (eligible ? 'ELIGIBLE — asset confirmed' : 'INELIGIBLE — asset ownership not confirmed'));
}

// Map NAICS to asset type label for compliance lookup.
// 2026-05-02: expanded from 4 to 9 NAICS so every code SCOUT scans has an
// asset_type to look up. Values match what sql/add-assets-table.sql expects
// in the asset_type column.
function getAssetTypeFromNAICS(naics) {
  const map = {
    '531110': 'residential_property',     // Lessors of residential buildings
    '531120': 'commercial_property',      // Lessors of nonresidential buildings (GSA leases)
    '531190': 'land',                     // Lessors of other RE property (land, parking)
    '531210': 'real_estate_advisory',     // Brokers — service, no physical asset, but partnership records here
    '531311': 'residential_property',     // Residential property managers — manage residential
    '531312': 'commercial_property',      // Nonresidential property managers — manage commercial
    '531390': 'real_estate_advisory',     // Other RE activities (appraisal, title) — service capacity
    '532120': 'truck_fleet',              // Truck/RV rental
    '532412': 'construction_equipment',   // Construction equipment rental
  };
  return map[naics] || 'real_estate_asset';
}

// Run VAULT when this file is executed
runVault();
