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
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Make sure the environment variables are actually set
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.');
  process.exit(1);
}

// Create ONE Supabase connection that gets shared across the whole system
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
      console.warn('LOG WARNING: Could not write to agent_logs —', error.message);
    }
  } catch (err) {
    console.warn('LOG WARNING: logAction threw an error —', err.message);
  }
}

// ----------------------------------------------------------
// CHECK SYSTEM HALT: Emergency kill switch
// If someone sets SYSTEM_HALT = true in system_config, all agents stop
// ----------------------------------------------------------
async function checkSystemHalt(agentName) {
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'SYSTEM_HALT')
      .single();

    if (error || !data) return false;

    const isHalted = data.value === 'true' || data.value === true;

    if (isHalted) {
      console.log(agentName + ': SYSTEM_HALT is active — shutting down immediately.');
      await logAction(agentName, 'Halted by SYSTEM_HALT kill switch', { halted_at: new Date().toISOString() });
    }

    return isHalted;
  } catch (err) {
    console.warn(agentName + ': Could not check SYSTEM_HALT —', err.message);
    return false;
  }
}

// ----------------------------------------------------------
// GET CONFIG: Read a setting from the system_config table
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
// PING DATABASE: Quick connectivity check before any agent runs
// Returns true if DB is reachable, false if not
// ----------------------------------------------------------
async function pingDatabase() {
  try {
    const { error } = await supabase
      .from('system_config')
      .select('key')
      .limit(1);
    // PGRST116 = no rows found — DB is alive, table is just empty
    if (error && error.code !== 'PGRST116') return false;
    return true;
  } catch (err) {
    return false;
  }
}

// ----------------------------------------------------------
// IS AGENT ENABLED: Check if a specific agent is enabled
// T.E.S.T. writes per-agent HALT flags to system_config
// Key format: AGENT_SCOUT_ENABLED, AGENT_JUDGE_ENABLED, etc.
// Returns true (run) or false (skip). Default → enabled
// FAIL CLOSED: If the DB is unreachable, halt the agent.
//   A dead DB + running agent = silent data loss. Better to halt loud.
// ----------------------------------------------------------
async function isAgentEnabled(agentName) {
  try {
    // Step 0: Verify DB connectivity. If unreachable, fail closed — do NOT run blind.
    const alive = await pingDatabase();
    if (!alive) {
      console.error(agentName + ': DATABASE UNREACHABLE — halting (fail-closed). ' +
        'Check SUPABASE_URL and SUPABASE_SERVICE_KEY secrets point to the same project.');
      process.exit(1);  // Exit with error so GitHub Actions marks the step red
    }

    const halted = await checkSystemHalt(agentName);
    if (halted) return false;

    const key = `AGENT_${agentName.toUpperCase()}_ENABLED`;
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', key)
      .single();

    if (error || !data) return true;

    const enabled = data.value !== 'false';
    if (!enabled) {
      console.log(agentName + ': Disabled via system_config — T.E.S.T. issued a HALT.');
      await logAction(agentName, 'Skipped — agent disabled by T.E.S.T. HALT', { key });
    }
    return enabled;
  } catch (err) {
    console.error(agentName + ': isAgentEnabled threw —', err.message, '— halting (fail-closed).');
    process.exit(1);
  }
}

// Export everything so other files can use it
module.exports = { supabase, logAction, checkSystemHalt, isAgentEnabled, getConfig, setConfig, pingDatabase };
