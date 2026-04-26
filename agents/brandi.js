// =============================================================
// BRANDI.JS — Briefing & Reporting Automated Notification & Daily Intelligence
// JOB: Send Joe a smart daily email with everything that needs attention
// SCHEDULE: Every day at 6:00 AM Central Time
// COST: $0 (uses SendGrid free tier — 100 emails/day free)
// =============================================================

// Load helper tools
const { supabase, logAction } = require('../lib/supabase');
const { claudeHaiku } = require('../lib/claude');

// Who gets the daily briefing
const RECIPIENT_EMAIL = 'renkemp2@gmail.com';     // Joe's personal email
const SENDER_EMAIL    = 'PrimeOpps1@gmail.com';    // PRIME system email
const SENDER_NAME     = 'PRIME System';

// SendGrid API for sending emails
const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

// ----------------------------------------------------------
// MAIN FUNCTION: Build and send the daily briefing
// ----------------------------------------------------------
async function runBrandi() {
  console.log('BRANDI: Building daily briefing at ' + new Date().toISOString());

  try {
    // Collect data from all agents
    const brief = await compileBriefing();

    // Build the email HTML
    const emailHtml = buildEmailHTML(brief);

    // Send the email
    await sendEmail(
      'PRIME Daily Brief — ' + getFormattedDate(),
      emailHtml
    );

    await logAction('BRANDI', 'Daily brief sent', {
      recipient:       RECIPIENT_EMAIL,
      opportunities:   brief.newOpps.length,
      urgent_items:    brief.urgent.length,
      proposals_ready: brief.proposals.length,
    });

    console.log('BRANDI: Brief sent to ' + RECIPIENT_EMAIL);
  } catch (err) {
    console.error('BRANDI ERROR:', err.message);
    await logAction('BRANDI', 'Brief failed to send', { error: err.message });
    process.exit(1);
  }
}

// ----------------------------------------------------------
// COMPILE BRIEFING: Gather everything that happened overnight
// ----------------------------------------------------------
async function compileBriefing() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1. New high-scoring opportunities (score ≥ 70)
  const { data: newOpps } = await supabase
    .from('opportunities')
    .select('*')
    .gte('prime_score', 70)
    .gte('created_at', yesterday)
    .order('prime_score', { ascending: false });

  // 2. Opportunities awaiting Joe's bid/no-bid decision (48+ hours old)
  const { data: staleDec } = await supabase
    .from('opportunities')
    .select('*')
    .eq('status', 'scored')
    .gt('decision_age_days', 1)
    .order('prime_score', { ascending: false });

  // 3. Proposals ready for Joe's review and approval
  const { data: proposals } = await supabase
    .from('bids')
    .select('*, opportunities(*)')
    .eq('status', 'draft_ready');

  // 4. Urgent compliance items (expiring certs, urgent flags)
  const { data: urgent } = await supabase
    .from('audit_log')
    .select('*')
    .in('action', ['Urgent expiry', 'Certification expired', 'URGENT: Bid bond not received',
                   'Late payment detected', 'Sub payment violation'])
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false });

  // 5. Active contracts summary
  const { data: contracts } = await supabase
    .from('active_contracts')
    .select('*')
    .eq('status', 'active');

  // 6. Debrief deadlines approaching (within 3 days)
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data: debriefs } = await supabase
    .from('debrief_tracker')
    .select('*')
    .eq('debrief_requested', false)
    .lte('debrief_request_deadline', in3Days);

  return {
    newOpps:      newOpps   || [],
    staleDecisions: staleDec || [],
    proposals:    proposals  || [],
    urgent:       urgent     || [],
    contracts:    contracts  || [],
    debriefs:     debriefs   || [],
    date:         getFormattedDate(),
  };
}

// ----------------------------------------------------------
// BUILD EMAIL HTML: Create a clean, readable briefing email
// ----------------------------------------------------------
function buildEmailHTML(brief) {
  const totalActiveValue = brief.contracts.reduce((s, c) => s + (c.value || 0), 0);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body      { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
    .card     { background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header   { background: #1a365d; color: white; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    h1        { margin: 0; font-size: 22px; }
    h2        { color: #1a365d; font-size: 16px; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    .urgent   { background: #fff5f5; border-left: 4px solid #e53e3e; }
    .opp      { background: #f0fff4; border-left: 4px solid #38a169; padding: 10px; margin: 8px 0; border-radius: 4px; }
    .score    { font-weight: bold; color: #2d6a4f; float: right; }
    .action   { background: #fffaf0; border-left: 4px solid #d69e2e; padding: 10px; margin: 8px 0; border-radius: 4px; }
    .metric   { display: inline-block; margin: 8px 16px 8px 0; }
    .metric-val { font-size: 24px; font-weight: bold; color: #1a365d; }
    .metric-lbl { font-size: 12px; color: #718096; }
    a         { color: #2b6cb0; }
    .footer   { font-size: 12px; color: #718096; text-align: center; margin-top: 20px; }
  </style>
</head>
<body>

<div class="header">
  <h1>PRIME Daily Brief</h1>
  <p style="margin:4px 0 0 0; opacity:0.8;">${brief.date} — Axiom Federal Solutions</p>
</div>

<!-- KEY NUMBERS -->
<div class="card">
  <h2>📊 By the Numbers</h2>
  <div class="metric">
    <div class="metric-val">${brief.newOpps.length}</div>
    <div class="metric-lbl">New Opportunities (Score ≥70)</div>
  </div>
  <div class="metric">
    <div class="metric-val">${brief.contracts.length}</div>
    <div class="metric-lbl">Active Contracts</div>
  </div>
  <div class="metric">
    <div class="metric-val">$${totalActiveValue.toLocaleString()}</div>
    <div class="metric-lbl">Active Contract Value</div>
  </div>
  <div class="metric">
    <div class="metric-val">${brief.urgent.length}</div>
    <div class="metric-lbl">Items Need Attention</div>
  </div>
</div>

${brief.urgent.length > 0 ? `
<!-- URGENT ITEMS -->
<div class="card urgent">
  <h2>🚨 Urgent — Action Required Today</h2>
  ${brief.urgent.map(u => `
    <div class="action">
      <strong>${u.action}</strong><br>
      <small>${JSON.stringify(u.details)}</small>
    </div>
  `).join('')}
</div>` : ''}

${brief.debriefs.length > 0 ? `
<!-- DEBRIEF DEADLINES -->
<div class="card urgent">
  <h2>⚖️ Debrief Requests Due (3-Day FAR Window)</h2>
  ${brief.debriefs.map(d => `
    <div class="action">
      <strong>${d.agency}</strong> — Debrief deadline: ${d.debrief_request_deadline}<br>
      <small>Request debrief at: <a href="https://www.sam.gov">sam.gov</a></small>
    </div>
  `).join('')}
</div>` : ''}

${brief.proposals.length > 0 ? `
<!-- PROPOSALS AWAITING APPROVAL -->
<div class="card">
  <h2>✍️ Proposals Ready — Your Approval Needed</h2>
  ${brief.proposals.map(p => `
    <div class="action">
      <strong>${p.opportunities?.title || 'Unknown'}</strong>
      <span class="score">Score: ${p.opportunities?.prime_score || '?'}/100</span><br>
      Agency: ${p.opportunities?.agency || '?'} |
      Value: $${(p.opportunities?.value || 0).toLocaleString()}<br>
      <small>Reply APPROVE or NO BID to this email, or log into the dashboard to decide.</small>
    </div>
  `).join('')}
</div>` : ''}

${brief.newOpps.length > 0 ? `
<!-- NEW OPPORTUNITIES -->
<div class="card">
  <h2>🎯 New Opportunities (Top ${Math.min(brief.newOpps.length, 10)})</h2>
  ${brief.newOpps.slice(0, 10).map(o => `
    <div class="opp">
      <span class="score">${o.prime_score}/100</span>
      <strong>${o.title}</strong><br>
      ${o.agency || 'Unknown Agency'} | ${o.state || '?'} |
      $${(o.value || 0).toLocaleString()} |
      NAICS: ${o.naics || '?'} |
      ${o.set_aside ? 'Set-Aside: ' + o.set_aside : 'Open Competition'}<br>
      Deadline: ${o.deadline || 'TBD'}
      ${o.site_visit_required ? '<br>⚠️ <strong>Site Visit Required</strong>' : ''}
    </div>
  `).join('')}
</div>` : ''}

${brief.staleDecisions.length > 0 ? `
<!-- DECISIONS NEEDED -->
<div class="card">
  <h2>⏰ Waiting on Your Decision (Bid or No Bid)</h2>
  ${brief.staleDecisions.map(o => `
    <div class="action">
      <span class="score">${o.prime_score}/100</span>
      <strong>${o.title}</strong> — ${o.decision_age_days || 1}+ days waiting<br>
      ${o.agency || '?'} | $${(o.value || 0).toLocaleString()} | Deadline: ${o.deadline || 'TBD'}
    </div>
  `).join('')}
</div>` : ''}

<div class="footer">
  PRIME System — Axiom Federal Solutions — $8-9/month to operate<br>
  Generated at ${new Date().toISOString()}
</div>

</body>
</html>`;
}

// ----------------------------------------------------------
// SEND EMAIL: Send the briefing via SendGrid
// ----------------------------------------------------------
async function sendEmail(subject, htmlContent) {
  const body = {
    personalizations: [{ to: [{ email: RECIPIENT_EMAIL, name: 'Joseph Walker IV' }] }],
    from: { email: SENDER_EMAIL, name: SENDER_NAME },
    subject,
    content: [{ type: 'text/html', value: htmlContent }],
  };

  const res = await fetch(SENDGRID_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('SendGrid error ' + res.status + ': ' + errText);
  }

  console.log('BRANDI: Email sent — status ' + res.status);
}

// ----------------------------------------------------------
// HELPER: Get a formatted date string for the email subject
// ----------------------------------------------------------
function getFormattedDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Chicago',
  });
}

// ----------------------------------------------------------
// START: Run BRANDI when this file is executed
// ----------------------------------------------------------
runBrandi();
