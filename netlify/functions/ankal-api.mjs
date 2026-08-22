/* ==================================================================
   המקום היחיד שבו מדביקים את כתובת Google Apps Script

   אפשרות מומלצת: ב-Netlify הגדירו משתנה סביבה בשם APPS_SCRIPT_URL.
   אפשרות פשוטה: החליפו את PASTE_APPS_SCRIPT_URL_HERE בכתובת שקיבלתם.
   אין להדביק כאן קוד, סיסמה או Client Secret.
   ================================================================== */
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbxPc9F_6BUF593fe4qUtCTI-o2qXue_lt6MV6BtV5ujob3ouLa6uYJUYcBK2bN-wL1ahQ/exec";

const allowedOrigins = new Set([
  "https://aivr-anshak.netlify.app",
  "http://localhost:8888",
  "http://localhost:3000",
]);

export default async (request) => {
  const origin = request.headers.get("origin") || "";
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://aivr-anshak.netlify.app",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers });
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, headers);
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(APPS_SCRIPT_URL)) {
    return json({ ok: false, error: "SERVER_NOT_CONFIGURED", message: "כתובת Google Apps Script עדיין לא הוגדרה ב-Netlify." }, 503, headers);
  }
  let raw;
  try { raw = await request.text(); JSON.parse(raw); }
  catch (_) { return json({ ok: false, error: "INVALID_JSON", message: "הבקשה אינה תקינה." }, 400, headers); }
  if (raw.length > 6_000_000) return json({ ok: false, error: "PAYLOAD_TOO_LARGE", message: "הרשימה גדולה מדי לשליחה אחת." }, 413, headers);
  try {
    const upstream = await fetch(APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: raw, redirect: "follow" });
    const text = await upstream.text();
    try { JSON.parse(text); } catch (_) { throw new Error("INVALID_APPS_SCRIPT_RESPONSE"); }
    return new Response(text, { status: upstream.ok ? 200 : 502, headers });
  } catch (error) {
    return json({ ok: false, error: "UPSTREAM_UNAVAILABLE", message: "השרת אינו זמין כרגע. השינויים נשמרו במחשב ויישלחו שוב." }, 502, headers);
  }
};

function json(value, status, headers) { return new Response(JSON.stringify(value), { status, headers }); }

