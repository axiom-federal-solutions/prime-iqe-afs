// =============================================================
// BRANDI.JS — CEO Agent / Daily Briefing System
// JOB: Send Mr. Kemp a curated morning brief every day at 6 AM CT
//      Construction brief: Mon–Fri 6 AM
//      Supply digest:      Monday 7 AM
//      Critical alerts:    Immediate — any time a STRONG BID drops with <48hr deadline
// SCHEDULE: brandi-daily.yml GitHub Actions workflow
// COST: ~$0.50/month (SendGrid free tier + minimal Claude Haiku usage)
// SAFETY RULE: NEVER auto-bids. Everything requires Mr. Kemp's approval.
//              Checks kill switch before every send.
// =============================================================

const { supabase, logAction, isAgentEnabled, getConfig } = require('../lib/supabase');
const { sendBrief, wrapEmail } = require('../lib/sendgrid');
const { getMonthlySpend } = require('../lib/cost-guard');

// Mr. Kemp's email — the ONLY person who gets these briefs
const RECIPIENT = 'PrimeOpps1@gmail.com';

// Score colors for email — matching the PRIME dashboard palette
const SCORE_COLOR = s =>
  s >= 85 ? '#34D399' :  // Green — STRONG BID
  s >= 70 ? '#E9C46A' :  // Gold  — BID
  s >= 55 ? '#F59E0B' :  // Amber — CONDITIONAL
            '#F87171';   // Red   — NO BID

const SCORE_LABEL = s =>
  s >= 85 ? 'STRONG BID' :
  s >= 70 ? 'BID' :
  s >= 55 ? 'CONDITIONAL' :
            'NO BID';

// ----------------------------------------------------------
// MAIN: Determine which brief to send based on the mode argument
// Usage:
//   node agents/brandi.js daily     → Daily construction brief (6 AM Mon–Fri)
//   node agents/brandi.js supply    → Monday supply digest (7 AM Mondays)
//   node agents/brandi.js alert     → Immediate STRONG BID critical alert
// ----------------------------------------------------------
async function runBrandi() {
  const mode = process.argv[2] || 'daily';
  console.log('BRANDI: Starting in mode "' + mode + '"...');

  // Check per-agent enable flag (T.E.S.T. can disable BRANDI via system_config)
  const enabled = await isAgentEnabled('BRANDI');
  if (!enabled) process.exit(0);

  try {
    if (mode === 'daily')  await sendDailyBrief();
    if (mode === 'supply') await sendSupplyDigest();
    if (mode === 'alert')  await sendCriticalAlerts();

    console.log('BRANDI: Brief sent successfully.');

  } catch (err) {
    console.error('BRANDI ERROR:', err.message);
    await logAction('BRANDI', 'Brief send failed', { mode, error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// DAILY BRIEF: Construction opportunities + system status
// Sent every weekday at 6 AM CT
// ----------------------------------------------------------
async function sendDailyBrief() {
  const today     = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const ctTime    = new Date().toLocaleTimeString('en-US', { timeZone:'America/Chicago', hour:'numeric', minute:'2-digit', hour12:true });

  // Pull today's top construction opportunities
  const topOpps   = await getTopOpportunities('construction', 5);

  // Pull opportunities with deadlines in the next 48 hours — urgent
  const urgent    = await getUrgentOpportunities(48);

  // Pull any bids waiting for Mr. Kemp's approval
  const pending   = await getPendingApprovals();

  // System health — compliance issues, expiry alerts
  const vaultIssues = await getVaultIssues();

  // Monthly AI spend
  const costData  = await getMonthlySpend();

  // Build the email HTML
  const body = buildDailyBriefBody({ topOpps, urgent, pending, vaultIssues, costData, today, ctTime });

  const subject = buildDailySubject(topOpps, urgent, pending);

  const sent = await sendBrief(subject, wrapEmail('PRIME · Daily Brief — ' + today, body));

  await logAction('BRANDI', 'Daily brief sent', {
    recipient:   RECIPIENT,
    subject,
    top_opps:    topOpps.length,
    urgent:      urgent.length,
    pending_approvals: pending.length,
  });
}

// ----------------------------------------------------------
// SUPPLY DIGEST: Monday 7 AM — weekly supply opportunities review
// Kept separate so construction and supply briefs don't compete
// ----------------------------------------------------------
async function sendSupplyDigest() {
  const today   = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

  // Top supply opportunities by ACQ score
  const supplyOpps = await getTopOpportunities('supply', 8);

  // Pending supply quotes waiting for approval
  const supplyPending = await getPendingApprovals('supply');

  const body = buildSupplyDigestBody({ supplyOpps, supplyPending, today });

  const subject = '📦 PRIME Supply Digest — ' + today + ' · ' + supplyOpps.length + ' opportunities';

  const sent = await sendBrief(subject, wrapEmail('PRIME · Supply Digest — ' + today, body));

  await logAction('BRANDI', 'Supply digest sent', {
    recipient:   RECIPIENT,
    subject,
    supply_opps: supplyOpps.length,
  });
}

// ----------------------------------------------------------
// CRITICAL ALERT: Immediate email when a STRONG BID has <48hr deadline
// This fires any time of day — doesn't wait for the morning brief
// ----------------------------------------------------------
async function sendCriticalAlerts() {
  // Find all unsent critical alerts
  const { data: criticalOpps } = await supabase
    .from('opportunities')
    .select('*')
    .eq('alert_level', 'CRITICAL')
    .eq('alert_sent', false)
    .gte('prime_score', 85)
    .limit(5);

  if (!criticalOpps || criticalOpps.length === 0) {
    console.log('BRANDI: No critical alerts to send.');
    return;
  }

  for (const opp of criticalOpps) {
    const deadline = opp.deadline ? new Date(opp.deadline) : null;
    const hoursLeft = deadline ? Math.ceil((deadline - Date.now()) / (1000 * 60 * 60)) : null;

    const subject  = '🚨 PRIME ALERT — STRONG BID · ' + opp.title.substring(0, 60) + ' · Score: ' + opp.prime_score;
    const body     = buildCriticalAlertBody(opp, hoursLeft);

    await sendBrief(subject, wrapEmail('🚨 Critical Bid Alert', body));

    // Mark alert as sent
    await supabase
      .from('opportunities')
      .update({ alert_sent: true, alert_sent_at: new Date().toISOString() })
      .eq('id', opp.id);

    await logAction('BRANDI', 'Critical alert sent', {
      solicitation: opp.solicitation_number,
      score:        opp.prime_score,
      hours_left:   hoursLeft,
    });
  }
}

// ----------------------------------------------------------
// DATA FETCHERS
// ----------------------------------------------------------

async function getTopOpportunities(type, limit) {
  const { data } = await supabase
    .from('opportunities')
    .select('*')
    .eq('type', type)
    .in('status', ['scored', 'new'])
    .gte('prime_score', 55)  // Only show opportunities worth considering
    .order('prime_score', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getUrgentOpportunities(hoursThreshold) {
  const cutoff = new Date(Date.now() + hoursThreshold * 60 * 60 * 1000).toISOString().split('T')[0];
  const today  = new Date().toISOString().split('T')[0];

  const { data } = await supabase
    .from('opportunities')
    .select('*')
    .gte('deadline', today)
    .lte('deadline', cutoff)
    .gte('prime_score', 55)
    .order('deadline', { ascending: true })
    .limit(10);
  return data || [];
}

async function getPendingApprovals(type) {
  let query = supabase
    .from('bids')
    .select('*, opportunities(*)')
    .in('status', ['draft_ready', 'supply_quote_ready', 'pending_review'])
    .order('created_at', { ascending: false })
    .limit(10);

  const { data } = await query;
  if (!data) return [];

  if (type === 'supply') return data.filter(b => b.opportunities && ['424710','424130','424490','424120','424410'].includes(b.opportunities.naics));
  if (type === 'construction') return data.filter(b => b.opportunities && !['424710','424130','424490','424120','424410'].includes(b.opportunities.naics));
  return data;
}

async function getVaultIssues() {
  const { data } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', 'VAULT_SYSTEM_ISSUES')
    .single();
  try { return JSON.parse(data?.value || '[]'); } catch { return []; }
}

// ----------------------------------------------------------
// EMAIL BODY BUILDERS
// ----------------------------------------------------------

function buildDailySubject(topOpps, urgent, pending) {
  const parts = [];
  if (urgent.length > 0)  parts.push('⚡ ' + urgent.length + ' URGENT');
  if (topOpps.length > 0) parts.push(topOpps.length + ' opportunities');
  if (pending.length > 0) parts.push(pending.length + ' awaiting approval');
  const today = new Date().toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
  return 'PRIME Morning Brief — ' + today + (parts.length ? ' · ' + parts.join(' · ') : '');
}

function buildDailyBriefBody({ topOpps, urgent, pending, vaultIssues, costData, today, ctTime }) {
  let html = '';

  // --- Urgent Section ---
  if (urgent.length > 0) {
    html += `
    <div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#F87171;margin-bottom:10px;">⚡ DEADLINE WITHIN 48 HOURS</div>
      ${urgent.map(o => oppRow(o, true)).join('')}
    </div>`;
  }

  // --- Top Opportunities Section ---
  if (topOpps.length > 0) {
    html += `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#8B95AB;margin-bottom:12px;">TODAY'S TOP CONSTRUCTION OPPORTUNITIES</div>
      ${topOpps.map(o => oppRow(o, false)).join('')}
    </div>`;
  } else {
    html += `<p style="color:#8B95AB;font-size:14px;">No new scorable opportunities found since last scan. SCOUT runs 4x daily — check back at 12 PM CT.</p>`;
  }

  // --- Pending Approvals Section ---
  if (pending.length > 0) {
    html += `
    <div style="background:rgba(233,196,106,0.06);border:1px solid rgba(233,196,106,0.2);border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#E9C46A;margin-bottom:10px;">AWAITING YOUR APPROVAL</div>
      ${pending.map(b => pendingRow(b)).join('')}
    </div>`;
  }

  // --- Compliance Alerts ---
  if (vaultIssues.length > 0) {
    html += `
    <div style="background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.2);border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#F87171;margin-bottom:10px;">COMPLIANCE ALERTS</div>
      ${vaultIssues.map(issue => `<div style="font-size:13px;color:#EDF0F7;padding:4px 0;">${issue}</div>`).join('')}
    </div>`;
  }

  // --- System Cost Footer ---
  html += `
  <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;font-size:11px;color:#4D5669;">
    Monthly AI spend: $${(costData.total_usd || 0).toFixed(2)} / $${costData.monthly_cap || 10} cap (${costData.pct_used || '0%'}) ·
    SCOUT: 4x daily · JUDGE: after each scan · VAULT: 5:30 AM · BRANDI: 6:00 AM
  </div>`;

  return html;
}

function buildSupplyDigestBody({ supplyOpps, supplyPending, today }) {
  let html = `<div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#8B95AB;margin-bottom:12px;">SUPPLY OPPORTUNITIES — DROP-SHIP MODEL</div>`;

  if (supplyOpps.length === 0) {
    html += `<p style="color:#8B95AB;">No new supply opportunities this week. SCOUT scans SAM.gov 4x daily.</p>`;
  } else {
    html += supplyOpps.map(o => oppRow(o, false)).join('');
  }

  if (supplyPending.length > 0) {
    html += `<div style="margin-top:20px;font-size:12px;font-weight:700;letter-spacing:2px;color:#E9C46A;">SUPPLY QUOTES AWAITING APPROVAL</div>`;
    html += supplyPending.map(b => pendingRow(b)).join('');
  }

  return html;
}

function buildCriticalAlertBody(opp, hoursLeft) {
  const score    = opp.prime_score || 0;
  const deadline = opp.deadline || 'Unknown';
  const value    = opp.value ? '$' + (opp.value / 1000).toFixed(0) + 'K' : 'TBD';

  return `
  <div style="background:rgba(248,113,113,0.08);border:2px solid rgba(248,113,113,0.4);border-radius:8px;padding:20px;margin-bottom:20px;">
    <div style="font-size:14px;font-weight:700;color:#F87171;margin-bottom:8px;">🚨 HIGH-PRIORITY BID OPPORTUNITY</div>
    <div style="font-size:18px;font-weight:700;color:#EDF0F7;margin-bottom:12px;">${opp.title}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      <div><span style="color:#8B95AB;font-size:11px;">AGENCY</span><br><span style="color:#EDF0F7;">${opp.agency || 'Unknown'}</span></div>
      <div><span style="color:#8B95AB;font-size:11px;">VALUE</span><br><span style="color:#EDF0F7;">${value}</span></div>
      <div><span style="color:#8B95AB;font-size:11px;">DEADLINE</span><br><span style="color:#F87171;font-weight:700;">${deadline}${hoursLeft ? ' (' + hoursLeft + ' hrs)' : ''}</span></div>
      <div><span style="color:#8B95AB;font-size:11px;">SCORE</span><br><span style="color:${SCORE_COLOR(score)};font-weight:700;">${score} — ${SCORE_LABEL(score)}</span></div>
    </div>
    <div style="font-size:13px;color:#8B95AB;">${opp.reasoning || 'Review opportunity in the PRIME dashboard for full analysis.'}</div>
  </div>
  <p style="color:#8B95AB;font-size:13px;">Log into the PRIME dashboard to approve or reject this bid. DRAFT agent will generate the proposal upon approval.</p>`;
}

// ----------------------------------------------------------
// ROW BUILDERS — Reusable HTML components for email tables
// ----------------------------------------------------------

function oppRow(opp, isUrgent) {
  const score    = opp.prime_score || 0;
  const value    = opp.value ? '$' + (opp.value >= 1000000 ? (opp.value/1000000).toFixed(1)+'M' : (opp.value/1000).toFixed(0)+'K') : 'TBD';
  const deadline = opp.deadline || '—';
  const agency   = (opp.agency || '').split(' ').slice(0, 4).join(' ');

  return `
  <div style="border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:12px;margin-bottom:8px;background:rgba(15,20,36,0.8);">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
      <div style="font-size:13px;font-weight:600;color:#EDF0F7;flex:1;margin-right:12px;">${opp.title || 'Federal Opportunity'}</div>
      <div style="font-size:16px;font-weight:700;color:${SCORE_COLOR(score)};white-space:nowrap;">${score}</div>
    </div>
    <div style="font-size:11px;color:#8B95AB;">${agency} · ${value} · Deadline: ${deadline} · ${opp.naics || ''} · ${opp.set_aside || 'Full & Open'}</div>
    <div style="font-size:10px;color:${SCORE_COLOR(score)};margin-top:4px;font-weight:600;">${SCORE_LABEL(score)}</div>
  </div>`;
}

function pendingRow(bid) {
  const opp   = bid.opportunities || {};
  const score = bid.prime_score || opp.prime_score || 0;
  return `
  <div style="border:1px solid rgba(233,196,106,0.2);border-radius:6px;padding:12px;margin-bottom:8px;">
    <div style="font-size:13px;font-weight:600;color:#EDF0F7;margin-bottom:4px;">${opp.title || 'Federal Bid'}</div>
    <div style="font-size:11px;color:#8B95AB;">${opp.agency || ''} · Score: <span style="color:${SCORE_COLOR(score)}">${score}</span> · Status: ${bid.status}</div>
    <div style="font-size:11px;color:#E9C46A;margin-top:4px;">→ Review in PRIME dashboard to approve or reject</div>
  </div>`;
}

// ----------------------------------------------------------
// GET SUPPLIER ALERTS: Pull new supplier matches for morning brief
// Shows Joe which opportunities now have qualified subs/teaming partners
// ----------------------------------------------------------
async function getSupplierAlerts() {
  try {
    const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    const { data: matches } = await supabase
      .from('supplier_matches')
      .select('*, opportunities(title, solicitation_number, agency), suppliers(name, state, certifications)')
      .gte('created_at', since)
      .gte('match_score', 60)
      .order('match_score', { ascending: false })
      .limit(5);

    if (!matches || matches.length === 0) return '';

    let section = '\n📋 SUPPLIER MATCHES (New Today):\n';
    for (const m of matches) {
      const opp      = m.opportunities;
      const supplier = m.suppliers;
      const certs    = (supplier?.certifications || []).join(', ') || 'No certs';
      section += `• ${supplier?.name || 'Unknown'} (${supplier?.state || '?'}) — Score: ${m.match_score}/100 · ${m.match_type} · ${certs}\n`;
      section += `  → ${opp?.title || 'Unknown Opportunity'} (${opp?.solicitation_number || 'N/A'})\n`;
    }

    return section;
  } catch (err) {
    console.warn('BRANDI: getSupplierAlerts failed —', err.message);
    return '';
  }
}

// ----------------------------------------------------------
// GET TEST HEALTH SECTION: Pull T.E.S.T. results for morning brief
// Imports from test.js — keeps Brandi informed of system health
// ----------------------------------------------------------
async function getTestHealthSection() {
  try {
    const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { data: results } = await supabase
      .from('test_results')
      .select('test_name, passed, tier, action_taken, category')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (!results || results.length === 0) {
      return '\n🔵 SYSTEM HEALTH: No T.E.S.T. results from last 24h.\n';
    }

    const total    = results.length;
    const passed   = results.filter(r => r.passed).length;
    const halts    = results.filter(r => r.action_taken === 'HALT');
    const alerts   = results.filter(r => r.action_taken === 'ALERT');

    let section = '\n';
    if (halts.length > 0) {
      section += `🔴 SYSTEM HEALTH — T.E.S.T. HALT: ${halts.length} critical failure(s). Agents may be disabled:\n`;
      halts.forEach(h => { section += `   • ${h.test_name}\n`; });
      section += '   → Log in to PRIME dashboard → System tab to re-enable after fixing root cause.\n';
    } else if (alerts.length > 0) {
      section += `🟡 SYSTEM HEALTH — T.E.S.T. ALERT: ${alerts.length} test(s) failing consistently:\n`;
      alerts.forEach(a => { section += `   • ${a.test_name}\n`; });
    } else {
      section += `🟢 SYSTEM HEALTH: All ${total} T.E.S.T. checks passed (${passed}/${total}).\n`;
    }

    return section;
  } catch (err) {
    return '\n⚠️ SYSTEM HEALTH: Could not load T.E.S.T. results.\n';
  }
}

// Run BRANDI when this file is executed
runBrandi();
