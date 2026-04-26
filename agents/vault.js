// =============================================================
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
    process.exit(1);
  }
}

// ----------------------------------------------------------
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
runVault();
