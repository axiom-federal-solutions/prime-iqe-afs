// =============================================================
// LIB/CLAUDE.JS — AI Model Wrappers (Haiku + Sonnet)
// JOB: Give every agent an easy way to call Claude AI
//      Haiku = fast and cheap (bulk scoring, memos)
//      Sonnet = smarter and better (proposals, analysis)
// COST TRACKING: Every call logs token usage so we stay under $10/mo
// =============================================================

const Anthropic = require('@anthropic-ai/sdk');
const { logAction, getConfig, setConfig } = require('./supabase');
const { checkCostCap, recordCost } = require('./cost-guard');
const { hashPrompt, getCached, recordHit, setCached } = require('./claude-cache');

// Load the API key from environment variables — NEVER hardcode this
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('CLAUDE ERROR: Missing ANTHROPIC_API_KEY environment variable.');
  process.exit(1);
}

// Create the Anthropic client
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Model names — update these if Anthropic releases newer versions
const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';   // Cheap, fast — bulk tasks
const SONNET_MODEL = 'claude-sonnet-4-6';             // Smarter — proposals, analysis

// Max tokens to generate per response (controls length and cost)
const HAIKU_MAX_TOKENS  = 1500;  // Short outputs — scores, memos, quotes
const SONNET_MAX_TOKENS = 4000;  // Longer outputs — full proposal volumes

// 2026-04-30: Conservative pre-call cost estimates used by checkCostCap.
// We don't know token counts until AFTER the call returns, so we estimate
// at 80th-percentile observed cost. Real cost is recorded post-call via recordCost().
const ESTIMATED_HAIKU_COST  = 0.005;   // ~$0.005 per Haiku scoring call
const ESTIMATED_SONNET_COST = 0.050;   // ~$0.05 per Sonnet proposal call

// 2026-04-30: Custom error classes so callers can distinguish billing/cap from real errors.
// Workflows can catch these and exit cleanly (continue-on-error) instead of crashing.
class CostCapError extends Error {
  constructor(msg) { super(msg); this.name = 'CostCapError'; this.code = 'COST_CAP_REACHED'; }
}
class CreditsDepletedError extends Error {
  constructor(msg) { super(msg); this.name = 'CreditsDepletedError'; this.code = 'ANTHROPIC_CREDITS_DEPLETED'; }
}

// 2026-04-30: Detect Anthropic credit/billing errors. Once the user's account runs out
// of credits, EVERY subsequent call returns 400 with "credit balance is too low". Catching
// the first one and setting a global halt flag prevents the next 50 agents from each
// burning their own log entry on the same problem.
function isCreditDepletionError(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('credit balance is too low') ||
         msg.includes('insufficient_quota') ||
         msg.includes('billing') && msg.includes('upgrade');
}

// ----------------------------------------------------------
// CALL CLAUDE: Internal helper that calls the API and logs usage
// Both claudeHaiku and claudeSonnet use this function
// ----------------------------------------------------------
async function callClaude(model, maxTokens, prompt, callerName, opts = {}) {
  // Normalize caller name to agent identifier for cost-guard bookkeeping.
  // 'JUDGE-bulk' → 'JUDGE', 'haiku-json' → 'HAIKU-JSON', etc.
  const callerAgent = String(callerName || 'unknown').toUpperCase().split(/[\-_\s]/)[0];
  const isHaiku = model.includes('haiku');
  // 2026-04-30: Caller can opt out of cache (e.g., DRAFT proposals where
  // every run should produce fresh language) by passing { skipCache: true }.
  const skipCache  = opts.skipCache === true;
  const cacheTtlDays = opts.cacheTtlDays;
  const promptHash = skipCache ? null : hashPrompt(model, prompt);

  // ── PRE-CHECK 0: Cache lookup — if we've answered this exact prompt
  // for this exact model in the TTL window, return the saved response.
  // Skips cost cap, halt flag, and the API call entirely. Massive credit savings.
  if (promptHash) {
    const hit = await getCached(promptHash);
    if (hit) {
      recordHit(promptHash);  // fire-and-forget bump hit_count
      await logAction('CLAUDE', 'API call served from cache', {
        caller: callerName || 'unknown',
        model,
        prompt_hash: promptHash.slice(0, 12),
      });
      return hit.response;
    }
  }

  // ── PRE-CHECK 1: Global halt flag from prior credit depletion ────────
  // If a recent call detected credits ran out, every subsequent call short-circuits.
  // User must reset this manually after topping up at console.anthropic.com.
  const haltFlag = await getConfig('ANTHROPIC_CREDITS_DEPLETED', 'false');
  if (haltFlag === 'true') {
    console.warn('CLAUDE: ANTHROPIC_CREDITS_DEPLETED flag is set — skipping call. Top up + reset to continue.');
    throw new CreditsDepletedError(
      'Anthropic credits depleted (system_config.ANTHROPIC_CREDITS_DEPLETED=true). ' +
      'Top up at https://console.anthropic.com/settings/billing then run: ' +
      'UPDATE system_config SET value=\'false\' WHERE key=\'ANTHROPIC_CREDITS_DEPLETED\';'
    );
  }

  // ── PRE-CHECK 2: Per-agent daily cost cap (default $2/agent/day) ────
  const estimatedCost = isHaiku ? ESTIMATED_HAIKU_COST : ESTIMATED_SONNET_COST;
  const guard = await checkCostCap(callerAgent, estimatedCost);
  if (!guard.allowed) {
    console.warn('CLAUDE: Cost cap blocked call for ' + callerAgent + ' — ' + guard.reason);
    throw new CostCapError(guard.reason);
  }

  const start = Date.now();
  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const inputTokens  = response.usage?.input_tokens  || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const actualCost = isHaiku
      ? (inputTokens * 0.00025 + outputTokens * 0.00125) / 1000
      : (inputTokens * 0.003   + outputTokens * 0.015)   / 1000;

    // Record actual cost in agent_cost_log so the next checkCostCap has real data.
    await recordCost(callerAgent, actualCost, isHaiku ? 'haiku' : 'sonnet', {
      caller:        callerName,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      elapsed_sec:   elapsed,
    });

    // Activity log (separate from cost log — for human review)
    await logAction('CLAUDE', 'API call completed', {
      caller:        callerName || 'unknown',
      model:         model,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      elapsed_sec:   elapsed,
      cost_estimate: actualCost.toFixed(4),
    });

    // 2026-04-30: Cache the fresh response so the next identical prompt
    // hits the cache instead of paying for the same answer twice.
    const text = response.content[0]?.text || '';
    if (promptHash && text) {
      setCached({
        promptHash, prompt, model, caller: callerName, response: text,
        inputTokens, outputTokens, costUsd: actualCost, ttlDays: cacheTtlDays,
      }).catch(() => {}); // fire-and-forget; never block on cache writes
    }

    return text;

  } catch (err) {
    // ── BILLING ERROR HANDLING: trip the halt flag once, then bail clean ──
    if (isCreditDepletionError(err)) {
      console.error('CLAUDE: Anthropic credits depleted — setting global halt flag.');
      try { await setConfig('ANTHROPIC_CREDITS_DEPLETED', 'true'); } catch (_) {}
      await logAction('CLAUDE', 'CRITICAL — Anthropic credits depleted', {
        caller:    callerName || 'unknown',
        model,
        error:     err.message,
        recovery:  'Top up at https://console.anthropic.com/settings/billing then UPDATE system_config SET value=\'false\' WHERE key=\'ANTHROPIC_CREDITS_DEPLETED\'',
      });
      throw new CreditsDepletedError('Anthropic credits depleted: ' + err.message);
    }

    // Any other error propagates
    console.error('CLAUDE ERROR (' + model + '):', err.message);
    await logAction('CLAUDE', 'API call failed', {
      caller: callerName || 'unknown',
      model,
      error: err.message,
    });
    throw err;
  }
}

// ----------------------------------------------------------
// CLAUDE HAIKU: Fast and cheap — use for bulk tasks
// Best for: scoring 50+ opportunities, short memos, supply quotes
// `opts` (optional): { skipCache: true } to force a fresh API call,
//                    { cacheTtlDays: 30 } to override default 7-day TTL.
// ----------------------------------------------------------
async function claudeHaiku(prompt, callerName, opts) {
  return callClaude(HAIKU_MODEL, HAIKU_MAX_TOKENS, prompt, callerName || 'haiku', opts);
}

// ----------------------------------------------------------
// CLAUDE SONNET: Smarter output — use for important documents
// Best for: full proposal volumes, bid/no-bid analysis, legal language
// Note: DRAFT typically passes { skipCache: true } since proposals
// should generate fresh language on every run.
// ----------------------------------------------------------
async function claudeSonnet(prompt, callerName, opts) {
  return callClaude(SONNET_MODEL, SONNET_MAX_TOKENS, prompt, callerName || 'sonnet', opts);
}

// ----------------------------------------------------------
// CLAUDE JSON: Ask Claude Haiku for a structured JSON response
// Automatically parses the JSON — throws error if invalid JSON returned
// `opts` forwarded to claudeHaiku (skipCache, cacheTtlDays)
// ----------------------------------------------------------
async function claudeJSON(prompt, callerName, opts) {
  const jsonPrompt = prompt + '\n\nIMPORTANT: Respond with ONLY valid JSON — no explanation, no markdown, no code blocks. Just the raw JSON object.';

  const raw = await claudeHaiku(jsonPrompt, callerName || 'haiku-json', opts);

  try {
    const cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('CLAUDE JSON ERROR: Could not parse response —', raw.substring(0, 200));
    throw new Error('Claude returned invalid JSON: ' + err.message);
  }
}

// Export for use by all agents.
// CostCapError + CreditsDepletedError exposed so agents can wrap calls in try/catch
// and exit gracefully (process.exit(0)) instead of failing the workflow.
module.exports = { claudeHaiku, claudeSonnet, claudeJSON, CostCapError, CreditsDepletedError };
