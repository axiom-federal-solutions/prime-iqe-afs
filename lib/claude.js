// =============================================================
<<<<<<< HEAD
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
=======
// LIB/CLAUDE.JS — Shared AI helper functions
// JUDGE, DRAFT, RECON, BRANDI, and LEDGER all use Claude AI
// Haiku = cheap + fast (bulk operations)
// Sonnet = smarter + slower (proposals, important documents)
// =============================================================

const Anthropic = require('@anthropic-ai/sdk');

// Create a single Anthropic client — all agents share it
// The API key is stored in GitHub Secrets as ANTHROPIC_API_KEY
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Maximum tokens we allow in a response
// Haiku: short answers, Sonnet: long documents
const HAIKU_MAX_TOKENS  = 500;
const SONNET_MAX_TOKENS = 4000;

// ----------------------------------------------------------
// CLAUDE HAIKU: Fast, cheap AI for bulk tasks
// Use for: scoring rationale, quick summaries, memos
// Cost: ~$0.80 per million input tokens
// ----------------------------------------------------------
async function claudeHaiku(prompt) {
  try {
    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',  // Haiku model
      max_tokens: HAIKU_MAX_TOKENS,
      messages: [
        { role: 'user', content: prompt },
      ],
    });

    // Return just the text content from the response
    return message.content[0]?.text || '';
  } catch (err) {
    console.warn('CLAUDE HAIKU ERROR:', err.message);
    return 'AI response unavailable — ' + err.message;
>>>>>>> prime-system/main
  }
}

// ----------------------------------------------------------
<<<<<<< HEAD
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
=======
// CLAUDE SONNET: Smarter AI for important documents
// Use for: full proposals, management plans, technical volumes
// Cost: more than Haiku but better quality output
// Only triggered when Joe approves a bid
// ----------------------------------------------------------
async function claudeSonnet(prompt) {
  try {
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',  // Sonnet model
      max_tokens: SONNET_MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content:
            'You are a federal contracting professional with 20 years of experience. ' +
            'Write in a professional, FAR-compliant tone. ' +
            'Be specific and avoid vague language. ' +
            'Use active voice. ' + prompt,
        },
      ],
    });

    return message.content[0]?.text || '';
  } catch (err) {
    console.warn('CLAUDE SONNET ERROR:', err.message);
    return 'AI response unavailable — ' + err.message;
  }
}

// Export so all agents can use the same AI functions
module.exports = { claudeHaiku, claudeSonnet };
>>>>>>> prime-system/main
