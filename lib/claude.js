// =============================================================
// LIB/CLAUDE.JS — AI Model Wrappers (Haiku + Sonnet)
// JOB: Give every agent an easy way to call Claude AI
//      Haiku = fast and cheap (bulk scoring, memos)
//      Sonnet = smarter and better (proposals, analysis)
// COST TRACKING: Every call logs token usage so we stay under $10/mo
// =============================================================

const Anthropic = require('@anthropic-ai/sdk');
const { logAction } = require('./supabase');

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

// ----------------------------------------------------------
// CALL CLAUDE: Internal helper that calls the API and logs usage
// Both claudeHaiku and claudeSonnet use this function
// ----------------------------------------------------------
async function callClaude(model, maxTokens, prompt, callerName) {
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

    // Log every AI call so we can track monthly cost
    await logAction('CLAUDE', 'API call completed', {
      caller:        callerName || 'unknown',
      model:         model,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      elapsed_sec:   elapsed,
      // Rough cost estimate: Haiku ~$0.00025/1K input, Sonnet ~$0.003/1K input
      cost_estimate: model.includes('haiku')
        ? ((inputTokens * 0.00025 + outputTokens * 0.00125) / 1000).toFixed(4)
        : ((inputTokens * 0.003  + outputTokens * 0.015)   / 1000).toFixed(4),
    });

    // Return just the text — agents don't need the full API response object
    return response.content[0]?.text || '';

  } catch (err) {
    console.error('CLAUDE ERROR (' + model + '):', err.message);
    await logAction('CLAUDE', 'API call failed', {
      caller: callerName || 'unknown',
      model,
      error: err.message,
    });
    throw err;  // Re-throw so the calling agent can handle it
  }
}

// ----------------------------------------------------------
// CLAUDE HAIKU: Fast and cheap — use for bulk tasks
// Best for: scoring 50+ opportunities, short memos, supply quotes
// Example: const score = await claudeHaiku('Score this opportunity: ...')
// ----------------------------------------------------------
async function claudeHaiku(prompt, callerName) {
  return callClaude(HAIKU_MODEL, HAIKU_MAX_TOKENS, prompt, callerName || 'haiku');
}

// ----------------------------------------------------------
// CLAUDE SONNET: Smarter output — use for important documents
// Best for: full proposal volumes, bid/no-bid analysis, legal language
// Example: const proposal = await claudeSonnet('Write Volume 1 of the proposal...')
// ----------------------------------------------------------
async function claudeSonnet(prompt, callerName) {
  return callClaude(SONNET_MODEL, SONNET_MAX_TOKENS, prompt, callerName || 'sonnet');
}

// ----------------------------------------------------------
// CLAUDE JSON: Ask Claude Haiku for a structured JSON response
// Use when you need a score, a number, or a yes/no decision — not prose
// Automatically parses the JSON — throws error if Claude returns invalid JSON
// ----------------------------------------------------------
async function claudeJSON(prompt, callerName) {
  const jsonPrompt = prompt + '\n\nIMPORTANT: Respond with ONLY valid JSON — no explanation, no markdown, no code blocks. Just the raw JSON object.';

  const raw = await claudeHaiku(jsonPrompt, callerName || 'haiku-json');

  try {
    // Strip any accidental markdown fences if Claude added them
    const cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('CLAUDE JSON ERROR: Could not parse response —', raw.substring(0, 200));
    throw new Error('Claude returned invalid JSON: ' + err.message);
  }
}

// Export for use by all agents
module.exports = { claudeHaiku, claudeSonnet, claudeJSON };
