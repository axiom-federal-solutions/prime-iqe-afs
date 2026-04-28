// =============================================================
// LIB/SUPABASE.JS — Database Connection + Helper Functions
// JOB: Connect to the Supabase database and provide shortcuts
//      that every agent uses (log actions, check kill switch)
// USED BY: All agents — this is the backbone of the system
// =============================================================

const { createClient } = require('@supabase/supabase-js');

// Read the database URL and key from environment variables
// NEVER put real keys here — they live in GitHub Secrets / .env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Make sure the environment variables are actually set
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

// Create ONE Supabase connection that gets shared across the whole system
// Think of this like one phone line that everyone uses — no need to dial in separately
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },  // Server-side — no browser sessions needed
});

// ----------------------------------------------------------
// LOG ACTION: Write what each agent did to the audit trail
// Every agent calls this so we have a full history of actions
// Example: logAction('SCOUT', 'Found 12 new opportunities', { count: 12 })
// ----------------------------------------------------------
async function logAction(agent, action, metadata = {}) {
  try {
    const { error } = await supabase.from('agent_logs').insert({
      agent,
      action,
      metadata,
      created_at: new Date().toISOString(),
    });

    if (error) {
      // Log to console but don't crash — logging failures shouldn't stop the agent
      console.warn('LOG WARNING: Could not write to agent_logs —', error.message);
    }
  } catch (err) {
    console.warn('LOG WARNING: logAction threw an error —', err.message);
  }
}

// ----------------------------------------------------------
// CHECK SYSTEM HALT: Emergency kill switch
// If someone sets SYSTEM_HALT = true in system_config, all agents stop
// This is the emergency brake — use it if something goes wrong
// ----------------------------------------------------------
async function checkSystemHalt(agentName) {
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'SYSTEM_HALT')
      .single();

    if (error || !data) return false;  // If we can't read it, assume we're fine

    const isHalted = data.value === 'true' || data.value === true;

    if (isHalted) {
      console.log(agentName + ': SYSTEM_HALT is active — shutting down immediately.');
      await logAction(agentName, 'Halted by SYSTEM_HALT kill switch', { halted_at: new Date().toISOString() });
    }

    return isHalted;
  } catch (err) {
    console.warn(agentName + ': Could not check SYSTEM_HALT —', err.message);
    return false;  // If we can't check, assume we're fine
  }
}

// ----------------------------------------------------------
// GET CONFIG: Read a setting from the system_config table
// Used by agents to read thresholds, switches, and limits
// Example: getConfig('PRIME_THRESHOLD') → '70'
// ----------------------------------------------------------
async function getConfig(key, defaultValue = null) {
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', key)
      .single();

    if (error || !data) return defaultValue;
    return data.value;
  } catch (err) {
    return defaultValue;
  }
}

// ----------------------------------------------------------
// SET CONFIG: Update a setting in the system_config table
// Used by agents to record state (like "last scan completed at X")
// ----------------------------------------------------------
async function setConfig(key, value) {
  try {
    const { error } = await supabase
      .from('system_config')
      .upsert({ key, value: String(value) }, { onConflict: 'key' });

    if (error) console.warn('SET CONFIG WARNING:', error.message);
  } catch (err) {
    console.warn('SET CONFIG ERROR:', err.message);
  }
}

// ----------------------------------------------------------
// IS AGENT ENABLED: Check if a specific agent is enabled
// T.E.S.T. writes per-agent HALT flags to system_config
// Key format: AGENT_SCOUT_ENABLED, AGENT_JUDGE_ENABLED, etc.
// Returns true (run) or false (skip). If key doesn't exist → true (enabled by default)
// ----------------------------------------------------------
async function isAgentEnabled(agentName) {
  try {
    // Check global SYSTEM_HALT first
    const halted = await checkSystemHalt(agentName);
    if (halted) return false;

    // Check per-agent enable flag
    const key = `AGENT_${agentName.toUpperCase()}_ENABLED`;
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', key)
      .single();

    // If key doesn't exist (no row), agent is enabled by default
    if (error || !data) return true;

    const enabled = data.value !== 'false';
    if (!enabled) {
      console.log(agentName + ': Disabled via system_config — T.E.S.T. issued a HALT. Check dashboard to re-enable.');
      await logAction(agentName, 'Skipped — agent disabled by T.E.S.T. HALT', { key });
    }
    return enabled;
  } catch (err) {
    console.warn(agentName + ': Could not check isAgentEnabled —', err.message);
    return true;  // Default: enabled (fail open so agents don't silently stop)
  }
}

// Export everything so other files can use it
module.exports = { supabase, logAction, checkSystemHalt, isAgentEnabled, getConfig, setConfig };
