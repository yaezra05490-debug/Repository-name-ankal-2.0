/* אנק״ל — השרת בנטליפי. אותו חוזה בדיוק כמו apps-script/Code.gs, על אותם נתונים:
   גיליון המשתמשים/היומן/התקלות ותיקיית ANKAL_DATA ב-Drive של המנהל, דרך חשבון שירות
   שהמנהל שיתף איתו את הגיליון ואת התיקייה. הסקריפט ממשיך לעבוד במקביל (גיבויים, ניקוי).
   הלוגיקה כאן עובדת מול "מחסן" (store) שאפשר להחליף בזיכרון לבדיקות. */
import * as google from "./google.mjs";

export const SHEET_ID = () => process.env.ANKAL_SHEET_ID || "1suwQ5CDWFdjXhime_muEWgASDDE8R_h93monRv944-4";
const ROOT_FOLDER_NAME = "ANKAL_DATA";
const USERS = { tab: "משתמשים", headers: ["sub", "email", "name", "picture", "createdAt", "lastSeen", "blocked", "deletedAt", "termsVersion", "privacyVersion"] };
const LOGS = { tab: "פעולות", headers: ["at", "sub", "email", "action", "listId", "device"] };
const ERRORS = { tab: "תקלות", headers: ["at", "sub", "email", "area", "message", "userAgent"] };
const SETTINGS = { tab: "הגדרות", headers: ["key", "value", "updatedAt"] };
const TRASH_DAYS = 30;
// מזהי הלקוח של גוגל (ציבוריים): האתר והתוכנה למחשב. אפשר לדרוס/להרחיב ב-GOOGLE_CLIENT_ID (מופרד בפסיקים).
const DEFAULT_CLIENT_IDS = ["149781710735-vneicgr2u83qbdrbkhfpkcljoi8knej2.apps.googleusercontent.com", "149781710735-jmvkdivfn320fpcf5inteft1tj5issc1.apps.googleusercontent.com"];

/* ---------- מחסן: Google (ברירת מחדל) או זיכרון (בדיקות) ---------- */
function googleStore() {
  const sid = SHEET_ID();
  return {
    readTab: (t, headers) => google.ensureTab(sid, t, headers),
    appendRow: (t, headers, row) => google.appendRow(sid, t, row),
    updateCells: (t, row, cells) => google.updateCells(sid, t, row, cells),
    deleteRow: (t, row) => google.deleteRow(sid, t, row),
    listChildren: google.listChildren, createFolder: google.createFolder, readFileText: google.readFileText, writeFileText: google.writeFileText, updateMeta: google.updateMeta
  };
}
let store = null;
export function setStore(s) { store = s; }
const S = () => store || (store = googleStore());

let verifier = null;
export function setTokenVerifier(fn) { verifier = fn; }
/* זהות שאומתה נשמרת בזיכרון המופע ל-10 דקות (טוקן של גוגל תקף שעה): כל בקשה נוספת מאותו משתמש חוסכת סיבוב לגוגל */
const identityCache = new Map();
const cacheGet = (map, key, ttl) => { const hit = map.get(key); if (hit && Date.now() - hit.at < ttl) return hit.value; map.delete(key); return undefined; };
const cacheSet = (map, key, value) => { if (map.size > 500) map.clear(); map.set(key, { at: Date.now(), value }); };

export function apiError(code, message, data) { const e = new Error(code); e.code = code; e.publicMessage = message; if (data) e.data = data; return e; }
const safeText = (v, max) => String(v || "").slice(0, max);
const safeId = v => String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
const now = () => new Date().toISOString();
const isTrue = v => String(v).toLowerCase() === "true";
const cell = (row, i) => (row && row[i] !== undefined && row[i] !== null) ? row[i] : "";

/* ---------- זהות ---------- */
async function verifyGoogleToken(token) {
  if (!token) throw apiError("LOGIN_REQUIRED", "יש להיכנס באמצעות Google.");
  if (verifier) return verifier(token);
  const cached = cacheGet(identityCache, token, 600000); if (cached) return cached;
  const res = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token));
  if (!res.ok) throw apiError("INVALID_TOKEN", "אישור הכניסה פג או אינו תקין.");
  const info = await res.json();
  const allowed = String(process.env.GOOGLE_CLIENT_ID || "").split(",").map(s => s.trim()).filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_CLIENT_IDS;
  if (!list.includes(info.aud)) throw apiError("WRONG_AUDIENCE", "אישור הכניסה אינו שייך למערכת זו.");
  if (!info.sub || !info.email || info.email_verified !== "true") throw apiError("UNVERIFIED_ACCOUNT", "חשבון Google אינו מאומת.");
  const identity = { sub: String(info.sub), email: String(info.email).toLowerCase(), name: info.name || info.email, picture: info.picture || "" };
  cacheSet(identityCache, token, identity); return identity;
}
export const isAdminEmail = email => Boolean(process.env.ADMIN_EMAIL) && String(email).toLowerCase() === String(process.env.ADMIN_EMAIL).toLowerCase();
function requireAdmin(user) { if (!isAdminEmail(user.email)) throw apiError("ADMIN_ONLY", "הפעולה זמינה למנהל בלבד."); }

/* ---------- משתמשים ---------- */
async function usersRows() { return S().readTab(USERS.tab, USERS.headers); }
const rowOfSub = (rows, sub) => { for (let i = 1; i < rows.length; i++) if (String(cell(rows[i], 0)) === String(sub)) return i + 1; return 0; };
const userFromRow = r => ({ sub: String(cell(r, 0)), email: String(cell(r, 1)), name: String(cell(r, 2)), picture: String(cell(r, 3)), blocked: isTrue(cell(r, 6)), deletedAt: cell(r, 7) });
/* בלי LockService: כדי לא ליצור שורה כפולה כששתי בקשות מגיעות יחד, קוראים שוב ממש לפני ההוספה,
   ואחרי ההוספה בודקים שוב — אם בכל זאת נוצרו שתי שורות, מוחקים את המאוחרת. */
async function upsertUser(identity, extraCells) {
  let rows = await usersRows(); let row = rowOfSub(rows, identity.sub); const stamp = now();
  if (!row) {
    rows = await usersRows(); row = rowOfSub(rows, identity.sub);
    if (!row) {
      await S().appendRow(USERS.tab, USERS.headers, [identity.sub, identity.email, identity.name, identity.picture, stamp, stamp, false, "", "", ""]);
      rows = await usersRows(); row = rowOfSub(rows, identity.sub);
      const dups = []; for (let i = row; i < rows.length; i++) if (String(cell(rows[i], 0)) === String(identity.sub)) dups.push(i + 1);
      for (const d of dups.reverse()) { await S().deleteRow(USERS.tab, d); }
      if (dups.length) rows = await usersRows();
    }
  }
  const r = rows[row - 1];
  const cells = Object.assign({ 2: identity.email, 3: identity.name, 4: identity.picture, 5: cell(r, 4) || stamp, 6: stamp }, extraCells || {});
  if (cell(r, 7)) { cells[8] = ""; const folder = await userFolder(identity.sub, false); if (folder) await S().updateMeta(folder.id, { description: "" }); }
  await S().updateCells(USERS.tab, row, cells);   // עדכון אחד לכל השדות, גם גרסאות התנאים של session
  return Object.assign(userFromRow(r), { email: identity.email, name: identity.name, picture: identity.picture, deletedAt: "" });
}
async function findUserRow(sub) { const rows = await usersRows(); const row = rowOfSub(rows, sub); return row ? { row, values: rows[row - 1] } : null; }

/* ---------- Drive ---------- */
let rootCache = { id: "", at: 0 };
async function rootFolder() {
  if (process.env.ANKAL_ROOT_FOLDER_ID) return { id: process.env.ANKAL_ROOT_FOLDER_ID };
  if (rootCache.id && Date.now() - rootCache.at < 600000) return { id: rootCache.id };
  const found = await S().listChildren(null, { foldersOnly: true, name: ROOT_FOLDER_NAME });
  if (!found.length) throw google.infra("תיקיית " + ROOT_FOLDER_NAME + " לא משותפת עם חשבון השירות");
  rootCache = { id: found[0].id, at: Date.now() }; return found[0];
}
const folderCache = new Map();
async function userFolder(sub, create) {
  const hit = cacheGet(folderCache, sub, 600000); if (hit) return hit;   // מזהה התיקייה לא משתנה; חוסך סיבוב Drive בכל בקשה
  const root = await rootFolder(); const name = "user_" + safeId(sub);
  const found = await S().listChildren(root.id, { foldersOnly: true, name });
  const folder = found.length ? found[0] : (create ? await S().createFolder(root.id, name) : null);
  if (folder) cacheSet(folderCache, sub, folder);
  return folder;
}
async function readList(file) { try { return JSON.parse(await S().readFileText(file.id)); } catch (_) { return null; } }
async function listFiles(folderId) { return (await S().listChildren(folderId, { filesOnly: true })).filter(f => /^list_.*\.json$/.test(f.name)); }

/* ---------- פעולות ---------- */
// גרסאות התנאים נכתבו כבר ב-upsertUser (handle מעביר אותן), אז session לא קורא את הגיליון שוב
async function session(user) { return { user: { sub: user.sub, email: user.email, name: user.name, picture: user.picture, isAdmin: isAdminEmail(user.email), blocked: user.blocked } }; }
async function listLists(user) {
  const folder = await userFolder(user.sub, false); if (!folder) return { lists: [] };
  const items = await Promise.all((await listFiles(folder.id)).map(readList));  // קריאה במקביל: Drive עונה כשנייה לקובץ
  const lists = items.filter(item => item && !item.deletedAt);
  lists.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { lists };
}
function sanitizeList(list) {
  const out = {}; for (const key of ["id", "name", "version", "updatedAt", "createdAt", "importHashes", "separatedPairs", "deletedAt"]) out[key] = list[key] || (key === "importHashes" || key === "separatedPairs" ? [] : "");
  out.id = safeText(out.id, 120); out.name = safeText(out.name, 200);
  out.contacts = list.contacts.map(c => ({ id: safeText(c.id, 100), name: safeText(c.name, 500), mobile: safeText(c.mobile, 100), home: safeText(c.home, 100), work: safeText(c.work, 100), fax: safeText(c.fax, 100), email: safeText(c.email, 500), note: safeText(c.note, 5000), group: safeText(c.group, 100), ringtone: safeText(c.ringtone, 300) }));
  return out;
}
/* לחשבון שירות אין מכסת אחסון ב-Drive (גוגל, 2025): הוא יכול לעדכן קבצים שהמנהל הבעלים שלהם, אבל לא ליצור
   קבצים חדשים. לכן רשימה חדשה (או משתמש בלי תיקייה) נשלחת לסקריפט, שיוצר את הקובץ בבעלות המנהל; מכאן והלאה
   כל העדכונים רצים כאן. */
export function forwardToScript(reason) { const e = new Error("FORWARD_TO_SCRIPT"); e.forward = true; e.reason = reason; return e; }
async function saveList(user, payload) {
  const list = payload.list;
  if (!list || !list.id || !Array.isArray(list.contacts)) throw apiError("INVALID_LIST", "הרשימה אינה תקינה.");
  if (JSON.stringify(list).length > 5500000) throw apiError("LIST_TOO_LARGE", "הרשימה גדולה מדי לשמירה אחת.");
  const folder = await userFolder(user.sub, false); const name = "list_" + safeId(list.id) + ".json";
  if (!folder) throw forwardToScript("NEW_USER_FOLDER");
  const existing = (await S().listChildren(folder.id, { filesOnly: true, name }))[0] || null;
  if (!existing) throw forwardToScript("NEW_LIST_FILE");
  const current = await readList(existing);
  const currentVersion = Number(current && current.version || 0), expected = Number(payload.expectedVersion || 0);
  if (current && expected !== currentVersion) throw apiError("VERSION_CONFLICT", "הרשימה שונתה במקום אחר.", { list: current });
  const saved = sanitizeList(list); saved.version = currentVersion + 1; saved.ownerSub = user.sub; saved.updatedAt = now();
  await S().writeFileText(folder.id, name, JSON.stringify(saved), "ANKAL list " + saved.id, existing.id);
  return { version: saved.version, updatedAt: saved.updatedAt };
}
async function deleteList(user, payload) {
  const folder = await userFolder(user.sub, false);
  if (folder) { const file = (await S().listChildren(folder.id, { filesOnly: true, name: "list_" + safeId(payload.listId) + ".json" }))[0]; if (file) { const item = await readList(file); if (item) { item.deletedAt = now(); item.updatedAt = item.deletedAt; await S().writeFileText(folder.id, file.name, JSON.stringify(item), "ANKAL list " + item.id, file.id); } } }
  return { deleted: true };
}
async function deleteAccount(user) {
  const found = await findUserRow(user.sub); const stamp = now();
  if (found) await S().updateCells(USERS.tab, found.row, { 8: stamp });
  const folder = await userFolder(user.sub, false); if (folder) await S().updateMeta(folder.id, { description: "DELETED_AT=" + stamp });
  return { deleted: true, purgeAfterDays: TRASH_DAYS };
}
async function log(user, payload) { await S().appendRow(LOGS.tab, LOGS.headers, [payload.at || now(), user.sub, user.email, safeText(payload.action, 80), safeText(payload.listId, 100), safeText(payload.device, 30)]); return { queued: false }; }
async function error(user, payload) { await S().appendRow(ERRORS.tab, ERRORS.headers, [payload.at || now(), user.sub, user.email, safeText(payload.area, 80), safeText(payload.message, 500), safeText(payload.userAgent, 300)]); return { queued: false }; }

let statsCache = { at: 0, stats: null };
export function invalidateStats() { statsCache = { at: 0, stats: null }; }
function formatBytes(n) { if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB"; return (n / 1073741824).toFixed(2) + " GB"; }
const rowsAsObjects = (rows, limit) => { if (rows.length < 2) return []; const headers = rows[0]; return rows.slice(Math.max(1, rows.length - limit)).reverse().map(r => Object.fromEntries(headers.map((h, i) => [h, cell(r, i)]))); };
async function adminOverview(user, payload) {
  requireAdmin(user);
  const users = (await usersRows()).slice(1);
  let stats = statsCache.stats && Date.now() - statsCache.at < 600000 ? statsCache.stats : null;
  if (!stats) {
    let listCount = 0, contacts = 0, bytes = 0;
    const root = await rootFolder();
    const folders = (await S().listChildren(root.id, { foldersOnly: true })).filter(f => f.name !== "backups");
    const perFolder = await Promise.all(folders.map(f => S().listChildren(f.id, { filesOnly: true })));
    const listFilesAll = [];
    for (const files of perFolder) for (const f of files) { bytes += f.size || 0; if (/^list_/.test(f.name)) { listCount++; listFilesAll.push(f); } }
    const items = await Promise.all(listFilesAll.map(readList));
    for (const item of items) if (item && Array.isArray(item.contacts)) contacts += item.contacts.length;
    stats = { lists: listCount, contacts, storage: formatBytes(bytes) }; statsCache = { at: Date.now(), stats };
  }
  stats = Object.assign({}, stats, { users: users.length, server: "netlify" });
  const limit = Math.max(1, Math.min(Number(payload.limit || 20000), 50000));
  const names = Object.fromEntries(users.map(r => [String(cell(r, 0)), String(cell(r, 2) || "")]));
  const withNames = items => items.map(it => Object.assign(it, { name: names[String(it.sub)] || "" }));
  let items = [], total = 0;
  if (payload.tab === "logs") { const rows = await S().readTab(LOGS.tab, LOGS.headers); total = Math.max(0, rows.length - 1); items = withNames(rowsAsObjects(rows, limit)); }
  else if (payload.tab === "errors") { const rows = await S().readTab(ERRORS.tab, ERRORS.headers); total = Math.max(0, rows.length - 1); items = withNames(rowsAsObjects(rows, limit)); }
  else if (payload.tab === "trash") { items = users.filter(r => cell(r, 7)).map(r => ({ sub: cell(r, 0), email: cell(r, 1), name: cell(r, 2), deletedAt: cell(r, 7), status: "יימחק לאחר 30 יום" })); total = items.length; }
  else { items = users.map(r => ({ sub: cell(r, 0), email: cell(r, 1), name: cell(r, 2), createdAt: cell(r, 4), lastSeen: cell(r, 5), blocked: isTrue(cell(r, 6)), deletedAt: cell(r, 7), termsVersion: cell(r, 8), privacyVersion: cell(r, 9) })); total = items.length; }
  return { stats, items, total };
}
async function adminToggleBlock(user, payload) {
  requireAdmin(user); const found = await findUserRow(payload.sub); if (!found) throw apiError("USER_NOT_FOUND", "המשתמש לא נמצא.");
  await S().updateCells(USERS.tab, found.row, { 7: !isTrue(cell(found.values, 6)) }); return { updated: true };
}
async function adminUserLists(user, payload) {
  requireAdmin(user); const folder = await userFolder(payload.sub, false); if (!folder) return { lists: [] };
  const items = await Promise.all((await listFiles(folder.id)).map(readList));
  return { lists: items.filter(item => item && !item.deletedAt) };
}

/* ---------- מצב השרת (נשמר בלשונית "הגדרות" של אותו גיליון) ---------- */
let modeCache = { at: 0, mode: "" };
export async function getServerMode() {
  if (modeCache.mode && Date.now() - modeCache.at < 300000) return modeCache.mode;
  try { const rows = await S().readTab(SETTINGS.tab, SETTINGS.headers); let mode = "script"; for (let i = 1; i < rows.length; i++) if (String(cell(rows[i], 0)) === "server_mode") mode = String(cell(rows[i], 1)) === "netlify" ? "netlify" : "script"; modeCache = { at: Date.now(), mode }; return mode; }
  catch (_) { return "script"; }
}
export async function setServerMode(mode) {
  const value = mode === "netlify" ? "netlify" : "script";
  const rows = await S().readTab(SETTINGS.tab, SETTINGS.headers); let row = 0;
  for (let i = 1; i < rows.length; i++) if (String(cell(rows[i], 0)) === "server_mode") row = i + 1;
  if (row) await S().updateCells(SETTINGS.tab, row, { 2: value, 3: now() }); else await S().appendRow(SETTINGS.tab, SETTINGS.headers, ["server_mode", value, now()]);
  modeCache = { at: Date.now(), mode: value }; return value;
}
export function configStatus() { return { serviceAccount: google.serviceAccountConfigured(), serviceAccountEmail: google.serviceAccountEmail(), adminEmail: Boolean(process.env.ADMIN_EMAIL), sheetId: SHEET_ID(), rootFolderId: process.env.ANKAL_ROOT_FOLDER_ID || "", disabled: process.env.SERVER_DISABLED === "1", envMode: process.env.ANKAL_SERVER_MODE || "" }; }
async function adminServerMode(user, payload) {
  requireAdmin(user);
  if (payload.mode) await setServerMode(payload.mode);
  return Object.assign({ mode: await getServerMode() }, configStatus());
}
const ping = () => ({ server: "netlify", at: now(), alive: true });

const HANDLERS = { session, listLists, saveList, deleteList, deleteAccount, log, error, adminOverview, adminToggleBlock, adminUserLists, adminServerMode, ping };
export const ACTIONS = Object.keys(HANDLERS);

/* נקודת הכניסה: אותו מבנה תשובה כמו doPost בסקריפט. תקלת תשתית (e.infra) נזרקת החוצה כדי שהמנתב יפול לסקריפט. */
export async function handle(req) {
  try {
    if (!HANDLERS[req.action]) throw apiError("UNKNOWN_ACTION", "הפעולה אינה מוכרת.");
    if (req.action === "ping") return { ok: true, data: ping() };
    const identity = await verifyGoogleToken(req.idToken);
    const p = req.payload || {};
    const user = await upsertUser(identity, req.action === "session" ? { 9: safeText(p.termsVersion, 40), 10: safeText(p.privacyVersion, 40) } : null);
    if (user.blocked && req.action !== "session") throw apiError("ACCOUNT_BLOCKED", "החשבון חסום לסנכרון. עדיין תוכלו לעבוד מקומית ולייצא קבצים.");
    const data = await HANDLERS[req.action](user, req.payload || {});
    return { ok: true, data };
  } catch (e) {
    if (e.infra || e.forward) throw e;   // תקלת תשתית או "זה של הסקריפט": המנתב מעביר את הבקשה לסקריפט
    if (!e.code) { try { await S().appendRow(ERRORS.tab, ERRORS.headers, [now(), "", "", "netlify", safeText(String(e && (e.stack || e.message) || e), 500), ""]); } catch (_) { } }
    return { ok: false, error: e.code || "SERVER_ERROR", message: e.publicMessage || "השרת לא הצליח להשלים את הפעולה.", data: e.data || null };
  }
}
export function _reset() { store = null; verifier = null; rootCache = { id: "", at: 0 }; statsCache = { at: 0, stats: null }; modeCache = { at: 0, mode: "" }; identityCache.clear(); folderCache.clear(); }
