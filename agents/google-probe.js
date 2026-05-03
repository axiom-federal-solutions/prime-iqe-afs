// =============================================================
// AGENTS/GOOGLE-PROBE.JS — One-shot OAuth + Drive smoke test
// JOB: Prove that GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
//      are set up correctly. Calls 3 Google APIs in sequence:
//        1. OAuth token exchange (proves client + refresh token work)
//        2. Drive `about` endpoint (proves Drive API is enabled, auth scope is right)
//        3. Drive list 5 most recent files (proves we can actually read user data)
// USED WHEN: After adding Google secrets to GitHub, before relying on the
//            full bid-draft automation. Run from Actions tab manually.
// COST: $0
// SAFETY: Logs only metadata (user email, file names) — never the token itself.
// =============================================================

const { logAction } = require('../lib/supabase');
const { getAccessToken, googleFetch } = require('../lib/google-auth');

async function run() {
  console.log('GOOGLE PROBE: Starting Google OAuth + Drive smoke test...');
  const results = { auth: false, about: null, files: [] };

  // ── Step 1: OAuth token exchange ─────────────────────────────────
  let token;
  try {
    token = await getAccessToken();
    results.auth = true;
    console.log('GOOGLE PROBE: ✅ OAuth token exchange succeeded (length: ' + token.length + ')');
  } catch (err) {
    console.error('GOOGLE PROBE: ❌ OAuth FAILED —', err.message);
    await logAction('GOOGLE PROBE', 'OAuth token exchange failed', { error: err.message });
    process.exit(1);
  }

  // ── Step 2: Drive `about` — confirms Drive API is enabled + scope correct ─
  try {
    const aboutRes = await googleFetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota');
    const about    = await aboutRes.json();
    results.about  = {
      user_name:  about.user?.displayName,
      user_email: about.user?.emailAddress,
      storage:    about.storageQuota ? `${Math.round(about.storageQuota.usage/1e9*10)/10}GB / ${Math.round(about.storageQuota.limit/1e9)}GB` : 'unknown',
    };
    console.log('GOOGLE PROBE: ✅ Drive `about` succeeded — authenticated as ' + about.user?.emailAddress);
  } catch (err) {
    console.error('GOOGLE PROBE: ❌ Drive `about` FAILED —', err.message);
    await logAction('GOOGLE PROBE', 'Drive about failed', { error: err.message });
    process.exit(1);
  }

  // ── Step 3: List 5 most recent files in Drive ─────────────────────
  try {
    const listRes = await googleFetch('https://www.googleapis.com/drive/v3/files?pageSize=5&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime)');
    const list    = await listRes.json();
    results.files = (list.files || []).map(f => ({
      name:      f.name,
      mime:      f.mimeType,
      modified:  f.modifiedTime,
    }));
    console.log('GOOGLE PROBE: ✅ Drive file list succeeded — ' + results.files.length + ' recent files');
    results.files.forEach(f => console.log('  • ' + f.name + ' (' + f.mime + ')'));
  } catch (err) {
    console.error('GOOGLE PROBE: ❌ Drive list FAILED —', err.message);
    await logAction('GOOGLE PROBE', 'Drive file list failed', { error: err.message });
    process.exit(1);
  }

  // ── All three checks passed — log success ────────────────────────
  console.log('');
  console.log('GOOGLE PROBE: ✅ ALL CHECKS PASSED');
  console.log('GOOGLE PROBE: User: ' + results.about.user_email);
  console.log('GOOGLE PROBE: Storage: ' + results.about.storage);
  console.log('GOOGLE PROBE: Recent files: ' + results.files.length);

  await logAction('GOOGLE PROBE', 'OAuth + Drive smoke test passed', {
    auth_ok:        true,
    user_email:     results.about.user_email,
    user_name:      results.about.user_name,
    storage:        results.about.storage,
    recent_files:   results.files.length,
    sample_files:   results.files.map(f => f.name),
    message:        'Drive + OAuth confirmed working. Safe to proceed with draft-bid agent.',
  });
}

run().catch(err => {
  console.error('GOOGLE PROBE: Unhandled error —', err);
  process.exit(1);
});
