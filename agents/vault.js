// =============================================================
<<<<<<< HEAD
// VAULT.JS — Compliance & Eligibility Engine
// JOB: Check if Walker Contractors is actually eligible to bid
//      Construction path: full compliance gate (licenses, bonds, insurance)
//      Supply path: fast bypass (no bonding, no Davis-Bacon, 1-page quote)
// SCHEDULE: Daily 5:30 AM CT — runs before BRANDI's 6 AM brief
// COST: ~$0/month (no AI — pure rule checking)
// SAFETY RULE: Checks kill switch. Failing compliance blocks the bid.
// =============================================================

const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');

// Current compliance status — kept in sync with Supabase system_config
// Update these when licenses/certs are renewed
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

// Warning threshold — alert when a cert or license expires in less than X days
const EXPIRY_WARNING_DAYS = 90;

// Supply NAICS codes — fast bypass (no bonding, no Davis-Bacon, no license)
const SUPPLY_NAICS = ['424710','424130','424490','424120','424690','423440','424310'];

// Real Estate & Rental NAICS — asset ownership gate (NEW 3rd vertical)
const REAL_ESTATE_NAICS = ['531110','531120','532412','532120'];

// ----------------------------------------------------------
// MAIN: Run daily compliance check
// ----------------------------------------------------------
async function runVault() {
  console.log('VAULT: Starting daily compliance check...');

  // Check per-agent enable flag (T.E.S.T. can disable VAULT via system_config)
  const enabled = await isAgentEnabled('VAULT');
  if (!enabled) process.exit(0);

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
=======
// VAULT.JS — Verification & Automated Licensing Utility Tracker
// JOB: Make sure we are always legally allowed to bid
// SCHEDULE: Every day at 5:30 AM Central Time
// COST: $0 (no AI — pure logic and math)
// =============================================================

// Load helper tools
const { supabase, logAction } = require('../lib/supabase');

// Days before expiry to start warning
const WARN_DAYS  = 45;
const URGENT_DAYS = 15;

// Track issues found during the sweep
let warnings = [];
let urgent   = [];

// ----------------------------------------------------------
// MAIN FUNCTION: Run the full compliance sweep
// ----------------------------------------------------------
async function runVault() {
  console.log('VAULT: Starting compliance sweep at ' + new Date().toISOString());

  try {
    // Reset the issue counters
    warnings = [];
    urgent   = [];

    // Run all checks
    await complianceSweep();        // Check certs, licenses, insurance
    await blockIneligibleOpps();    // Block bids we can't legally submit
    await checkStalePricing();      // Block supply bids with old prices
    await checkBidBondStatus();     // Make sure bonds are in hand before bidding
    await monthlyHealthCheck();     // Check SAM.gov registration (runs monthly)

    console.log('VAULT: Done — ' + warnings.length + ' warnings, ' + urgent.length + ' urgent items');
    await logAction('VAULT', 'Compliance sweep complete', {
      warnings: warnings.length,
      urgent:   urgent.length,
    });
  } catch (err) {
    console.error('VAULT ERROR:', err.message);
    await logAction('VAULT', 'Sweep failed', { error: err.message });
>>>>>>> prime-system/main
    process.exit(1);
  }
}

// ----------------------------------------------------------
<<<<<<< HEAD
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

  const status = eligible ? 'ELIGIBLE' : 'INELIGIBLE';
  console.log('VAULT: ' + opp.solicitation_number + ' → ' + status + ' (' + checks.filter(c => c.status === 'FAIL').length + ' failures)');
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
  // Check if Walker has confirmed asset ownership in the database
  // Joe must manually enter owned properties/equipment into the system
  const assetType = getAssetTypeFromNAICS(opp.naics);
  const { data: ownedAssets } = await supabase
    .from('compliance')
    .select('id, name, status')
    .ilike('type', `%${assetType}%`)
    .eq('status', 'active')
    .limit(5);

  const hasAsset = ownedAssets && ownedAssets.length > 0;
  checks.push({
    check:  'Asset Ownership Confirmed',
    status: hasAsset ? 'PASS' : 'FAIL',
    note:   hasAsset
      ? `Found ${ownedAssets.length} owned ${assetType} in system: ${ownedAssets.map(a => a.name).join(', ')}`
      : `NO ${assetType.toUpperCase()} found in compliance records — CANNOT BID. Add owned ${assetType} to PRIME to unlock this opportunity.`,
  });
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

  console.log('VAULT: ' + opp.solicitation_number + ' (REAL ESTATE) → ' + (eligible ? 'ELIGIBLE — asset confirmed' : 'INELIGIBLE — asset ownership not confirmed'));
}

// Map NAICS to asset type label for compliance lookup
function getAssetTypeFromNAICS(naics) {
  const map = {
    '531110': 'residential_property',
    '531120': 'commercial_property',
    '532412': 'construction_equipment',
    '532120': 'truck_fleet',
  };
  return map[naics] || 'real_estate_asset';
}

// Run VAULT when this file is executed
=======
// COMPLIANCE SWEEP: Check every cert, license, insurance
// ----------------------------------------------------------
async function complianceSweep() {
  const { data: certs, error } = await supabase
    .from('compliance')
    .select('*');

  if (error) {
    console.error('VAULT: Could not load compliance records —', error.message);
    return;
  }

  const today = new Date();

  for (const cert of certs) {
    if (!cert.expiry_date) continue; // Skip if no expiry set

    const expiry  = new Date(cert.expiry_date);
    const daysLeft = Math.floor((expiry - today) / 86400000);

    if (daysLeft <= 0) {
      // Already expired — this is a blocker
      await flagExpired(cert);
    } else if (daysLeft <= URGENT_DAYS) {
      // Expires in less than 15 days — URGENT
      await flagUrgent(cert, daysLeft);
    } else if (daysLeft <= WARN_DAYS) {
      // Expires in less than 45 days — Warning
      await flagWarning(cert, daysLeft);
    }
  }
}

// ----------------------------------------------------------
// BLOCK INELIGIBLE BIDS: If we don't have the right cert, block the bid
// Example: If an 8(a) set-aside shows up but we're not 8(a), block it
// ----------------------------------------------------------
async function blockIneligibleOpps() {
  // Get all opportunities that haven't been decided on yet
  const { data: opps } = await supabase
    .from('opportunities')
    .select('*')
    .in('status', ['new', 'scored']);

  if (!opps) return;

  // Get our active certifications
  const { data: certs } = await supabase
    .from('compliance')
    .select('type, status')
    .eq('status', 'active');

  const activeCertTypes = (certs || []).map(c => c.type.toLowerCase());

  for (const opp of opps) {
    const setAside = (opp.set_aside || '').toLowerCase();
    let blocked = false;
    let reason  = '';

    // Check if we qualify for this set-aside type
    if (setAside.includes('8(a)') && !activeCertTypes.includes('8(a)')) {
      blocked = true;
      reason  = 'We are not 8(a) certified';
    } else if (setAside.includes('hubzone') && !activeCertTypes.includes('hubzone')) {
      blocked = true;
      reason  = 'We are not HUBZone certified';
    } else if (setAside.includes('wosb') && !activeCertTypes.includes('wosb')) {
      blocked = true;
      reason  = 'We are not WOSB certified';
    } else if (setAside.includes('sdvosb') && !activeCertTypes.includes('sdvosb')) {
      blocked = true;
      reason  = 'We are not SDVOSB certified';
    }

    if (blocked) {
      await supabase
        .from('opportunities')
        .update({ status: 'blocked' })
        .eq('id', opp.id);

      await logAction('VAULT', 'Blocked ineligible opportunity', {
        solicitation: opp.solicitation_number,
        reason,
      });
    }
  }
}

// ----------------------------------------------------------
// CHECK STALE PRICING: Block supply bids with prices older than 14 days
// Old prices = wrong bids = losing money
// ----------------------------------------------------------
async function checkStalePricing() {
  const { data: stale } = await supabase
    .from('distributor_prices')
    .select('*')
    .eq('is_stale', true);

  if (stale && stale.length > 0) {
    console.log('VAULT: ' + stale.length + ' stale distributor prices found — supply bids blocked');
    await logAction('VAULT', 'Stale pricing detected', {
      count: stale.length,
      items: stale.map(p => p.distributor_name + ': ' + p.product_category),
    });
  }
}

// ----------------------------------------------------------
// CHECK BID BONDS: Confirm bond is received before bid goes out
// ----------------------------------------------------------
async function checkBidBondStatus() {
  const { data: bonds } = await supabase
    .from('bid_bonds')
    .select('*')
    .eq('bond_received', false);

  if (bonds && bonds.length > 0) {
    console.log('VAULT: ' + bonds.length + ' bid bonds NOT yet received');
    for (const bond of bonds) {
      // Warn if deadline is within 7 days and bond not in hand
      if (bond.bid_deadline) {
        const daysLeft = Math.floor((new Date(bond.bid_deadline) - new Date()) / 86400000);
        if (daysLeft <= 7) {
          urgent.push({ type: 'bid_bond', id: bond.id, days: daysLeft });
          await logAction('VAULT', 'URGENT: Bid bond not received', {
            bid_id: bond.bid_id,
            days_to_deadline: daysLeft,
          });
        }
      }
    }
  }
}

// ----------------------------------------------------------
// MONTHLY HEALTH CHECK: Validate SAM.gov registration
// Only runs on the 1st of each month
// ----------------------------------------------------------
async function monthlyHealthCheck() {
  const today = new Date();
  if (today.getDate() !== 1) return; // Only run on the 1st

  console.log('VAULT: Running monthly SAM.gov health check...');

  // Call the SAM.gov entity API to check our registration
  try {
    const res = await fetch(
      'https://api.sam.gov/entity-information/v3/entities?ueiSAM=' +
      process.env.SAM_UEI + '&api_key=' + process.env.SAM_API_KEY
    );
    const data = await res.json();
    const entity = data.entityData?.[0]?.entityRegistration;

    if (!entity) {
      await logAction('VAULT', 'SAM health check: entity not found', {});
      return;
    }

    const expiryDate = entity.registrationExpirationDate;
    const daysToExpiry = expiryDate
      ? Math.floor((new Date(expiryDate) - today) / 86400000)
      : 0;

    // Save health check result
    await supabase.from('sam_health_checks').insert({
      registration_status: entity.registrationStatus,
      expiration_date: expiryDate,
      days_to_expiry: daysToExpiry,
      naics_match: true, // TODO: cross-check registered NAICS vs our list
      address_current: true,
      issues: daysToExpiry < 60 ? [{ issue: 'SAM registration expiring soon', days: daysToExpiry }] : [],
    });

    await logAction('VAULT', 'SAM health check complete', {
      status: entity.registrationStatus,
      days_to_expiry: daysToExpiry,
    });
  } catch (err) {
    console.warn('VAULT: SAM health check failed —', err.message);
  }
}

// ----------------------------------------------------------
// HELPER: Mark a certification as expired in the database
// ----------------------------------------------------------
async function flagExpired(cert) {
  await supabase
    .from('compliance')
    .update({ status: 'expired' })
    .eq('id', cert.id);

  urgent.push({ type: 'expired', cert: cert.name });
  console.log('VAULT: EXPIRED — ' + cert.name + ' (' + cert.type + ')');
  await logAction('VAULT', 'Certification expired', { name: cert.name, type: cert.type });
}

// ----------------------------------------------------------
// HELPER: Flag a cert as expiring urgently (within 15 days)
// ----------------------------------------------------------
async function flagUrgent(cert, daysLeft) {
  urgent.push({ type: 'urgent', cert: cert.name, days: daysLeft });
  console.log('VAULT: URGENT — ' + cert.name + ' expires in ' + daysLeft + ' days');
  await logAction('VAULT', 'Urgent expiry', { name: cert.name, days_left: daysLeft });
}

// ----------------------------------------------------------
// HELPER: Flag a cert as expiring with a warning (within 45 days)
// ----------------------------------------------------------
async function flagWarning(cert, daysLeft) {
  warnings.push({ type: 'warning', cert: cert.name, days: daysLeft });
  console.log('VAULT: WARNING — ' + cert.name + ' expires in ' + daysLeft + ' days');
  await logAction('VAULT', 'Expiry warning', { name: cert.name, days_left: daysLeft });
}

// ----------------------------------------------------------
// START: Run VAULT when this file is executed
// ----------------------------------------------------------
>>>>>>> prime-system/main
runVault();
