// =============================================================
// LIB/SENDGRID.JS — Email Delivery via SendGrid
// JOB: Send HTML emails to Mr. Kemp (PrimeOpps1@gmail.com)
//      Used by BRANDI for morning briefs and critical alerts
// COST: Free tier covers 100 emails/day — we send ~35/month
// SAFETY RULE: Only sends to whitelisted addresses
// =============================================================

const sgMail = require('@sendgrid/mail');
const { logAction } = require('./supabase');

// Load credentials from environment variables — NEVER hardcode
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL       = process.env.FROM_EMAIL || 'PrimeOpps1@gmail.com';
const FROM_NAME        = process.env.FROM_NAME  || 'PRIME — Axiom Federal Solutions';

// Only send emails to these addresses — safety guardrail against accidents
const ALLOWED_RECIPIENTS = [
  'PrimeOpps1@gmail.com',
  'renkemp2@gmail.com',  // Mr. Kemp backup
];

if (!SENDGRID_API_KEY) {
  console.error('SENDGRID ERROR: Missing SENDGRID_API_KEY environment variable.');
  process.exit(1);
}

sgMail.setApiKey(SENDGRID_API_KEY);

// ----------------------------------------------------------
// SEND EMAIL: Deliver an HTML email through SendGrid
// Parameters:
//   to      — recipient email address (must be in ALLOWED_RECIPIENTS)
//   subject — email subject line
//   html    — full HTML content of the email
//   text    — plain text fallback (shown if HTML doesn't load)
// ----------------------------------------------------------
async function sendEmail({ to, subject, html, text }) {
  // Safety check — only send to approved addresses
  if (!ALLOWED_RECIPIENTS.includes(to)) {
    console.warn('SENDGRID: Blocked attempt to email unlisted address:', to);
    await logAction('SENDGRID', 'Email blocked — recipient not in whitelist', { to, subject });
    return false;
  }

  const message = {
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
    text: text || stripHtml(html),  // Generate plain text if not provided
    html,
  };

  try {
    await sgMail.send(message);

    await logAction('SENDGRID', 'Email sent successfully', {
      to,
      subject,
      sent_at: new Date().toISOString(),
    });

    console.log('SENDGRID: Email sent to ' + to + ' — "' + subject + '"');
    return true;

  } catch (err) {
    console.error('SENDGRID ERROR:', err.message);

    await logAction('SENDGRID', 'Email send failed', {
      to,
      subject,
      error: err.message,
    });

    return false;
  }
}

// ----------------------------------------------------------
// SEND BRIEF: Shortcut for sending the daily morning brief
// Pre-filled with Mr. Kemp as recipient — BRANDI uses this
// ----------------------------------------------------------
async function sendBrief(subject, html) {
  return sendEmail({
    to: 'PrimeOpps1@gmail.com',
    subject,
    html,
  });
}

// ----------------------------------------------------------
// WRAP HTML: Wrap content in the standard PRIME email template
// Gives every email the same dark-theme professional look
// ----------------------------------------------------------
function wrapEmail(title, bodyHtml) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#06080F;font-family:'Outfit',Arial,sans-serif;color:#EDF0F7;">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="text-align:center;padding:24px 0 16px;border-bottom:1px solid rgba(233,196,106,0.25);">
      <div style="font-size:11px;letter-spacing:3px;color:#E9C46A;font-weight:600;text-transform:uppercase;">PRIME — IQE</div>
      <div style="font-size:22px;font-weight:700;color:#EDF0F7;margin-top:4px;">${title}</div>
      <div style="font-size:12px;color:#8B95AB;margin-top:4px;">${new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })} · Central Time</div>
    </div>

    <!-- Body -->
    <div style="padding:24px 0;">
      ${bodyHtml}
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:16px;font-size:11px;color:#4D5669;text-align:center;">
      Axiom Federal Solutions (Walker Contractors LLC) · New Orleans, LA · UEI: USMQMFAGL9M4<br>
      PRIME IQE — Automated Federal Contracting Intelligence · $0 manual work
    </div>

  </div>
</body>
</html>`;
}

// ----------------------------------------------------------
// STRIP HTML: Convert HTML to plain text for email fallback
// Simple version — removes tags and collapses whitespace
// ----------------------------------------------------------
function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { sendEmail, sendBrief, wrapEmail };
