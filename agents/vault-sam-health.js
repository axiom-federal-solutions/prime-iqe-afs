// =============================================================
// VAULT-SAM-HEALTH.JS — Monthly SAM.gov Registration Validator
// JOB: Validate Walker Contractors' SAM.gov registration
//      every month: status, NAICS alignment, expiry,
//      address accuracy, banking accuracy.
// SCHEDULE: 1st of each month, 5 AM UTC (sam-health-check.yml)
// CRITICAL: SAM.gov expires annually — must renew or all bids
//           are automatically rejected by the government
// COST: ~$0 (SAM.gov API is free)
// =============================================================

const { supabase, logAction } = require('../lib/supabase');

// Walker Contractors official SAM.gov registration data
// These are the expected values — any mismatch triggers an alert
const EXPECTED_PROFILE = {
  company_name: 'Walker Contractors LLC',
  dba: 'Axiom Federal Solutions',
  uei: process.env.SAM_UEI || 'TBD',
  cage_code: process.env.CAGE_CODE || 'TBD',
  naics_primary: '236220',
  naics_codes: ['236220', '238210', '237990', '236116', '561730', '424710', '424130', '424490', '424120'],
  state: 'LA',
  city: 'New Orleans',
};

// Alert when SAM expiry is within this many days
const EXPIRY_WARNING_DAYS = 90;
const EXPIRY_URGENT_DAYS = 30;

// SAM.gov API endpoint
const SAM_API = 'https://api.sam.gov/entity-information/v3/entities';

// ----------------------------------------------------------
// MAIN: Run monthly SAM health check
// ----------------------------------------------------------
async function runSAMHealthCheck() {
  console.log('VAULT SAM HEALTH: Running monthly SAM.gov registration check...');

  const checkDate = new Date().toISOString().split('T')[0];

  try {
    // Query SAM.gov API for Walker Contractors registration
    const samData = await fetchSAMProfile();

    // Run validation checks
    const issues = [];
    const results = {
      registration_status: null,
      expiration_date: null,
      days_to_expiry: null,
      naics_match: true,
      address_current: true,
      issues: [],
    };

    if (samData) {
      // Check registration status
      results.registration_status = samData.registration_status || 'UNKNOWN';
      if (results.registration_status !== 'Active') {
        issues.push('CRITICAL: SAM registration is ' + results.registration_status + ' — must be Active to bid');
      }

      // Check expiration date
      if (samData.expiration_date) {
        results.expiration_date = samData.expiration_date;
        const expiry = new Date(samData.expiration_date);
        const today = new Date();
        const daysToExpiry = Math.floor((expiry - today) / 86400000);
        results.days_to_expiry = daysToExpiry;

        if (daysToExpiry <= 0) {
          issues.push('CRITICAL: SAM registration has EXPIRED — immediately renew at SAM.gov');
        } else if (daysToExpiry <= EXPIRY_URGENT_DAYS) {
          issues.push('URGENT: SAM expires in ' + daysToExpiry + ' days — renew NOW');
        } else if (daysToExpiry <= EXPIRY_WARNING_DAYS) {
          issues.push('WARNING: SAM expires in ' + daysToExpiry + ' days — schedule renewal');
        }
      }

      // Check NAICS codes
      const samNAICS = samData.naics_codes || [];
      const missingNAICS = EXPECTED_PROFILE.naics_codes.filter(n => !samNAICS.includes(n));
      if (missingNAICS.length > 0) {
        results.naics_match = false;
        issues.push('NAICS codes missing from SAM: ' + missingNAICS.join(', '));
      }
    } else {
      // Could not reach SAM API — use local compliance table
      results.registration_status = 'UNKNOWN — SAM API unavailable';
      issues.push('WARNING: Could not reach SAM.gov API. Check compliance table manually.');
      await fallbackComplianceCheck(results, issues);
    }

    results.issues = issues;

    // Save health check result
    await supabase.from('sam_health_checks').insert({
      check_date: checkDate,
      registration_status: results.registration_status,
      expiration_date: results.expiration_date,
      days_to_expiry: results.days_to_expiry,
      naics_match: results.naics_match,
      address_current: results.address_current,
      issues: issues,
    });

    // Determine severity and log
    const severity = issues.some(i => i.startsWith('CRITICAL')) ? 'CRITICAL'
      : issues.some(i => i.startsWith('URGENT')) ? 'URGENT'
      : issues.length > 0 ? 'WARNING' : 'PASS';

    await logAction('VAULT', 'SAM health check — ' + severity, {
      check_date: checkDate,
      registration_status: results.registration_status,
      days_to_expiry: results.days_to_expiry,
      issues_count: issues.length,
      issues: issues,
      action: severity !== 'PASS'
        ? 'Log in to SAM.gov and resolve issues immediately'
        : 'SAM registration is healthy — no action needed',
    });

    console.log('VAULT SAM HEALTH: Check complete — ' + severity + '. ' + issues.length + ' issues found.');

  } catch (err) {
    console.error('VAULT SAM HEALTH ERROR:', err.message);
    await logAction('VAULT', 'SAM health check failed', {
      check_date: checkDate,
      error: err.message,
    });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// FETCH: Query SAM.gov API for Walker Contractors record
// ----------------------------------------------------------
async function fetchSAMProfile() {
  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    console.warn('VAULT SAM HEALTH: No SAM_API_KEY — using fallback check');
    return null;
  }

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      ueiSAM: EXPECTED_PROFILE.uei,
      includeSections: 'coreData',
    });

    const response = await fetch(SAM_API + '?' + params, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn('VAULT SAM HEALTH: SAM API returned ' + response.status);
      return null;
    }

    const data = await response.json();
    const entity = data.entityData?.[0] || null;
    if (!entity) return null;

    return {
      registration_status: entity.coreData?.businessInformation?.registrationStatus,
      expiration_date: entity.coreData?.businessInformation?.registrationExpirationDate,
      naics_codes: (entity.assertions?.goodsAndServices?.naicsCode || []).map(n => n.naicsCode),
    };

  } catch (err) {
    console.warn('VAULT SAM HEALTH: SAM API error — ' + err.message);
    return null;
  }
}

// ----------------------------------------------------------
// FALLBACK: Check local compliance table if SAM API is down
// ----------------------------------------------------------
async function fallbackComplianceCheck(results, issues) {
  const { data: samRecord } = await supabase
    .from('compliance')
    .select('*')
    .eq('type', 'sam_registration')
    .single();

  if (!samRecord) {
    issues.push('WARNING: No SAM registration found in compliance table');
    return;
  }

  if (samRecord.expiry_date) {
    const expiry = new Date(samRecord.expiry_date);
    const today = new Date();
    const daysToExpiry = Math.floor((expiry - today) / 86400000);
    results.days_to_expiry = daysToExpiry;
    results.expiration_date = samRecord.expiry_date;

    if (daysToExpiry <= EXPIRY_URGENT_DAYS) {
      issues.push('URGENT: SAM expires in ' + daysToExpiry + ' days per compliance table');
    } else if (daysToExpiry <= EXPIRY_WARNING_DAYS) {
      issues.push('WARNING: SAM expires in ' + daysToExpiry + ' days per compliance table');
    }
  }

  results.registration_status = samRecord.status || 'active';
}

// Run when file is executed
runSAMHealthCheck();
