// =============================================================
// LIB/GOOGLE-DRIVE.JS — Drive v3 API helpers (minimal, no SDK)
// JOB: Create folders, copy template files, list/find existing files,
//      generate shareable links. All using fetch via google-auth.js.
// USED BY: agents/draft-bid.js
// SCOPE NEEDED: drive.file (limited to files this app creates/opens)
// =============================================================

const { googleFetch } = require('./google-auth');

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/**
 * Find a folder by name (top of My Drive). Returns the folder id, or null
 * if not found. Uses drive.file scope which sees only files this app
 * created — so we'll only find folders we (the app) made before.
 */
async function findFolder(name) {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`;
  const res = await googleFetch(url);
  const data = await res.json();
  return (data.files && data.files[0]) ? data.files[0].id : null;
}

/**
 * Get-or-create a folder at the top level of My Drive (under the app's scope).
 * Returns the folder id. Idempotent — won't create duplicates.
 */
async function ensureFolder(name) {
  const existing = await findFolder(name);
  if (existing) return existing;
  const res = await googleFetch(`${DRIVE_API}/files?fields=id,name`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const data = await res.json();
  return data.id;
}

/**
 * Copy a Drive file (e.g. a template Sheet) into a destination folder.
 * Returns the new file's id.
 */
async function copyFile(sourceFileId, newName, destFolderId) {
  const res = await googleFetch(`${DRIVE_API}/files/${sourceFileId}/copy?fields=id,name,webViewLink`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name:    newName,
      parents: destFolderId ? [destFolderId] : undefined,
    }),
  });
  return await res.json();
}

/**
 * Create a new Google Sheet inside a folder.
 * Sheets are special — created via the Sheets API but file metadata moves
 * via Drive. We create the sheet first, then move it to the folder.
 */
async function createSheetInFolder(name, folderId) {
  // Step 1: create the sheet
  const createRes = await googleFetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ properties: { title: name } }),
  });
  const sheet = await createRes.json();
  const sheetId = sheet.spreadsheetId;

  // Step 2: move it into the target folder (Drive API)
  if (folderId) {
    // Get current parents to remove from
    const getRes = await googleFetch(`${DRIVE_API}/files/${sheetId}?fields=parents`);
    const meta   = await getRes.json();
    const removeParents = (meta.parents || []).join(',');
    const moveUrl = `${DRIVE_API}/files/${sheetId}?addParents=${encodeURIComponent(folderId)}&removeParents=${encodeURIComponent(removeParents)}&fields=id,parents,webViewLink`;
    await googleFetch(moveUrl, { method: 'PATCH' });
  }

  return {
    spreadsheetId: sheetId,
    spreadsheetUrl: sheet.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheetId}`,
  };
}

/**
 * Read a single file's metadata (id, name, webViewLink).
 */
async function getFileMeta(fileId) {
  const res = await googleFetch(`${DRIVE_API}/files/${fileId}?fields=id,name,webViewLink,modifiedTime,parents`);
  return await res.json();
}

module.exports = { findFolder, ensureFolder, copyFile, createSheetInFolder, getFileMeta };
