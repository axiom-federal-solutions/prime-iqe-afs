// =============================================================
// LIB/FETCH-RETRY.JS — HTTP Requests with Auto-Retry
// JOB: Make HTTP requests to external APIs (SAM.gov, DLA, portals)
//      If the request fails, try again automatically (up to 3 times)
//      Uses exponential backoff: wait 1s, then 2s, then 4s between tries
// WHY: Government APIs go down constantly — retry logic prevents false failures
// =============================================================

// ----------------------------------------------------------
// SLEEP: Wait for a set number of milliseconds before continuing
// Used between retry attempts to avoid hammering a slow API
// ----------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------------------------------------
// FETCH WITH RETRY: Make an HTTP request, retry if it fails
// Parameters:
//   url     — the URL to fetch
//   options — standard fetch options (method, headers, body, etc.)
//   retries — how many times to retry if something goes wrong (default: 3)
//   backoff — starting delay in ms between retries (doubles each time)
// Returns the fetch Response object if successful
// Throws an error if all retries are exhausted
// ----------------------------------------------------------
async function fetchWithRetry(url, options = {}, retries = 3, backoff = 1000) {
  // Set a default 20-second timeout if none provided
  const controller = new AbortController();
  const timeoutMs  = options.timeoutMs || 20000;
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  // Merge our abort signal into the options
  const fetchOptions = {
    ...options,
    signal: controller.signal,
  };

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timer);

      // If we get a 429 (rate limited) or 5xx (server error), retry
      if ((response.status === 429 || response.status >= 500) && attempt <= retries) {
        let waitMs;
        if (response.status === 429) {
          // Respect the Retry-After header if provided, otherwise fall back to exponential backoff
          const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
          waitMs = retryAfter > 0
            ? Math.min(retryAfter * 1000, 120000)           // cap at 2 minutes
            : backoff * Math.pow(2, attempt - 1);           // 1s, 2s, 4s
          console.warn('FETCH RETRY: Rate limited (429). Waiting ' + (waitMs/1000) + 's per Retry-After header before retry ' + attempt + '/' + retries + ' — ' + url);
        } else {
          waitMs = backoff * Math.pow(2, attempt - 1);      // 1s, 2s, 4s
          console.warn('FETCH RETRY: Got ' + response.status + ' from ' + url + ' — waiting ' + (waitMs/1000) + 's before retry ' + attempt + '/' + retries);
        }
        await sleep(waitMs);
        continue;
      }

      return response;  // Success (or a 4xx we shouldn't retry)

    } catch (err) {
      clearTimeout(timer);

      // Timeout or network error — retry if we have attempts left
      if (attempt <= retries) {
        const waitMs = backoff * Math.pow(2, attempt - 1);
        const reason = err.name === 'AbortError' ? 'timeout' : err.message;
        console.warn('FETCH RETRY: ' + reason + ' for ' + url + ' — waiting ' + (waitMs/1000) + 's before retry ' + attempt + '/' + retries);
        await sleep(waitMs);
      } else {
        // All retries exhausted
        throw new Error('FETCH FAILED after ' + retries + ' retries: ' + url + ' — ' + err.message);
      }
    }
  }
}

// ----------------------------------------------------------
// FETCH JSON: Fetch a URL and automatically parse the JSON response
// Shortcut for the most common use case — getting JSON from an API
// ----------------------------------------------------------
async function fetchJSON(url, options = {}, retries = 3) {
  const response = await fetchWithRetry(url, options, retries);

  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' from ' + url);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new Error('Failed to parse JSON from ' + url + ': ' + err.message);
  }
}

// ----------------------------------------------------------
// FETCH TEXT: Fetch a URL and return the response as plain text
// Used for scraping HTML pages that don't return JSON
// ----------------------------------------------------------
async function fetchText(url, options = {}, retries = 3) {
  const response = await fetchWithRetry(url, options, retries);

  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' from ' + url);
  }

  return response.text();
}

module.exports = { fetchWithRetry, fetchJSON, fetchText, sleep };
