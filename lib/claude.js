// =============================================================
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
  }
}

// ----------------------------------------------------------
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
