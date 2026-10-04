/* גישה ל-Google Sheets ו-Drive עם חשבון שירות, בלי ספריות חיצוניות.
   JWT חתום RS256 → access token (נשמר בזיכרון עד שפג) → קריאות REST.
   אותה גישה כמו בשרת של "אתגר בחדר". כאן רק פרימיטיבים; הלוגיקה ב-ankal-server.mjs. */
import crypto from "node:crypto";

const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive";
let tokenCache = { token: "", exp: 0 };
const b64url = buf => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function serviceAccountConfigured() { return Boolean(process.env.GOOGLE_SA_JSON); }
function loadServiceAccount() {
  const raw = process.env.GOOGLE_SA_JSON || "";
  if (!raw) throw infra("חסר GOOGLE_SA_JSON (מפתח חשבון השירות) במשתני הסביבה של Netlify");
  let sa; try { sa = JSON.parse(raw); } catch (_) { throw infra("GOOGLE_SA_JSON אינו JSON תקין"); }
  if (!sa.client_email || !sa.private_key) throw infra("GOOGLE_SA_JSON אינו מפתח חשבון שירות תקין");
  return sa;
}
/* תקלת תשתית (אין מפתח, גוגל לא עונה) — שונה משגיאת לקוח: המנתב נופל חזרה לסקריפט */
export function infra(message) { const e = new Error(message); e.infra = true; return e; }

export async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
  const sa = loadServiceAccount();
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPES, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(header + "." + claim), sa.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: header + "." + claim + "." + b64url(sig) }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw infra("קבלת טוקן מגוגל נכשלה: " + JSON.stringify(data).slice(0, 300));
  tokenCache = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) };
  return tokenCache.token;
}
export function serviceAccountEmail() { try { return loadServiceAccount().client_email; } catch (_) { return ""; } }

async function gapi(method, url, body, rawBody) {
  const token = await accessToken();
  const headers = { Authorization: "Bearer " + token };
  let payload;
  if (rawBody) { headers["Content-Type"] = rawBody.type; payload = rawBody.body; }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!res.ok) { const e = new Error("Google API " + res.status + ": " + ((data.error && data.error.message) || text || res.statusText)); e.status = res.status; e.infra = res.status >= 500 || res.status === 401 || res.status === 403; throw e; }
  return data;
}

/* ---------------- Sheets ---------------- */
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/";
const enc = encodeURIComponent;
let tabsCache = { id: "", at: 0, tabs: null };
async function listTabs(spreadsheetId, force) {
  if (!force && tabsCache.id === spreadsheetId && Date.now() - tabsCache.at < 120000 && tabsCache.tabs) return tabsCache.tabs;
  const data = await gapi("GET", SHEETS + enc(spreadsheetId) + "?fields=sheets.properties(sheetId,title)");
  const tabs = {}; (data.sheets || []).forEach(s => { tabs[s.properties.title] = s.properties; });
  tabsCache = { id: spreadsheetId, at: Date.now(), tabs }; return tabs;
}
export async function readAll(spreadsheetId, tab) {
  const data = await gapi("GET", SHEETS + enc(spreadsheetId) + "/values/" + enc("'" + tab + "'") + "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING");
  return data.values || [];
}
export async function appendRow(spreadsheetId, tab, row) {
  await gapi("POST", SHEETS + enc(spreadsheetId) + "/values/" + enc("'" + tab + "'!A1") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", { values: [row] });
}
export async function updateCells(spreadsheetId, tab, rowIndex1, cells) {
  const data = Object.keys(cells).map(c => ({ range: "'" + tab + "'!" + colLetter(Number(c)) + rowIndex1, values: [[cells[c]]] }));
  if (data.length) await gapi("POST", SHEETS + enc(spreadsheetId) + "/values:batchUpdate", { valueInputOption: "RAW", data });
}
export async function deleteRow(spreadsheetId, tab, rowIndex1) {
  const props = (await listTabs(spreadsheetId))[tab]; if (!props) throw new Error("הלשונית " + tab + " לא נמצאה");
  await gapi("POST", SHEETS + enc(spreadsheetId) + ":batchUpdate", { requests: [{ deleteDimension: { range: { sheetId: props.sheetId, dimension: "ROWS", startIndex: rowIndex1 - 1, endIndex: rowIndex1 } } }] });
}
/* יוצר לשונית אם חסרה (עם כותרות ושורה קפואה, כמו sheet_ בסקריפט) ומחזיר את כל הערכים */
export async function ensureTab(spreadsheetId, tab, headers) {
  const tabs = await listTabs(spreadsheetId);
  // כתיבת ערכים לטווח היא PUT (values.update); POST לאותה כתובת מחזיר דף HTML של 400
  const writeHeaders = () => gapi("PUT", SHEETS + enc(spreadsheetId) + "/values/" + enc("'" + tab + "'!A1") + "?valueInputOption=RAW", { values: [headers] });
  if (!tabs[tab]) {
    await gapi("POST", SHEETS + enc(spreadsheetId) + ":batchUpdate", { requests: [{ addSheet: { properties: { title: tab, rightToLeft: true, gridProperties: { frozenRowCount: 1 } } } }] });
    await writeHeaders();
    await listTabs(spreadsheetId, true);
    return [headers];
  }
  const values = await readAll(spreadsheetId, tab);
  if (!values.length) { await writeHeaders(); return [headers]; }
  return values;
}
export function colLetter(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/* ---------------- Drive ---------------- */
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const q = s => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const FIELDS = "files(id,name,mimeType,size,description,createdTime,modifiedTime)";
export async function listChildren(parentId, { foldersOnly = false, filesOnly = false, name = "" } = {}) {
  const parts = ["trashed=false"];
  if (parentId) parts.push(`'${q(parentId)}' in parents`);
  if (foldersOnly) parts.push(`mimeType='${FOLDER}'`); if (filesOnly) parts.push(`mimeType!='${FOLDER}'`);
  if (name) parts.push(`name='${q(name)}'`);
  const out = []; let pageToken = "";
  do {
    const data = await gapi("GET", DRIVE + "?q=" + enc(parts.join(" and ")) + "&fields=nextPageToken," + enc(FIELDS) + "&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true" + (pageToken ? "&pageToken=" + enc(pageToken) : ""));
    out.push(...(data.files || [])); pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out.map(f => ({ id: f.id, name: f.name, isFolder: f.mimeType === FOLDER, size: Number(f.size) || 0, description: f.description || "", createdTime: f.createdTime || "", modifiedTime: f.modifiedTime || "" }));
}
export async function createFolder(parentId, name) {
  const data = await gapi("POST", DRIVE + "?supportsAllDrives=true", { name, mimeType: FOLDER, parents: parentId ? [parentId] : undefined });
  return { id: data.id, name, isFolder: true, description: "" };
}
export async function readFileText(id) {
  const token = await accessToken();
  const res = await fetch(DRIVE + "/" + enc(id) + "?alt=media&supportsAllDrives=true", { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) { const e = new Error("Google Drive " + res.status); e.status = res.status; e.infra = res.status >= 500; throw e; }
  return await res.text();
}
export async function writeFileText(parentId, name, text, description, existingId) {
  const boundary = "ankal" + crypto.randomBytes(8).toString("hex");
  const meta = existingId ? { name, description } : { name, description, mimeType: "text/plain", parents: [parentId] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const url = existingId ? `https://www.googleapis.com/upload/drive/v3/files/${enc(existingId)}?uploadType=multipart&supportsAllDrives=true` : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
  const data = await gapi(existingId ? "PATCH" : "POST", url, undefined, { type: "multipart/related; boundary=" + boundary, body });
  return { id: data.id || existingId };
}
export async function updateMeta(id, meta) { await gapi("PATCH", DRIVE + "/" + enc(id) + "?supportsAllDrives=true", meta); }

export function _resetCaches() { tokenCache = { token: "", exp: 0 }; tabsCache = { id: "", at: 0, tabs: null }; }
