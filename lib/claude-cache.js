// =============================================================
// LIB/CLAUDE-CACHE.JS — Response cache for Claude API calls
// JOB:  Hash each prompt; if we've seen the same prompt before,
//       return the cached response instead of paying for another
//       Anthropic API call.
// WHY:  JUDGE re-scores the same opp 4× a day; BIDENGINE re-prices
//       the same supply lists; BRANDI re-summarizes the same
//       briefs. Without caching, every scheduled run pays full
//       price for identical work.
// HOW:  SHA-256 hash of the (model + normalized prompt). Hash is
//       deterministic — same input always maps to the same row.
//       Cache hits write `last_used_at` + `hit_count++` so we can
//       see which prompts repay the cache cost.
// AUDIT TRAIL: 2026-04-30 — added in response to Anthropic credit
//              depletion incident; chokepoint approach so every
//              Claude-calling agent benefits without changes.
// =============================================================

const crypto = require('crypto');
const { supabase, logAction } = require('./supabase');

// Default cache lifetime — most scored opps don't change for a week.
// Callers can override per-call (e.g., DRAFT proposals could use TTL=30).
const DEFAULT_TTL_DAYS = 7;

// Don't cache anything bigger than this — prompts that long are
// usually one-shot proposals (worth re-running for fresh output) and
// would bloat the cache table.
const MAX_CACHE_PROMPT_BYTES = 60_000;

// ----------------------------------------------------------
// HASH PROMPT: Deterministic SHA-256 of (model + prompt).
// Whitespace is normalized so trivial reformat doesn't bust cache.
// Model is part of the key so Haiku and Sonnet responses to the
// same prompt are stored separately.
// ----------------------------------------------------------
function hashPrompt(model, prompt) {
  const normalized = String(prompt || '').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(model + '|' + normalized).digest('hex');
}

// ----------------------------------------------------------
// GET CACHED: Look up a previous response by prompt hash.
// Returns the cached response text + metadata, or null if no hit
// or if the entry has expired.
// ----------------------------------------------------------
async function getCached(promptHash) {
  try {
    const { data, error } = await supabase
      .from('claude_cache')
      .select('response, created_at, ttl_days, hit_count, model, caller')
      .eq('prompt_hash', promptHash)
      .single();

    if (error || !data) return null;

    // Manual TTL check — generated columns aren't always reliable across PG versions
    const ageMs   = Date.now() - new Date(data.created_at).getTime();
    const ttlMs   = (data.ttl_days || DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000;
    if (ageMs > ttlMs) return null;

    return data;
  } catch (err) {
    // Cache lookup failures should never block real work.
    console.warn('CLAUDE CACHE: lookup error —', err.message);
    return null;
  }
}

// ----------------------------------------------------------
// RECORD HIT: A cache lookup succeeded — bump hit_count + last_used_at
// so we can audit which prompts the cache is actually saving us money on.
// Best-effort: we don't await/error here.
// ----------------------------------------------------------
function recordHit(promptHash) {
  // RPC would be cleaner but we don't want to require a function install
  supabase.rpc('claude_cache_increment_hit', { p_hash: promptHash }).then(
    () => {},
    async () => {
      // Fall back to a read-modify-write if the RPC isn't installed
      try {
        const { data } = await supabase
          .from('claude_cache')
          .select('hit_count')
          .eq('prompt_hash', promptHash)
          .single();
        if (data) {
          await supabase.from('claude_cache')
            .update({ hit_count: (data.hit_count || 0) + 1, last_used_at: new Date().toISOString() })
            .eq('prompt_hash', promptHash);
        }
      } catch (_) { /* swallow — cache stats are nice-to-have */ }
    }
  );
}

// ----------------------------------------------------------
// SET CACHED: Store a fresh response keyed by prompt hash.
// Called from lib/claude.js after a successful API call returns.
// Skips storage if the prompt is unusually large (one-shot work).
// ----------------------------------------------------------
async function setCached({ promptHash, prompt, model, caller, response, inputTokens, outputTokens, costUsd, ttlDays }) {
  if (!response) return;
  if (Buffer.byteLength(prompt || '', 'utf8') > MAX_CACHE_PROMPT_BYTES) return;

  try {
    await supabase.from('claude_cache').upsert({
      prompt_hash:    promptHash,
      prompt_preview: String(prompt || '').slice(0, 200),
      caller:         caller || 'unknown',
      model:          model,
      response:       response,
      input_tokens:   inputTokens || 0,
      output_tokens:  outputTokens || 0,
      cost_usd:       costUsd || 0,
      hit_count:      0,                                // set on first hit
      ttl_days:       ttlDays || DEFAULT_TTL_DAYS,
      created_at:     new Date().toISOString(),
      last_used_at:   new Date().toISOString(),
    }, { onConflict: 'prompt_hash' });
  } catch (err) {
    console.warn('CLAUDE CACHE: store error —', err.message);
  }
}

// ----------------------------------------------------------
// PURGE EXPIRED: Optional housekeeping — call from a cron or T.E.S.T.
// Removes entries older than their ttl_days. Safe to call repeatedly.
// ----------------------------------------------------------
async function purgeExpired() {
  try {
    // Postgres-side: delete where created_at + (ttl_days || ' days') < now()
    const { error } = await supabase.rpc('claude_cache_purge_expired');
    if (error && !/function .* does not exist/i.test(error.message)) throw error;
    if (error) {
      // Fallback: manual cutoff at 30 days for any TTL beyond that
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('claude_cache').delete().lt('created_at', cutoff);
    }
    await logAction('CLAUDE_CACHE', 'Purged expired entries', {});
  } catch (err) {
    console.warn('CLAUDE CACHE: purge error —', err.message);
  }
}

module.exports = { hashPrompt, getCached, recordHit, setCached, purgeExpired };
