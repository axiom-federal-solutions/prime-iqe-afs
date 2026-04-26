// =============================================================
// LIB/SUPABASE.JS — Shared database connection
// ALL agents import from here — keeps the connection in one place
// This file uses environment variables — never hardcode keys here
// =============================================================

const { createClient } = require('@supabase/supabase-js');

// Create a Supabase client using the keys stored in GitHub Secrets
// process.env reads the secret values that GitHub injects at runtime
const supabase = createClient(
  process.env.SUPABASE_URL,          // Your Supabase project URL
  process.env.SUPABASE_SERVICE_KEY,  // Service role key (full database access)
  {
    auth: { persistSession: false },  // No session needed — this is a server app
  }
);

// ----------------------------------------------------------
// LOG ACTION: Write a record of what each agent did
// Every agent call ends with a log entry for audit purposes
// ----------------------------------------------------------
async function logAction(agent, action, details = {}) {
  try {
    const { error } = await supabase
      .from('audit_log')
      .insert({
        agent,
        action,
        details,
        outcome: details.error ? 'error' : 'success',
        created_at: new Date().toISOString(),
      });

    if (error) {
      // Don't crash the agent if logging fails — just print a warning
      console.warn('LOG WARNING: Could not write to audit_log —', error.message);
    }
  } catch (err) {
    console.warn('LOG WARNING: logAction failed —', err.message);
  }
}

// Export so all agents can use the same connection
module.exports = { supabase, logAction };
