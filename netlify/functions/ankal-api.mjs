/* ==================================================================
   נקודת הכניסה של האתר לשרת. שני שרתים עם אותו חוזה ואותם נתונים:
     • Google Apps Script (הכתובת למטה / APPS_SCRIPT_URL) — ברירת המחדל.
     • השרת בנטליפי (lib/ankal-server.mjs) — כשהמנהל בחר "netlify" באתר הניהול.
   הבחירה נשמרת בלשונית "הגדרות" של הגיליון, ו-ANKAL_SERVER_MODE במשתני הסביבה גובר.
   אם השרת בנטליפי לא מוגדר או שגוגל לא עונה — נופלים אוטומטית לסקריפט.
   אין להדביק כאן סיסמה או Client Secret.
   ================================================================== */
import * as server from "./lib/ankal-server.mjs";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbxPc9F_6BUF593fe4qUtCTI-o2qXue_lt6MV6BtV5ujob3ouLa6uYJUYcBK2bN-wL1ahQ/exec";

const allowedOrigins = new Set(["https://aivr-anshak.netlify.app", "http://localhost:8888", "http://localhost:3000"]);
const LOCAL_ONLY = new Set(["adminServerMode"]); // תמיד בנטליקי: זה המתג עצמו

export default async (request) => {
  const origin = request.headers.get("origin") || "";
  const headers = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://aivr-anshak.netlify.app", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers });
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, headers);
  let raw, req;
  try { raw = await request.text(); req = JSON.parse(raw); }
  catch (_) { return json({ ok: false, error: "INVALID_JSON", message: "הבקשה אינה תקינה." }, 400, headers); }
  if (raw.length > 6_000_000) return json({ ok: false, error: "PAYLOAD_TOO_LARGE", message: "הרשימה גדולה מדי לשליחה אחת." }, 413, headers);

  const force = req.action === "ping" ? String(req.payload?.forceServer || "") : "";
  const disabled = process.env.SERVER_DISABLED === "1";
  let mode = force || process.env.ANKAL_SERVER_MODE || "";
  if (!mode && !disabled) mode = await server.getServerMode();
  const useNetlify = LOCAL_ONLY.has(req.action) || (mode === "netlify" && !disabled);

  if (useNetlify) {
    let failure = null;
    try { const out = await server.handle(req); return json(Object.assign(out, { server: "netlify" }), 200, headers); }
    catch (e) { failure = e; if (LOCAL_ONLY.has(req.action) || force === "netlify") return json({ ok: false, error: "NETLIFY_SERVER_ERROR", message: "השרת בנטליפי לא מוגדר או שגוגל לא ענה: " + (e.message || e), server: "netlify" }, 200, headers); }
    // רשימה חדשה נוצרת רק בסקריפט (לחשבון שירות אין מכסת אחסון); תקלת תשתית נופלת לסקריפט ומסומנת ככזו
    return forward(raw, req, headers, failure.forward ? "script" : "script-fallback");
  }
  return forward(raw, req, headers, "script");
};

async function forward(raw, req, headers, label) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(APPS_SCRIPT_URL)) return json({ ok: false, error: "SERVER_NOT_CONFIGURED", message: "כתובת Google Apps Script עדיין לא הוגדרה ב-Netlify." }, 503, headers);
  const started = Date.now();
  try {
    const upstream = await fetch(APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: raw, redirect: "follow" });
    const text = await upstream.text();
    let body; try { body = JSON.parse(text); } catch (_) { throw new Error("INVALID_APPS_SCRIPT_RESPONSE"); }
    // לסקריפט אין ping: תשובת JSON תקינה (גם "פעולה לא מוכרת") פירושה שהוא חי
    if (req.action === "ping") body = { ok: true, data: { server: "script", alive: true, latencyMs: Date.now() - started, at: new Date().toISOString() } };
    body.server = label;
    return json(body, upstream.ok ? 200 : 502, headers);
  } catch (error) {
    return json({ ok: false, error: "UPSTREAM_UNAVAILABLE", message: "השרת אינו זמין כרגע. השינויים נשמרו במחשב ויישלחו שוב.", server: label }, 502, headers);
  }
}
function json(value, status, headers) { return new Response(JSON.stringify(value), { status, headers }); }
