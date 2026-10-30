/* הקלטות שיחה — הלוגיקה, בלי ממשק: זיהוי שם קובץ, מזהה קבוע להקלטה, מיזוג סריקה של תיקייה לארכיון, השלמת
   מי ומה מאנשי הקשר ומהיומן, סינון, סיכומים (לפי יום / אדם / חודש / שעה), בקשות ל-AI ופענוח התשובות, גיבוי
   וייצוא. הממשק ב-recordings.js; הפורמט של הקיוליקס (WAV, יומן, אנשי קשר) ב-qualix.js. נבדק ב-tests/recordings.test.js. */
(function (root) {
  "use strict";
  const Q = root.ANKAL_QUALIX || (typeof require === "function" ? require("./qualix.js") : null);
  const pad2 = n => String(n).padStart(2, "0");
  const AUDIO = /\.(wav|mp3|m4a|aac|amr|3gp|ogg|oga|opus|flac|webm|mp4|wma)$/i;
  const PREFIX = /^(call[ _\-]?recording|recording|rec|voice|הקלטה|הקלטת שיחה|שיחה)[\s_\-]*/i;
  const HE_WD = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const HE_MON = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

  /* ---------- שם קובץ → מי ומתי ----------
     הקיוליקס: <שם או מספר>_YYYYMMDDHHMMSS. טלפונים אחרים כותבים את התאריך בצורות אחרות (2026-10-30 09-43-32,
     261030_094332), לפעמים עם "הקלטה"/"Call recording" לפני ומספר בסוגריים. בלי תאריך בשם — זמן הקובץ.
     time = שניות מ-1980 בשעון הקיר (כמו ביומן של הטלפון), iso = אותו רגע כטקסט. */
  function validParts(y, mo, d, h, mi, s) { return y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59 ? null : { year: y, month: mo, day: d, hour: h, minute: mi, second: s }; }
  function partsOfDate(ms) { const d = new Date(ms); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() }; }
  function parseFileName(fileName, lastModified) {
    const name = String(fileName || ""); if (!AUDIO.test(name)) return null;
    const stem = name.replace(/\.[^.]+$/, ""); let m, who = "", parts = null;
    if ((m = /^(.*?)[\s_\-]*(\d{4})(\d{2})(\d{2})[_\-\s]?(\d{2})(\d{2})(\d{2})$/.exec(stem))) { parts = validParts(+m[2], +m[3], +m[4], +m[5], +m[6], +m[7]); who = m[1]; }
    if (!parts && (m = /(\d{4})[-_.](\d{2})[-_.](\d{2})[\sT_\-]+(\d{2})[-_.:](\d{2})[-_.:](\d{2})/.exec(stem))) { parts = validParts(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]); who = stem.replace(m[0], " "); }
    if (!parts && (m = /(?:^|\D)(\d{2})(\d{2})(\d{2})[_\-](\d{2})(\d{2})(\d{2})(?:\D|$)/.exec(stem))) { parts = validParts(2000 + +m[1], +m[2], +m[3], +m[4], +m[5], +m[6]); who = stem.replace(m[0].replace(/^\D|\D$/g, ""), " "); }
    const stamped = !!parts; if (!parts) { parts = partsOfDate(lastModified || Date.now()); who = stem; }
    who = who.trim(); const prefixed = PREFIX.test(who);
    who = who.replace(PREFIX, "").replace(/_+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s\-@]+|[\s\-@]+$/g, "").trim();
    let number = ""; const pm = /^(.*?)\s*[(\[]\s*(\+?[\d\s\-]{5,})\s*[)\]]$/.exec(who); if (pm) { number = pm[2].replace(/[\s\-]/g, ""); who = pm[1].trim(); }
    if (/^\+?[\d\s\-]{3,}$/.test(who)) { if (!number) number = who.replace(/[\s\-]/g, ""); who = ""; }
    // "REC_0007" או "הקלטה 12" — מספור של הטלפון, לא מספר טלפון
    if (number && number.replace(/\D/g, "").length < 5 && (prefixed || !stamped)) number = "";
    const time = Q.partsToPhoneTime(parts);
    return { fileName: name, name: who, number, time, iso: Q.phoneTimeToIso(time), stamped };
  }
  /* מזהה קבוע: תאריך ושעה + מי — לא הגודל, כדי שאותה הקלטה שהועברה למחשב (גם אחרי המרה ל-WAV רגיל) תישאר
     אותה רשומה עם התמלול והסיכום שלה. בלי תאריך בשם — שם הקובץ והגודל. */
  function recordId(p, size) { return p.stamped ? `${p.iso}|${p.number || p.name}` : `${p.fileName}|${size}`; }

  /* ---------- מספרים ושמות ---------- */
  // מספר בלי שלוחה: נייד ו-07 בני 10 ספרות, קווי 9, 1-800 בני 10
  function baseNumber(n) { const d = Q.localNumber(n); if (/^0[57]\d{8}/.test(d) || /^1[5-9]00\d{6}/.test(d)) return d.slice(0, 10); if (/^0[23489]\d{7}/.test(d)) return d.slice(0, 9); return d; }
  function formatPhone(n) {
    const d = baseNumber(n); if (!d) return "";
    const ext = Q.localNumber(n).slice(d.length), tail = ext ? ` שלוחה ${ext}` : "";
    if (/^0[57]\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}${tail}`;
    if (/^0[23489]\d{7}$/.test(d)) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}${tail}`;
    if (/^1[5-9]00\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}${tail}`;
    return String(n);
  }
  // מפתח איש הקשר — לשינוי שם (כינוי) ולאיחוד: שם מאנשי הקשר, או המספר בלי שלוחה, או השם שבקובץ
  function contactKey(r) { if (r.contactName) return "name:" + r.contactName; if (r.number) return "tel:" + baseNumber(r.number); return "name:" + (r.src?.name || ""); }
  function displayName(r, aliases) { const k = contactKey(r); return (aliases && aliases[k]) || r.contactName || r.src?.name || formatPhone(r.number) || "לא ידוע"; }
  const norm = s => String(s ?? "").toLowerCase().replace(/[֑-ׇ]/g, "").replace(/[׳'"״`]/g, "").replace(/\s+/g, " ").trim();

  /* ---------- הארכיון: רשומה לכל הקלטה, עם המקומות שבהם הקובץ נמצא ----------
     loc = [{ folder: "card" | מזהה תיקייה במחשב, rel, size }]. הרשומה נשארת גם כשהקובץ כבר לא נמצא (התמלול
     והסיכום לא הולכים לאיבוד), ופשוט אי אפשר להשמיע אותה עד שהקובץ חוזר. */
  function newRecord(p, file, folder) {
    return { id: recordId(p, file.size), fileName: p.fileName, src: { name: p.name, number: p.number }, number: p.number, contactName: "", type: "", inLog: false, time: p.time, iso: p.iso, stamped: p.stamped, size: file.size, duration: file.duration || 0, loc: [{ folder, rel: file.rel, size: file.size }], added: Date.now(), star: false, tags: [], note: "" };
  }
  /* סריקה של תיקייה אחת: files = [{ name, rel, size, mtime, duration? }]. הקלטה חדשה נכנסת; קיימת מקבלת את
     המקום הזה (גם אם הועברה לכאן ממקום אחר); הקלטה שהייתה בתיקייה הזו ואיננה — מאבדת רק את המקום הזה.
     קבצים ריקים (הטלפון משאיר כאלה) לא נכנסים לארכיון — הם חוזרים ב-empty לניקוי. */
  function mergeScan(byId, folder, files) {
    const seen = new Set(), added = [], changed = new Map(), empty = [];
    for (const f of files) {
      const p = parseFileName(f.name, f.mtime); if (!p) continue;
      if (!f.size) { empty.push(Object.assign({}, f, { iso: p.iso })); continue; }
      const id = recordId(p, f.size); if (seen.has(id)) continue; seen.add(id);
      const r = byId.get(id);
      if (!r) { const n = newRecord(p, f, folder); byId.set(id, n); added.push(n); continue; }
      const here = r.loc.find(l => l.folder === folder);
      if (!here || here.rel !== f.rel || here.size !== f.size) { r.loc = r.loc.filter(l => l.folder !== folder).concat({ folder, rel: f.rel, size: f.size }); changed.set(id, r); }
      if (!r.duration && f.duration) { r.duration = f.duration; changed.set(id, r); }
    }
    for (const r of byId.values()) if (!seen.has(r.id) && r.loc.some(l => l.folder === folder)) { r.loc = r.loc.filter(l => l.folder !== folder); changed.set(r.id, r); }
    return { added, changed: [...changed.values()].filter(r => !added.includes(r)), empty };
  }
  /* השלמה מאנשי הקשר ומהיומן (Q.describeRecordings). מה שכבר נלמד נשמר: יומן חדש כבר לא זוכר שיחות ישנות,
     וזה לא סיבה לשכוח שהשיחה הייתה נכנסת. מחזיר את הרשומות שהשתנו. */
  function enrich(recs, ctx) {
    const d = Q.describeRecordings(recs.map(r => ({ name: r.src.name, number: r.src.number, time: r.time })), ctx), changed = [];
    recs.forEach((r, i) => {
      const x = d[i], next = { number: r.src.number || x.number || r.number || "", contactName: x.contactName || r.contactName || "", type: x.type || r.type || "", inLog: x.inLog || r.inLog || false };
      if (Object.keys(next).some(k => next[k] !== r[k])) { Object.assign(r, next); changed.push(r); }
    });
    return changed;
  }

  /* ---------- תכונות לתצוגה (לא נשמרות): מי, יום, שעה, יום בשבוע, חודש ---------- */
  function prep(r, aliases) {
    const day = r.iso.slice(0, 10), [y, mo, d] = day.split("-").map(Number);
    r._ = { who: displayName(r, aliases), key: contactKey(r), saved: !!(r.contactName || (aliases && aliases[contactKey(r)]) || r.src.name), day, month: day.slice(0, 7), hour: +r.iso.slice(11, 13), wd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), blob: null };
    return r;
  }
  const strip = r => { const o = Object.assign({}, r); delete o._; return o; };
  function blobOf(r) {
    if (r._.blob != null) return r._.blob;
    const s = r.sum, parts = [r._.who, r.src.name, r.contactName, Q.localNumber(r.number), r.note, (r.tags || []).join(" ")];
    if (s) parts.push(s.title, s.summary, (s.points || []).join(" "), (s.actions || []).join(" "), (s.dates || []).join(" "), (s.tags || []).join(" "));
    if (r.tr) parts.push(r.tr.segs.map(x => x.t).join(" "));
    return (r._.blob = norm(parts.join(" \n ")));
  }
  const tagsOf = r => [...new Set([...(r.tags || []), ...(r.sum?.tags || [])])];

  /* ---------- סינון ---------- */
  const DUR = { any: ["כל משך", 0, Infinity], gt10: ["מעל 10 שניות", 10, Infinity], gt60: ["מעל דקה", 60, Infinity], gt300: ["מעל 5 דקות", 300, Infinity], gt900: ["מעל 15 דקות", 900, Infinity], lt10: ["קצרות (עד 10 שנ׳)", 0, 10], lt60: ["עד דקה", 0, 60] };
  const TOD = { any: ["כל שעות היום", 0, 24], morning: ["בוקר 06–12", 6, 12], noon: ["צהריים 12–17", 12, 17], evening: ["ערב 17–22", 17, 22], night: ["לילה 22–06", 22, 6] };
  const STATUS = { any: "כל ההקלטות", tr: "עם תמלול", sum: "עם סיכום", notr: "בלי תמלול", star: "מועדפות", note: "עם הערה", gone: "קובץ לא נמצא" };
  const KIND = { any: "כל אנשי הקשר", named: "אנשי קשר שמורים", tel: "מספרים לא שמורים" };
  const DIR = { any: "כל הכיוונים", incoming: "↙ נכנסות", outgoing: "↗ יוצאות", unknown: "כיוון לא ידוע" };
  const SORT = { new: "מהחדש לישן", old: "מהישן לחדש", long: "הארוכות קודם", short: "הקצרות קודם" };
  const DATES = [["all", "הכל"], ["today", "היום"], ["yesterday", "אתמול"], ["7d", "7 ימים"], ["30d", "30 יום"], ["month", "החודש"], ["custom", "טווח…"]];
  function defaultFilter() { return { q: "", date: "all", from: "", to: "", contacts: [], dur: "any", tod: "any", status: "any", kind: "any", dir: "any", tag: "", wd: [], sort: "new", ids: null, idsLabel: "" }; }
  function localDay(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function addDays(day, n) { const [y, m, d] = day.split("-").map(Number); return localDay(new Date(y, m - 1, d + n).getTime()); }
  function dateRange(f, now) {
    const today = localDay(now || Date.now()), d = new Date(now || Date.now());
    switch (f.date) {
      case "today": return [today, today]; case "yesterday": return [addDays(today, -1), addDays(today, -1)];
      case "7d": return [addDays(today, -6), today]; case "30d": return [addDays(today, -29), today];
      case "month": return [`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`, today];
      case "custom": return [f.from || "", f.to || ""];
      default: return ["", ""];
    }
  }
  // כמה מסננים "נסתרים" (בשורה השנייה) פעילים — למונה ליד "עוד מסננים"
  function hiddenCount(f) { return (f.tod !== "any") + (f.kind !== "any") + (f.dir !== "any") + !!f.tag + (f.wd.length ? 1 : 0); }
  function isFiltered(f) { const d = defaultFilter(); return ["q", "date", "dur", "tod", "status", "kind", "dir", "tag"].some(k => f[k] !== d[k]) || f.contacts.length || f.wd.length || !!f.ids; }
  function filterRecs(recs, f, { hideShort = 0, now } = {}) {
    const terms = norm(f.q).split(" ").filter(Boolean).map(t => /^[\d\-+]+$/.test(t) ? t.replace(/[\-+]/g, "") : t).filter(Boolean);
    const [from, to] = dateRange(f, now), [, dmin, dmax] = DUR[f.dur] || DUR.any, [, h0, h1] = TOD[f.tod] || TOD.any;
    const cs = f.contacts.length ? new Set(f.contacts) : null, wd = f.wd.length ? new Set(f.wd) : null;
    const out = [];
    for (const r of recs) {
      const x = r._;
      if (f.ids && !f.ids.has(r.id)) continue;
      if (hideShort && r.duration < hideShort && !cs && !f.ids) continue;
      if (from && x.day < from) continue; if (to && x.day > to) continue;
      if (cs && !cs.has(x.who)) continue;
      if (r.duration < dmin || r.duration >= dmax) continue;
      if (f.tod !== "any" && (h0 < h1 ? (x.hour < h0 || x.hour >= h1) : (x.hour < h0 && x.hour >= h1))) continue;
      if (wd && !wd.has(x.wd)) continue;
      if (f.kind === "named" && !x.saved) continue; if (f.kind === "tel" && x.saved) continue;
      if (f.dir !== "any" && (f.dir === "unknown" ? !!r.type : r.type !== f.dir)) continue;
      if (f.status === "tr" && !r.tr) continue; if (f.status === "sum" && !r.sum) continue; if (f.status === "notr" && r.tr) continue;
      if (f.status === "star" && !r.star) continue; if (f.status === "note" && !r.note) continue; if (f.status === "gone" && r.loc.length) continue;
      if (f.tag && !tagsOf(r).includes(f.tag)) continue;
      if (terms.length) { const b = blobOf(r); if (!terms.every(t => b.includes(t))) continue; }
      out.push(r);
    }
    const by = { new: (a, b) => b.time - a.time, old: (a, b) => a.time - b.time, long: (a, b) => b.duration - a.duration, short: (a, b) => a.duration - b.duration }[f.sort] || ((a, b) => b.time - a.time);
    return out.sort(by);
  }

  /* ---------- סיכומים ---------- */
  function byDay(list) { const m = new Map(); for (const r of list) { let a = m.get(r._.day); if (!a) m.set(r._.day, a = { n: 0, s: 0, recs: [] }); a.n++; a.s += r.duration || 0; a.recs.push(r); } return m; }
  const heat = sec => !sec ? 0 : sec < 600 ? 1 : sec < 1800 ? 2 : sec < 3600 ? 3 : sec < 7200 ? 4 : 5;
  function people(list, months) {
    const mi = new Map((months || []).map((m, i) => [m, i])), m = new Map();
    for (const r of list) {
      let c = m.get(r._.who);
      if (!c) m.set(r._.who, c = { who: r._.who, key: r._.key, saved: r._.saved, number: "", n: 0, s: 0, last: 0, first: Infinity, ai: 0, mon: new Array(mi.size).fill(0) });
      c.n++; c.s += r.duration || 0; if (r.time > c.last) c.last = r.time; if (r.time < c.first) c.first = r.time; if (r.sum) c.ai++; if (!c.number && r.number) c.number = r.number;
      if (mi.has(r._.month)) c.mon[mi.get(r._.month)] += r.duration || 0;
    }
    return [...m.values()];
  }
  const monthsOf = list => [...new Set(list.map(r => r._.month))].sort();
  const BUCKETS = [["עד 10 שנ׳", 10], ["10–60 שנ׳", 60], ["1–5 דק׳", 300], ["5–15 דק׳", 900], ["15–30 דק׳", 1800], ["מעל 30 דק׳", Infinity]];
  function stats(list) {
    if (!list.length) return null;
    const total = list.reduce((a, r) => a + (r.duration || 0), 0), sorted = list.map(r => r.duration || 0).sort((a, b) => a - b);
    const days = byDay(list); let best = null; for (const [k, a] of days) if (!best || a.s > best.s) best = { day: k, s: a.s, n: a.n };
    const times = list.map(r => r.time), span = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 86400) + 1);
    const months = new Map(); for (const r of list) { const x = months.get(r._.month) || { v: 0, n: 0 }; x.v += r.duration || 0; x.n++; months.set(r._.month, x); }
    const hours = Array.from({ length: 24 }, (_, i) => ({ key: i, v: 0, n: 0 })), wds = HE_WD.map((_, i) => ({ key: i, v: 0, n: 0 })), buckets = BUCKETS.map(([label, max]) => ({ label, max, v: 0, s: 0 }));
    for (const r of list) { hours[r._.hour].v += r.duration || 0; hours[r._.hour].n++; wds[r._.wd].v += r.duration || 0; wds[r._.wd].n++; const b = buckets.find(b => (r.duration || 0) < b.max); b.v++; b.s += r.duration || 0; }
    const ppl = people(list).sort((a, b) => b.s - a.s);
    return { n: list.length, contacts: ppl.length, total, avg: total / list.length, median: sorted[Math.floor(sorted.length / 2)], perDay: total / span, longest: list.reduce((a, r) => (r.duration || 0) > (a.duration || 0) ? r : a, list[0]), best, months: [...months.entries()].sort().map(([k, x]) => ({ key: k, v: x.v, n: x.n })), hours, wds, buckets, top: ppl.slice(0, 12), ai: list.filter(r => r.sum).length };
  }

  /* ---------- זמנים לתצוגה ---------- */
  function fmtDur(s) { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = pad2(s % 60); return h ? `${h}:${pad2(m)}:${ss}` : `${m}:${ss}`; }
  function fmtTotal(s) { s = Math.round(s || 0); if (s < 60) return `${s} שנ׳`; const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); return h ? `${h} ש׳ ${m} ד׳` : `${m} ד׳`; }
  function fmtDay(day, withYear) { const [y, m, d] = day.split("-").map(Number), wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `יום ${HE_WD[wd]}, ${d} ב${HE_MON[m - 1]}${withYear ? " " + y : ""}`; }
  const nCalls = n => n === 1 ? "שיחה אחת" : `${n} שיחות`;

  /* ---------- AI: בקשות ופענוח ----------
     הבקשות עצמן (fetch לספק שהמשתמש בחר, עם המפתח שלו) ב-recordings.js; כאן רק הטקסט שנשלח ומה עושים עם מה שחוזר. */
  const TRANSCRIBE_PROMPT = `תמלל את הקלטת שיחת הטלפון הזו מילה במילה, בשפה שבה מדברים (בדרך כלל עברית), בדיוק מרבי.
הפרד בין הדוברים ("דובר 1", "דובר 2" וכו׳). כל קטע הוא תור דיבור או משפט אחד, עם זמן ההתחלה שלו מתחילת ההקלטה.
אל תסכם, אל תתרגם, אל תשמיט ואל תוסיף מילים. אם לא שומעים דיבור בכלל — החזר רשימה ריקה.
החזר JSON בלבד במבנה: {"segments":[{"start":"MM:SS","speaker":"דובר 1","text":"..."}]}`;
  function parseJSONLoose(t) {
    if (t && typeof t === "object") return t;
    const s = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(s); } catch (_) { }
    for (const [a, b] of [["{", "}"], ["[", "]"]]) { const i = s.indexOf(a), j = s.lastIndexOf(b); if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { } } }
    throw new Error("התשובה מה-AI לא הייתה בפורמט הצפוי. נסו שוב.");
  }
  function toSec(v) { if (v == null || v === "") return null; if (typeof v === "number") return v; const p = String(v).trim().split(":").map(Number); if (p.some(isNaN)) return null; return p.reduce((a, x) => a * 60 + x, 0); }
  const speakerLabel = id => { const v = String(id ?? "").trim(); const m = /(\d+)/.exec(v); if (m) return `דובר ${+m[1] + (/speaker_?\d/i.test(v) ? 1 : 0)}`; if (/^[A-Z]$/i.test(v)) return `דובר ${v.toUpperCase().charCodeAt(0) - 64}`; return v; };
  function plainSegs(text) { return String(text || "").split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => { const m = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*(?:([^:\]]{1,20}):\s*)?(.*)$/.exec(l); return m ? { s: toSec(m[1]), sp: (m[2] || "").trim(), t: m[3].trim() } : { s: null, sp: "", t: l }; }).filter(x => x.t); }
  function segsFromGemini(text) {
    let j; try { j = parseJSONLoose(text); } catch (_) { return plainSegs(text); }
    const arr = Array.isArray(j) ? j : (j.segments || j.transcript || []); if (typeof arr === "string") return plainSegs(arr);
    return arr.map(x => ({ s: toSec(x.start ?? x.time ?? x.s), sp: String(x.speaker || x.sp || ""), t: String(x.text || x.t || "").trim() })).filter(x => x.t);
  }
  // ElevenLabs: מילים עם דובר וזמן → משפטים: דובר חדש, שתיקה של יותר משנייה וחצי, או משפט ארוך שנגמר בנקודה
  function segsFromElevenLabs(j) {
    const segs = []; let cur = null;
    for (const w of j.words || []) {
      if (w.type === "audio_event") continue; if (w.type === "spacing") { if (cur) cur.t += w.text; continue; }
      const sp = w.speaker_id ?? null;
      if (!cur || sp !== cur._sp || (w.start - cur._e) > 1.6 || (cur.t.length > 260 && /[.?!]\s*$/.test(cur.t))) segs.push(cur = { s: w.start, sp: speakerLabel(sp), t: "", _sp: sp, _e: w.end });
      cur.t += w.text; cur._e = w.end;
    }
    if (!segs.length && j.text) segs.push({ s: 0, sp: "", t: j.text });
    return segs.map(x => ({ s: x.s, sp: x.sp, t: x.t.trim() })).filter(x => x.t);
  }
  function segsFromOpenAI(j, diarized) {
    if (j.segments?.length) return j.segments.map(s => ({ s: s.start ?? null, sp: diarized ? speakerLabel(s.speaker) : "", t: String(s.text || "").trim() })).filter(x => x.t);
    const text = String(j.text || "").trim(); if (!text) return [];
    const parts = text.split(/(?<=[.?!])\s+(?=\S)/).reduce((acc, s) => { const last = acc[acc.length - 1]; if (last && last.length < 160) acc[acc.length - 1] = last + " " + s; else acc.push(s); return acc; }, []);
    return parts.map((t, i) => ({ s: i === 0 ? 0 : null, sp: "", t }));
  }
  function trText(r, max = 120000) {
    if (!r.tr) return ""; let s = "";
    for (const g of r.tr.segs) { s += `${g.s != null ? "[" + fmtDur(g.s) + "] " : ""}${g.sp ? g.sp + ": " : ""}${g.t}\n`; if (s.length > max) { s += "…(קוצר)"; break; } }
    return s;
  }
  const SUM_SYSTEM = "אתה עוזר אישי שמסכם הקלטות של שיחות טלפון. אתה כותב בעברית תקנית, קצרה וברורה, ונצמד רק למה שנאמר בשיחה.";
  function summaryRequest(r) {
    const user = `פרטי השיחה:
איש קשר: ${r._.who}${r.number && r._.who !== formatPhone(r.number) ? ` (${formatPhone(r.number)})` : ""}${r.type ? `\nכיוון: ${r.type === "incoming" ? "נכנסת" : "יוצאת"}` : ""}
מועד: ${fmtDay(r._.day, true)}, ${r.iso.slice(11, 16)}
משך: ${fmtDur(r.duration)}

תמלול (ייתכנו שגיאות תמלול — הבן מההקשר):
${trText(r)}

החזר JSON בלבד במבנה הזה:
{"title":"כותרת קצרה לנושא השיחה, עד 8 מילים",
 "summary":"תקציר של 2–4 משפטים",
 "points":["נקודות עיקריות שעלו, עד 6"],
 "actions":["משימות, התחייבויות או דברים שסוכמו — מי עושה מה ומתי, אם נאמר"],
 "dates":["מועדים, תאריכים, פגישות או סכומים שהוזכרו"],
 "sentiment":"אחד מ: חיובית, ניטרלית, מתוחה, שלילית",
 "tags":["2–5 תגיות נושא קצרות, מילה או שתיים"]}
רשימה שאין לה תוכן — החזר אותה ריקה.`;
    return { system: SUM_SYSTEM, user };
  }
  function normalizeSummary(o, meta) {
    const arr = v => Array.isArray(v) ? v.map(x => typeof x === "string" ? x : (x && (x.text || x.what || JSON.stringify(x)))).filter(Boolean).slice(0, 12) : (v ? [String(v)] : []);
    return Object.assign({ title: String(o.title || "").slice(0, 120), summary: String(o.summary || ""), points: arr(o.points), actions: arr(o.actions), dates: arr(o.dates), sentiment: String(o.sentiment || ""), tags: arr(o.tags).map(t => String(t).replace(/^#/, "").trim()).filter(Boolean).slice(0, 6), at: Date.now() }, meta || {});
  }
  const EMPTY_SUMMARY = () => ({ title: "לא זוהה דיבור", summary: "בתמלול של ההקלטה הזו לא נמצא דיבור.", points: [], actions: [], dates: [], sentiment: "", tags: [], at: Date.now() });
  /* חיפוש חכם: בקשה בעברית חופשית → מסנן. השמות שה-AI מחזיר חייבים להיות מתוך הרשימה (או חלק משם ברשימה). */
  function filterRequest(text, contacts, now) {
    const today = localDay(now || Date.now()), wd = new Date(now || Date.now()).getDay();
    const names = contacts.slice(0, 350).map(c => `${c.who} (${c.n})`).join(", ");
    return { system: "אתה ממיר בקשות חיפוש בעברית למסנני נתונים. אתה מחזיר JSON בלבד.", user: `היום: ${today} (יום ${HE_WD[wd]}).
המשתמש מחפש בארכיון של הקלטות שיחות טלפון. המר את הבקשה שלו למסנן.
אנשי קשר קיימים (שם (מספר שיחות)): ${names}

הבקשה: "${text}"

החזר JSON בלבד:
{"contacts":["שמות מדויקים מתוך הרשימה למעלה, אם הבקשה מתייחסת לאנשים מסוימים"],
 "from":"YYYY-MM-DD או null","to":"YYYY-MM-DD או null (כולל)",
 "minSec":מספר או null,"maxSec":מספר או null,
 "hourFrom":0-23 או null,"hourTo":0-24 או null,
 "weekdays":[0-6, 0=ראשון] או [],
 "status":"tr" (מתומללות) | "sum" (מסוכמות) | "notr" | "star" (מועדפות) | "note" | null,
 "direction":"incoming" | "outgoing" | null,
 "kind":"named" | "tel" | null,
 "text":"מילים לחיפוש בתוכן השיחות או בסיכומים, רק אם הבקשה מחפשת נושא או מילה. אחרת ריק",
 "sort":"new" | "old" | "long" | "short",
 "explain":"משפט קצר בעברית שמתאר את המסנן"}` };
  }
  function filterFromAI(o, contacts) {
    const f = defaultFilter(), known = new Set(contacts.map(c => c.who));
    f.contacts = (o.contacts || []).map(n => known.has(n) ? n : (contacts.find(c => c.who.includes(n) || String(n).includes(c.who)) || {}).who).filter(Boolean);
    if (o.from || o.to) { f.date = "custom"; f.from = o.from || ""; f.to = o.to || ""; }
    const mn = +o.minSec || 0, mx = +o.maxSec || 0;
    f.dur = mn >= 900 ? "gt900" : mn >= 300 ? "gt300" : mn >= 60 ? "gt60" : mn >= 10 ? "gt10" : mx && mx <= 10 ? "lt10" : mx && mx <= 60 ? "lt60" : "any";
    if (o.hourFrom != null && o.hourTo != null) { const a = +o.hourFrom, b = +o.hourTo; f.tod = a >= 20 || (b <= 7 && a > b) ? "night" : a >= 16 ? "evening" : a >= 11 ? "noon" : "morning"; }
    f.wd = Array.isArray(o.weekdays) ? o.weekdays.map(Number).filter(x => x >= 0 && x <= 6) : [];
    if (STATUS[o.status] && o.status !== "gone") f.status = o.status; if (KIND[o.kind]) f.kind = o.kind; if (o.direction === "incoming" || o.direction === "outgoing") f.dir = o.direction; if (SORT[o.sort]) f.sort = o.sort;
    f.q = String(o.text || "").trim();
    return { f, explain: String(o.explain || "") };
  }
  /* שאלה על כמה שיחות: הסיכומים (ותמלולים כשיש מעט שיחות) מהחדשה לישנה, עד מגבלת אורך */
  function corpus(recs, maxChars = 140000) {
    const withAI = recs.filter(r => r.sum || r.tr).sort((a, b) => b.time - a.time); let s = "", used = 0;
    for (const r of withAI) {
      let block = `### ${r._.who} | ${fmtDay(r._.day, true)} ${r.iso.slice(11, 16)} | ${fmtDur(r.duration)}${r.type ? " | " + (r.type === "incoming" ? "נכנסת" : "יוצאת") : ""}\n`;
      if (r.sum) {
        block += `נושא: ${r.sum.title}\nתקציר: ${r.sum.summary}\n`;
        if (r.sum.points?.length) block += `נקודות: ${r.sum.points.join("; ")}\n`; if (r.sum.actions?.length) block += `משימות/סיכומים: ${r.sum.actions.join("; ")}\n`; if (r.sum.dates?.length) block += `מועדים: ${r.sum.dates.join("; ")}\n`;
        if (r.tr && withAI.length <= 6) block += `תמלול:\n${trText(r, 12000)}\n`;
      } else block += `תמלול:\n${trText(r, withAI.length <= 6 ? 20000 : 3500)}\n`;
      if (r.note) block += `הערה של המשתמש: ${r.note}\n`;
      if (s.length + block.length > maxChars) break; s += block + "\n"; used++;
    }
    return { text: s, used, total: recs.length, withAI: withAI.length };
  }
  function askRequest(c, question) {
    return { system: "אתה עוזר שעונה על שאלות לגבי שיחות הטלפון המוקלטות של המשתמש. ענה בעברית, ישר ולעניין, רק על סמך החומר שקיבלת. כשאתה מסתמך על שיחה מסוימת, ציין את התאריך שלה. אם התשובה לא נמצאת בחומר, אמור זאת במפורש.", user: `להלן חומר מתוך ${c.used} שיחות טלפון מוקלטות של המשתמש (סיכומים ו/או תמלולים):\n\n${c.text}\n\nהשאלה של המשתמש: ${question}` };
  }
  // Markdown קל לתשובות: הדגשה, רשימות, כותרות — אחרי escape, כך שתשובה לא יכולה להזריק HTML
  function mdLite(t) {
    const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let html = "", inList = false;
    for (const l of esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\n/)) {
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
      if (m) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${m[1]}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      if (/^\s*#{1,4}\s+/.test(l)) html += `<p><b>${l.replace(/^\s*#{1,4}\s+/, "")}</b></p>`; else if (l.trim()) html += `<p>${l}</p>`;
    }
    return html + (inList ? "</ul>" : "");
  }
  /* חלוקת הקלטה ארוכה לחלקים לתמלול, בנקודה שקטה (לא באמצע מילה): ±20 שניות סביב הגבול, החלון השקט ביותר */
  function splitPoints(pcm, sr, maxSec) {
    const per = Math.floor(maxSec * sr), out = []; let i = 0;
    while (i < pcm.length) {
      let end = Math.min(pcm.length, i + per);
      if (pcm.length - end <= sr * 30) end = pcm.length; // זנב קצר מצטרף לחלק האחרון במקום בקשה נפרדת
      else {
        const win = Math.floor(sr * 0.3), span = Math.floor(sr * 20); let best = end, bestE = Infinity;
        for (let s = Math.max(i + win, end - span); s < Math.min(pcm.length - win, end + span); s += Math.floor(win / 2)) { let e = 0; for (let j = s; j < s + win; j += 4) e += Math.abs(pcm[j]); if (e < bestE) { bestE = e; best = s + Math.floor(win / 2); } }
        end = best;
      }
      out.push([i, end]); i = end;
    }
    return out.length ? out : [[0, 0]];
  }
  // גלי קול לנגן: n עמודות, שורש של השיא היחסי (שקט לא נעלם לגמרי ליד דיבור חזק)
  function peaksOf(pcm, n) {
    const out = new Float32Array(n); if (!pcm || !pcm.length) return out; const step = pcm.length / n; let mx = 1;
    for (let i = 0; i < n; i++) { const a = Math.floor(i * step), b = Math.min(pcm.length, Math.max(a + 1, Math.floor((i + 1) * step))), inc = b - a > 4000 ? 4 : 1; let m = 0; for (let j = a; j < b; j += inc) { const v = pcm[j] < 0 ? -pcm[j] : pcm[j]; if (v > m) m = v; } out[i] = m; if (m > mx) mx = m; }
    for (let i = 0; i < n; i++) out[i] = Math.sqrt(out[i] / mx);
    return out;
  }

  /* ---------- ייצוא, גיבוי, שמות מקובץ ---------- */
  function exportRows(recs) {
    const rows = [["תאריך", "שעה", "יום", "איש קשר", "מספר", "כיוון", "משך בשניות", "משך", "כותרת", "תקציר", "משימות", "תגיות", "הערה", "מועדף", "קובץ"]];
    for (const r of recs) rows.push([r._.day.split("-").reverse().join("."), r.iso.slice(11, 16), HE_WD[r._.wd], r._.who, r.number || "", r.type === "incoming" ? "נכנסת" : r.type === "outgoing" ? "יוצאת" : "", Math.round(r.duration || 0), fmtDur(r.duration), r.sum?.title || "", r.sum?.summary || "", (r.sum?.actions || []).join(" | "), tagsOf(r).join(", "), r.note || "", r.star ? "כן" : "", r.fileName]);
    return rows;
  }
  // גיבוי: כל מה שהמשתמש או ה-AI הוסיפו (בלי מפתחות API ובלי מקומות הקבצים במחשב הזה)
  function backupData(recs, aliases, settings) { return { app: "ankal-recordings", v: 1, at: Date.now(), aliases, settings, recs: recs.map(r => { const o = strip(r); o.loc = []; return o; }) }; }
  function mergeBackup(byId, data) {
    if (!data || data.app !== "ankal-recordings" || !Array.isArray(data.recs)) throw new Error("זה לא קובץ גיבוי של הקלטות השיחה באנק״ל");
    const added = [], merged = [];
    for (const b of data.recs) {
      const ex = byId.get(b.id);
      if (!ex) { const r = Object.assign({}, b, { loc: [] }); byId.set(r.id, r); added.push(r); continue; }
      let ch = false;
      if (!ex.tr && b.tr) { ex.tr = b.tr; ch = true; } if (!ex.sum && b.sum) { ex.sum = b.sum; ch = true; }
      if (!ex.note && b.note) { ex.note = b.note; ch = true; } if (b.star && !ex.star) { ex.star = true; ch = true; }
      if (b.tags?.length) { const t = [...new Set([...(ex.tags || []), ...b.tags])]; if (t.length !== (ex.tags || []).length) { ex.tags = t; ch = true; } }
      if (ch) merged.push(ex);
    }
    return { added, merged, aliases: data.aliases || {} };
  }
  /* שמות למספרים שלא שמורים: מאנשי קשר מקובץ או מרשימה באנק״ל (mobile/home/work/fax). כינוי קיים לא נדרס. */
  function namesFromContacts(recs, contacts, aliases) {
    const byNum = new Map(); for (const c of contacts) for (const f of ["mobile", "home", "work", "fax", "phone"]) { const d = baseNumber(c[f]); if (d.length >= 7 && c.name && !byNum.has(d)) byNum.set(d, c.name); }
    const next = Object.assign({}, aliases), fresh = new Set();
    for (const r of recs) { if (r.contactName || !r.number) continue; const k = contactKey(r); if (next[k]) continue; const name = byNum.get(baseNumber(r.number)); if (name) { next[k] = name; fresh.add(k); } }
    return { aliases: next, named: fresh.size, calls: recs.filter(r => !r.contactName && fresh.has(contactKey(r))).length };
  }

  const api = { parseFileName, recordId, baseNumber, formatPhone, contactKey, displayName, norm, newRecord, mergeScan, enrich, prep, strip, blobOf, tagsOf, DUR, TOD, STATUS, KIND, DIR, SORT, DATES, HE_WD, HE_MON, defaultFilter, localDay, addDays, dateRange, hiddenCount, isFiltered, filterRecs, byDay, heat, people, monthsOf, stats, fmtDur, fmtTotal, fmtDay, nCalls, TRANSCRIBE_PROMPT, parseJSONLoose, toSec, speakerLabel, plainSegs, segsFromGemini, segsFromElevenLabs, segsFromOpenAI, trText, summaryRequest, normalizeSummary, EMPTY_SUMMARY, filterRequest, filterFromAI, corpus, askRequest, mdLite, splitPoints, peaksOf, exportRows, backupData, mergeBackup, namesFromContacts };
  root.ANKAL_RECORDINGS_CORE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
