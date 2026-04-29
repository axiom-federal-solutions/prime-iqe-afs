// =============================================================
// RECON-CPARS.JS — CPARS Performance Evaluation Monitor
// JOB: Check for new CPARS evaluations on Walker Contractors'
//      active and recent contracts. Draft response templates
//      for below-Satisfactory ratings within 14-day window.
// SCHEDULE: Wednesday 8 AM UTC (cpars-monitor.yml)
// LEGAL: DFARS 242.1502 — CPARS response window is 14 days
// COST: ~$0.50/month (Haiku for response drafting)
// =============================================================

const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// CPARS rating scale: Exceptional, Very Good, Satisfactory, Marginal, Unsatisfactory
const RATINGS_NEEDING_RESPONSE = ['Marginal', 'Unsatisfactory'];

// Days to respond to a CPARS evaluation
const RESPONSE_WINDOW_DAYS = 14;

// Walker Contractors company info for response letters

const COMPANY = {
  name: 'Walker Contractors LLC',
  dba: 'Axiom Federal Solutions',
  contact: 'Joseph Walker IV, Managing Member',
};

// ----------------------------------------------------------
// MAIN: Run CPARS monitor
// ----------------------------------------------------------
async function runCPARSMonitor() {
  console.log('RECON CPARS: Checking for new CPARS evaluations...');

  try {
    // Check existing CPARS records for upcoming response deadlines
    const ratings = await getPendingRatings();
    console.log('RECON CPARS: Found ' + ratings.length + ' evaluations to review.');

    let responseDrafted = 0;
    let deadlineWarnings = 0;

    for (const rating of ratings) {
      const action = await processRating(rating);
      if (action === 'drafted') responseDrafted++;
      if (action === 'deadline_warning') deadlineWarnings++;
    }

    await logAction('RECON', 'CPARS monitor complete', {
      evaluations_checked: ratings.length,
      responses_drafted: responseDrafted,
      deadline_warnings: deadlineWarnings,
    });

    console.log('RECON CPARS: Done. ' + responseDrafted + ' responses drafted.');

  } catch (err) {
    console.error('RECON CPARS ERROR:', err.message);
    await logAction('RECON', 'CPARS monitor failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// GET PENDING: Find evaluations that need attention
// ----------------------------------------------------------
async function getPendingRatings() {
  const { data, error } = await supabase
    .from('cpars_ratings')
    .select('*')
    .eq('response_submitted', false)
    .not('evaluation_date', 'is', null);

  if (error) throw new Error('Could not load CPARS data: ' + error.message);
  return data || [];
}

// ----------------------------------------------------------
// PROCESS: Check each rating and take action
// ----------------------------------------------------------
async function processRating(rating) {
  const today = new Date();
  const evalDate = new Date(rating.evaluation_date);
  const responseDeadline = new Date(evalDate);
  responseDeadline.setDate(evalDate.getDate() + RESPONSE_WINDOW_DAYS);
  const daysToDeadline = Math.floor((responseDeadline - today) / 86400000);

  // Check if this is a rating that needs a response
  const needsResponse = RATINGS_NEEDING_RESPONSE.includes(rating.overall_rating);

  if (needsResponse && !rating.response_doc_url) {
    // Draft a response using Claude Haiku
    return await draftCPARSResponse(rating, daysToDeadline);
  }

  if (daysToDeadline <= 3 && !rating.response_submitted) {
    // Deadline warning — 3 days left to respond
    await logAction('RECON', 'CPARS response deadline approaching', {
      contract_id: rating.contract_id,
      overall_rating: rating.overall_rating,
      days_to_deadline: daysToDeadline,
      action: 'URGENT: Submit CPARS response or accept evaluation',
    });
    return 'deadline_warning';
  }

  return 'monitoring';
}

// ----------------------------------------------------------
// DRAFT: Write a professional CPARS response
// ----------------------------------------------------------
async function draftCPARSResponse(rating, daysToDeadline) {
  console.log('RECON CPARS: Drafting response for contract ' + rating.contract_id +
    ' (' + rating.overall_rating + ' rating)...');

  const response = await claudeHaiku(
    'Draft a professional CPARS contractor response for a below-satisfactory rating. ' +
    'Contractor: ' + COMPANY.name + ' (DBA: ' + COMPANY.dba + '). ' +
    'Contact: ' + COMPANY.contact + '. ' +
    'Rating: ' + rating.overall_rating + '. ' +
    'Quality: ' + rating.quality_rating + '. Schedule: ' + rating.schedule_rating + '. ' +
    'Cost: ' + rating.cost_rating + '. ' +
    'Write a 3-paragraph professional response: ' +
    '(1) Acknowledge the evaluation respectfully, ' +
    '(2) Explain corrective actions already taken or planned, ' +
    '(3) Commit to performance improvement with specific steps. ' +
    'Tone: professional, not defensive. Keep it under 300 words.'
  );

  // Update the CPARS record with the draft response
  await supabase
    .from('cpars_ratings')
    .update({ response_doc_url: 'draft_in_audit_log' })
    .eq('id', rating.id);

  await logAction('RECON', 'CPARS response drafted', {
    contract_id: rating.contract_id,
    overall_rating: rating.overall_rating,
    days_to_deadline: daysToDeadline,
    response_draft: response,
    action: 'Review draft in Brandi brief. Submit within ' + daysToDeadline + ' days.',
  });

  return 'drafted';
}

// Run when file is executed
runCPARSMonitor();
