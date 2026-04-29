// =============================================================
// EXEC-RETAINAGE.JS — Retainage Recovery Monitor
// JOB: Track retainage held on active projects.
//      Draft release requests when projects are complete.
//      Escalate to URGENT if no release after 30 days.
// SCHEDULE: Monday 6 AM UTC (retainage-monitor.yml)
// LAW: FAR 52.232-5 — Payments on Fixed-Price Construction
//      Retainage typically 5-10% withheld until completion
// COST: ~$0 (no LLM)
// =============================================================

const { supabase, logAction, isAgentEnabled } = require('../lib/supabase');

// Days after requesting release before escalating to URGENT
const FOLLOWUP_DAYS = 30;

// ----------------------------------------------------------
// MAIN: Run weekly retainage monitor
// ----------------------------------------------------------
async function runRetainageMonitor() {
  // T.E.S.T. integration: check if agent is enabled before running
  if (!(await isAgentEnabled('EXEC'))) return;

  console.log('EXEC RETAINAGE: Starting weekly monitor...');

  try {
    const trackers = await getRetainageTrackers();
    console.log('EXEC RETAINAGE: Found ' + trackers.length + ' retainage records.');

    let releasesRequested = 0;
    let escalations = 0;

    for (const tracker of trackers) {
      const result = await processTracker(tracker);
      if (result === 'requested') releasesRequested++;
      if (result === 'escalated') escalations++;
    }

    await logAction('EXEC', 'Retainage monitor complete', {
      trackers_checked: trackers.length,
      releases_requested: releasesRequested,
      escalations: escalations,
    });

    console.log('EXEC RETAINAGE: Done. Releases: ' + releasesRequested + ', Escalations: ' + escalations);

  } catch (err) {
    console.error('EXEC RETAINAGE ERROR:', err.message);
    await logAction('EXEC', 'Retainage monitor failed', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// PROCESS TRACKER: Check status and take action
// ----------------------------------------------------------
async function processTracker(tracker) {
  const today = new Date();

  // If retainage already released — skip
  if (tracker.release_received) {
    return 'done';
  }

  // If release was requested, check if it is overdue for follow-up
  if (tracker.release_requested && tracker.release_request_date) {
    const requestDate = new Date(tracker.release_request_date);
    const daysSinceRequest = Math.floor((today - requestDate) / 86400000);

    if (daysSinceRequest >= FOLLOWUP_DAYS) {
      // Escalate to URGENT — no response after 30 days
      const newCount = (tracker.followup_count || 0) + 1;
      await supabase
        .from('retainage_tracker')
        .update({ followup_count: newCount })
        .eq('id', tracker.id);

      await logAction('EXEC', 'RETAINAGE RELEASE OVERDUE — URGENT', {
        contract_id: tracker.contract_id,
        retainage_held: tracker.retainage_held,
        days_since_request: daysSinceRequest,
        followup_count: newCount,
        action: 'Call Contracting Officer. Reference FAR 52.232-5. Escalate if no response.',
      });
      return 'escalated';
    }
    return 'waiting';
  }

  // Check if contract is complete but no release requested yet
  const contract = await getContract(tracker.contract_id);
  if (contract && contract.status === 'completed' && !tracker.release_requested) {
    // Request release
    const requestDate = today.toISOString().split('T')[0];
    await supabase
      .from('retainage_tracker')
      .update({
        release_requested: true,
        release_request_date: requestDate,
      })
      .eq('id', tracker.id);

    await logAction('EXEC', 'Retainage release requested', {
      contract_id: tracker.contract_id,
      contract_number: contract.contract_number,
      retainage_held: tracker.retainage_held,
      request_date: requestDate,
      action: 'Review retainage release request letter in Brandi brief before sending',
    });
    return 'requested';
  }

  return 'monitoring';
}

// ----------------------------------------------------------
// HELPERS
// ----------------------------------------------------------

async function getRetainageTrackers() {
  const { data, error } = await supabase
    .from('retainage_tracker')
    .select('*')
    .eq('release_received', false);

  if (error) throw new Error('Could not load retainage data: ' + error.message);
  return data || [];
}

async function getContract(contractId) {
  const { data } = await supabase
    .from('active_contracts')
    .select('*')
    .eq('contract_number', contractId)
    .single();
  return data;
}

// Run when file is executed
runRetainageMonitor();
