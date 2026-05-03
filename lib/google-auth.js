// =============================================================
// LIB/GOOGLE-AUTH.JS — Google OAuth 2.0 access token helper
// JOB: Convert the long-lived refresh_token in GitHub Secrets into a
//      short-lived access_token (1 hour) so agents can call Drive/Sheets APIs.
// USED BY: lib/google-drive.js, lib/google-sheets.js, agents/draft-bid.js
// COST: $0 — Google's OAuth token endpoint is free.
// SAFETY: Tokens are short-lived. Refresh token never logged. Never written to DB.
// =============================================================

// In-memory cache so we don't burn through token requests every call.
// Tokens last 60 minutes; we refresh at 55 minutes for safety.
let _cachedAccessToken = null;
let _cachedTokenExpiry = 0;

/**
 * Get a fresh Google access token. Caches for 55 minutes between calls.
 * Throws if any of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
 * are missing from the environment.
 */
async function getAccessToken() {
  const now = Date.now();
  if (_cachedAccessToken && now < _cachedTokenExpiry) {
    return _cachedAccessToken;
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    const missing = [
      !clientId     && 'GOOGLE_CLIENT_ID',
      !clientSecret && 'GOOGLE_CLIENT_SECRET',
      !refreshToken && 'GOOGLE_REFRESH_TOKEN',
    ].filter(Boolean).join(', ');
    throw new Error('Google OAuth misconfigured — missing ' + missing + ' env var(s)');
  }

  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '(unreadable)');
    // SECURITY: never log the refresh token itself; only the response.
    throw new Error('Google OAuth token exchange failed (HTTP ' + res.status + '): ' + errBody.slice(0, 300));
  }

  const data = await res.json();
  const accessToken = data.access_token;
  const expiresIn   = data.expires_in || 3600; // seconds

  _cachedAccessToken = accessToken;
  // Refresh 5 minutes before actual expiry to avoid edge cases
  _cachedTokenExpiry = now + Math.max(0, (expiresIn - 300)) * 1000;

  return accessToken;
}

/**
 * Helper for Drive/Sheets fetch wrappers — adds Authorization header automatically.
 * Throws on non-2xx with a useful error including the API response body.
 */
async function googleFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = Object.assign({}, options.headers || {}, {
    'Authorization': 'Bearer ' + token,
  });
  const res = await fetch(url, Object.assign({}, options, { headers }));

  if (!res.ok) {
    const errBody = await res.text().catch(() => '(unreadable)');
    const err = new Error('Google API ' + res.status + ' ' + res.statusText + ': ' + errBody.slice(0, 400));
    err.status = res.status;
    err.body   = errBody;
    throw err;
  }

  // Drive API returns JSON for almost everything; let caller decide how to parse
  return res;
}

module.exports = { getAccessToken, googleFetch };
