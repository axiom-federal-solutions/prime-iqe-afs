// =============================================================
// LIB/COST-GUARD.JS — AI Cost Limiter
// JOB: Make sure no single agent spends more than $2/day on Claude AI
//      Monthly hard cap: $10 total (enforced separately in Anthropic dashboard)
// WHY: A runaway automation loop could burn through money fast without this
// HOW: Reads and writes cost totals to the agent_cost_log table in Supabase
// =============================================================

const { supabase, logAction } = require('./supabase');

// Maximum spend limits
const DAILY_CAP_PER_AGENT  = 2.00;   // $2/day per individual agent
const MONTHLY_SYSTEM_CAP   = 10.00;  // $10/month for the whole system
const ALERT_THRESHOLD_PCT  = 0.80;   // Warn at 80% of the limit

// ----------------------------------------------------------
// CHECK COST CAP: Can this agent spend more money today?
// Call this BEFORE making any Claude API calls
// Returns: { allowed: true/false, reason: string, spent: number }
//
// Parameters:
//   agentName    — name of the agent checking in (e.g., 'JUDGE', 'DRAFT')
//   estimatedCost — how much the next call is expected to cost in $
// ----------------------------------------------------------
async function checkCostCap(agentName, estimatedCost = 0) {
  const today = new Date().toISOString().split('T')[0];  // 'YYYY-MM-DD'

  try {
    // How much has this agent spent today?
    const { data: agentData } = await supabase
      .from('agent_cost_log')
      .select('cost_usd')
      .eq('agent', agentName)
      .eq('date', today);

    const agentSpentToday = (agentData || []).reduce((sum, r) => sum + (r.cost_usd || 0), 0);

    // How much has the whole system spent today?
    const { data: systemData } = await supabase
      .from('agent_cost_log')
      .select('cost_usd')
      .eq('date', today);

    const systemSpentToday = (systemData || []).reduce((sum, r) => sum + (r.cost_usd || 0), 0);

    // Check if this agent would exceed its daily cap
    if (agentSpentToday + estimatedCost > DAILY_CAP_PER_AGENT) {
      await logAction(agentName, 'Daily cost cap reached — skipping AI call', {
        agent_spent_today: agentSpentToday,
        estimated_cost:    estimatedCost,
        daily_cap:         DAILY_CAP_PER_AGENT,
      });

      return {
        allowed: false,
        reason:  agentName + ' daily cap of $' + DAILY_CAP_PER_AGENT + ' reached ($' + agentSpentToday.toFixed(4) + ' spent today)',
        spent:   agentSpentToday,
      };
    }

    // Warn if getting close to the limit
    if (agentSpentToday >= DAILY_CAP_PER_AGENT * ALERT_THRESHOLD_PCT) {
      await logAction(agentName, 'Cost warning — approaching daily cap', {
        agent_spent_today: agentSpentToday,
        daily_cap:         DAILY_CAP_PER_AGENT,
        pct_used:          ((agentSpentToday / DAILY_CAP_PER_AGENT) * 100).toFixed(0) + '%',
      });
    }

    return {
      allowed: true,
      reason:  'Within limits',
      spent:   agentSpentToday,
    };

  } catch (err) {
    // If we can't check the cost, BLOCK the call as a safety measure
    console.error('COST GUARD DB ERROR — blocking agent as safety measure:', err.message);
    return { allowed: false, reason: 'Cost check DB error — blocked to prevent runaway spend', spent: 0 };
  }
}

// ----------------------------------------------------------
// RECORD COST: Log how much an agent spent on a Claude API call
// Call this AFTER every successful Claude AI call
// Parameters:
//   agentName — name of the agent that made the call
//   costUsd   — actual cost of the call in dollars
//   model     — which model was used ('haiku' or 'sonnet')
//   details   — optional extra info (tokens used, prompt type, etc.)
// ----------------------------------------------------------
async function recordCost(agentName, costUsd, model, details = {}) {
  const today = new Date().toISOString().split('T')[0];

  try {
    await supabase.from('agent_cost_log').insert({
      agent:     agentName,
      date:      today,
      cost_usd:  costUsd,
      model:     model,
      details:   details,
      logged_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('COST GUARD: Could not record cost —', err.message);
  }
}

// ----------------------------------------------------------
// GET MONTHLY SPEND: How much has the whole system spent this month?
// Used by BRANDI to include cost info in the monthly summary
// ----------------------------------------------------------
async function getMonthlySpend() {
  const now       = new Date();
  const monthStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';

  try {
    const { data } = await supabase
      .from('agent_cost_log')
      .select('agent, cost_usd')
      .gte('date', monthStart);

    const total    = (data || []).reduce((sum, r) => sum + (r.cost_usd || 0), 0);
    const byAgent  = {};

    for (const row of (data || [])) {
      byAgent[row.agent] = (byAgent[row.agent] || 0) + (row.cost_usd || 0);
    }

    return {
      total_usd:    total,
      monthly_cap:  MONTHLY_SYSTEM_CAP,
      pct_used:     ((total / MONTHLY_SYSTEM_CAP) * 100).toFixed(0) + '%',
      by_agent:     byAgent,
      month_start:  monthStart,
    };
  } catch (err) {
    return { total_usd: 0, error: err.message };
  }
}

module.exports = { checkCostCap, recordCost, getMonthlySpend };
