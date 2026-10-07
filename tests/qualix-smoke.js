/* בדיקת עשן לגיבוי קיוליקס: דפדפן אמיתי (headless), גיבוי מלאכותי שנבנה בזיכרון ומוזרם למודול
   במקום כרטיס, ואז פתיחה, עריכה בכל לשונית, שמירה כגרסה חדשה ואימות הקבצים שנכתבו. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..", "src");
function findBrowser() {
  if (process.argv[2]) return process.argv[2];
  const candidates = [process.env.PROGRAMFILES + "\\Google\\Chrome\\Application\\chrome.exe", process.env["PROGRAMFILES(X86)"] + "\\Google\\Chrome\\Application\\chrome.exe", process.env.PROGRAMFILES + "\\Microsoft\\Edge\\Application\\msedge.exe", process.env["PROGRAMFILES(X86)"] + "\\Microsoft\\Edge\\Application\\msedge.exe"];
  for (const candidate of candidates) if (candidate && fs.existsSync(candidate)) return candidate;
  return null;
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "text/xml" };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/seed.html") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><meta charset=utf-8><title>seed</title>"); return; }
  const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404).end("not found"); return; } res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }); res.end(data); });
});

const PORT = 8733, DEBUG_PORT = 9335;
server.listen(PORT, async () => {
  const browser = findBrowser();
  if (!browser) { console.log("לא נמצא Chrome או Edge — בדיקת העשן דורשת דפדפן. דילוג."); server.close(); return; }
  const userDir = path.join(require("os").tmpdir(), "ankal-qualix-smoke-" + Date.now());
  const proc = cp.spawn(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--user-data-dir=" + userDir, "--remote-debugging-port=" + DEBUG_PORT, `http://127.0.0.1:${PORT}/seed.html`], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; proc.stderr.on("data", d => { stderr += d.toString(); });
  const started = Date.now(); let target = null;
  while (Date.now() - started < 20000 && !target) { await new Promise(r => setTimeout(r, 400)); try { target = JSON.parse(await get(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).find(t => t.type === "page" && t.webSocketDebuggerUrl); } catch (_) { } }
  if (!target) { console.error("הדפדפן לא עלה\n" + stderr.slice(-1500)); cleanup(1); return; }

  const WebSocket = await loadWs(); const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1; const pending = new Map(); const consoleErrors = [];
  ws.on("message", raw => { const msg = JSON.parse(raw.toString()); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; } if (msg.method === "Runtime.exceptionThrown") consoleErrors.push("EXCEPTION: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)); if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push("CONSOLE: " + msg.params.args.map(a => a.description || a.value).join(" ")); });
  const send = (method, params) => new Promise(resolve => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || "eval failed"); return res.result?.result?.value; };
  await new Promise(r => ws.on("open", r)); await send("Runtime.enable"); await send("Page.enable"); await new Promise(r => setTimeout(r, 1200));
  const steps = []; const wait = ms => new Promise(r => setTimeout(r, ms));
  const step = async (label, expression, expect) => { try { const value = await evaluate(expression); const ok = expect == null ? true : (typeof expect === "function" ? expect(value) : value === expect); steps.push({ label, ok, value }); return value; } catch (error) { steps.push({ label, ok: false, value: error.message }); return null; } };
  const click = sel => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return ${JSON.stringify("אין: " + sel)}; b.click(); return "clicked"; })()`;
  const fill = (id, value) => `(() => { const el = document.getElementById("${id}"); if (!el) return "אין: ${id}"; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); return "ok"; })()`;

  await step("עמוד הזרע", "document.title", "seed");
  await step("ניווט לאפליקציה", `location.href = "/index.html?app=1", "navigating"`);
  await wait(2500);
  await step("האתר נטען", "document.title", v => /אנק/.test(v));
  await step("בחירת מצב אופליין", click('[data-modal-choice="offline"]'));
  await wait(300);
  await step("פריט התפריט קיים", `document.querySelector('[data-page="qualix"] .nav-label')?.textContent`, "גיבוי קיוליקס");
  await step("מעבר לעמוד", click('[data-page="qualix"]'));
  await wait(300);
  await step("כותרת העמוד", `document.getElementById("page-title").textContent`, "גיבוי קיוליקס");
  await step("מסך פתיחה בלי מקור", `document.querySelector("#qualix-root .qx-intro") ? "intro" : document.querySelector("#qualix-root").innerHTML.slice(0, 120)`, "intro");

  // גיבוי מלאכותי בזיכרון, מוזרם למודול דרך מתאם זיכרון
  await step("בניית גיבוי בזיכרון וחיבור", `(async () => {
    const Q = window.ANKAL_QUALIX; const folder = "2026-10-01_10-00-00";
    const files = Q.assembleBackup({ folder, cardLetter: "E",
      contacts: [{ name: "דוד כהן", mobile: "0501234567", home: "026417612", work: "", fax: "", email: "a@b.c", note: "הערה", group: "משפחה" }, { name: "Voice Mail", mobile: "+972535353151", home: "", work: "", fax: "", email: "", note: "", group: "" }, { name: "שרה לוי", mobile: "0527654321", home: "", work: "", fax: "", email: "", note: "", group: "משפחה" }],
      callog: { entries: [{ number: "0501234567", type: "incoming", calls: [{ time: Q.isoToPhoneTime("2026-09-25T10:00:00"), duration: 49 }] }, { number: "0527654321", type: "missed", calls: [{ time: Q.isoToPhoneTime("2026-09-25T11:00:00"), duration: 0 }] }] },
      events: [{ title: "רופא שיניים", date: "2026-10-05", time: "17:30", reminder: true, reminderId: 101 }],
      memos: [{ fileName: "MEMO_20260925_1200001234567890.txt", text: "פתק ראשון\\nשורה שנייה" }],
      playlists: [{ name: "שירים.lst", entries: [{ path: "E:\\\\a.mp3", meta: 0, fileSize: 1000 }] }],
      settings: new Uint8Array(600), udb: { phoneCache: new Uint8Array(0), cardCache: new Uint8Array(4096) } });
    const mem = new Map(); for (const f of files) mem.set("ibphone/" + folder + "/" + f.name, f.bytes); mem.set("PB/.keep", new Uint8Array(0)); mem.set("a.mp3", new Uint8Array(1000)); window.__mem = mem;
    // הטלפון מרפד פתקים בבתי אפס — מדמים את זה
    const memoKey = "ibphone/" + folder + "/MEMO_20260925_1200001234567890.txt"; const mb = mem.get(memoKey); const padded = new Uint8Array(mb.length + 20); padded.set(mb); mem.set(memoKey, padded); mem.set("Memo/MEMO_20260925_1200001234567890.txt", padded);
    const adapter = { label: "זיכרון", kind: "mem",
      list: async rel => { const prefix = rel ? rel.replace(/\\/+$/, "") + "/" : ""; const out = new Map(); for (const key of mem.keys()) { if (!key.startsWith(prefix)) continue; const rest = key.slice(prefix.length); const name = rest.split("/")[0]; if (!name) continue; out.set(name, rest.includes("/") ? "directory" : "file"); } return [...out].map(([name, kind]) => ({ name, kind, size: kind === "file" ? mem.get(prefix + name).length : 0 })); },
      read: async rel => { if (!mem.has(rel)) throw new Error("no file " + rel); return mem.get(rel); },
      write: async (rel, bytes) => { mem.set(rel, bytes); return true; }, mkdir: async () => true,
      remove: async rel => { for (const k of [...mem.keys()]) if (k === rel || k.startsWith(rel + "/")) mem.delete(k); return true; },
      exists: async rel => [...mem.keys()].some(k => k === rel || k.startsWith(rel + "/")) };
    return await window.ANKAL_QUALIX_UI.connect(adapter);
  })()`, true);
  await wait(300);
  await step("גרסה אחת ברשת", `document.querySelectorAll("#qualix-root .qx-version").length`, 1);
  await step("שבע קטגוריות עם סימן ✓", `document.querySelectorAll("#qualix-root .qx-version .qx-cats li.on").length`, 7);
  await step("תפריט ⋮ של הגרסה", click('[data-qx="version-menu"]'));
  await wait(300);
  await step("התפריט מציע פתיחה, גרסה חדשה, השוואה ומחיקה", `[...document.querySelectorAll("#modal-footer button")].map(b => b.textContent).join("|")`, v => /פתיחה/.test(v) && /השוואה/.test(v) && /מחיקה/.test(v));
  await step("סגירת התפריט", click('[data-modal-choice="cancel"]'));
  await step("לחיצה על הכרטיס עצמו פותחת", click('.qx-version .qx-open'));
  await wait(500);
  await step("הקטגוריות מופיעות בתפריט הצד", `document.querySelectorAll('#qualix-subnav [data-qx="tab"]').length`, 7);
  await step("ו'ניהול פתקים' של הכרטיס מעליהן", `document.querySelector('#qualix-subnav [data-qx="direct-memos"] .nav-label')?.textContent`, "ניהול פתקים");
  await step("אנשי קשר פעיל בתפריט הצד", `document.querySelector("#qualix-subnav .nav-sub-item.active")?.textContent.trim()`, v => /אנשי קשר/.test(v));
  await step("כותרת העמוד לפי הקטגוריה", `document.getElementById("page-title").textContent`, "אנשי קשר");
  await step("שלושה כרטיסי אנשי קשר", `document.querySelectorAll('#qualix-root .contact-card[data-qx="edit-contact"]').length`, 3);
  await step("כרטיס צבעוני עם עיגול", `(() => { const c = document.querySelector('#qualix-root .contact-card'); return c.style.getPropertyValue("--tint") + " · " + (c.querySelector(".contact-avatar")?.textContent || "אין"); })()`, v => /^\d+ · .+/.test(v) && !v.endsWith("אין"));
  await step("מספר בינלאומי מוצג עם פלוס", `[...document.querySelectorAll('#qualix-root .contact-card .contact-line span')].map(s => s.textContent).join(" ")`, v => v.includes("+972535353151"));
  await step("שורת קיוליקס מציגה קבוצה", `[...document.querySelectorAll('#qualix-root .contact-card .contact-line')].filter(l => l.textContent.includes("קיוליקס")).length`, 2);

  await step("פתיחת איש קשר חדש", click('[data-qx="add-contact"]'));
  await wait(300);
  await step("מילוי שם", fill("qx-c-name", "בדיקה חדש"), "ok");
  await step("מילוי נייד", fill("qx-c-mobile", "050-111-2222"), "ok");
  await step("מילוי קבוצה חדשה", fill("qx-c-group", "חברים"), "ok");
  await step("שמירת איש הקשר", click('[data-modal-choice="save"]'));
  await wait(300);
  await step("ארבעה כרטיסים אחרי ההוספה", `document.querySelectorAll('#qualix-root .contact-card[data-qx="edit-contact"]').length`, 4);
  await step("סימון שינויים", `document.querySelector(".qx-save .qx-dirty")?.textContent || "אין"`, v => /שינויים/.test(v));
  await step("לחיצה על הכותרת בתפריט מציגה את הגרסאות", `(() => { document.querySelector('[data-page="qualix"]').click(); return document.querySelector("#qualix-root .qx-versions") ? "versions" : "editor"; })()`, "versions");
  await step("הגרסה הפתוחה מסומנת עם שינויים", `document.querySelector("#qualix-root .qx-version.current .qx-state")?.textContent`, v => /שינויים/.test(v));
  await step("הקטגוריות עדיין בתפריט הצד", `document.querySelectorAll('#qualix-subnav [data-qx="tab"]').length`, 7);
  await step("לחיצה על קטגוריה חוזרת לעורך", `(() => { document.querySelector('#qualix-subnav [data-tab="contacts"]').click(); return document.querySelectorAll('#qualix-root .contact-card[data-qx="edit-contact"]').length; })()`, 4);
  await step("חיפוש מסנן לפי שם", `(() => { const el = document.getElementById("qx-search"); el.value = "שרה"; el.dispatchEvent(new Event("input", { bubbles: true })); return document.querySelectorAll('#qualix-root .contact-card[data-qx="edit-contact"]').length; })()`, 1);
  await step("חיפוש מסנן לפי ספרות", `(() => { const el = document.getElementById("qx-search"); el.value = "050-111"; el.dispatchEvent(new Event("input", { bubbles: true })); return document.querySelectorAll('#qualix-root .contact-card[data-qx="edit-contact"]').length; })()`, 1);
  await step("ניקוי החיפוש", `(() => { const el = document.getElementById("qx-search"); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); return document.querySelectorAll('#qualix-root .contact-card[data-qx="edit-contact"]').length; })()`, 4);

  await step("לשונית יומן שיחות", click('[data-qx="tab"][data-tab="calls"]'));
  await wait(200);
  await step("שני אנשי קשר ביומן (שורה לכל איש קשר)", `document.querySelectorAll('#qualix-root .qx-call[data-qx="call-group"]').length`, 2);
  await step("שם מזוהה לפי מספר", `[...document.querySelectorAll("#qualix-root .qx-call .qx-call-main b")].map(b => b.textContent).join("|")`, v => v.includes("שרה לוי") && v.includes("דוד כהן"));
  await step("מסנן לא נענו", `(() => { document.querySelector('[data-qx="call-filter"][data-filter="missed"]').click(); return document.querySelectorAll("#qualix-root .qx-call").length; })()`, 1);
  await step("חזרה להכל", `(() => { document.querySelector('[data-qx="call-filter"][data-filter="all"]').click(); return document.querySelectorAll("#qualix-root .qx-call").length; })()`, 2);
  await step("הוספת שיחה", click('[data-qx="add-call"]'));
  await wait(300);
  await step("מילוי מספר", fill("qx-call-num", "0501234567"), "ok");
  await step("מילוי זמן", fill("qx-call-time", "2026-09-26T08:15"), "ok");
  await step("סוג יוצאת ומשך דקה", `(() => { document.getElementById("qx-call-type").value = "outgoing"; document.getElementById("qx-call-dur").value = "60"; return "ok"; })()`, "ok");
  await step("אישור השיחה", click('[data-modal-choice="add"]'));
  await wait(300);
  await step("עדיין שתי שורות, דוד עם (2) וסמל יוצאת", `(() => { const g = [...document.querySelectorAll('#qualix-root .qx-call[data-qx="call-group"]')]; const dan = g.find(x => x.textContent.includes("דוד כהן")); return g.length + " " + dan.querySelector(".qx-call-count")?.textContent + " " + dan.className.replace("qx-call ", ""); })()`, "2 (2) outgoing");
  await step("פתיחת השיחות של דוד", `(() => { [...document.querySelectorAll('#qualix-root .qx-call[data-qx="call-group"]')].find(x => x.textContent.includes("דוד כהן")).click(); return document.querySelectorAll("#qualix-root .qx-call-item").length; })()`, 2);
  await step("השיחה החדשה ראשונה, תחת תאריך היום שלה", `document.querySelector("#qualix-root .qx-call-day")?.textContent + " " + document.querySelector("#qualix-root .qx-call-item .qx-call-time")?.textContent`, "26.09.2026 08:15");
  await step("פרטי שיחה", click('#qualix-root .qx-call-item'));
  await wait(300);
  await step("חלון הפרטים מציג שם, מספר, משך וסים", `document.getElementById("modal-body").textContent`, v => /דוד כהן/.test(v) && /0501234567/.test(v) && /1:00/.test(v) && /סים 1/.test(v));
  await step("סגירת הפרטים", click('[data-modal-choice="ok"]'));
  await step("מחיקת שיחה", click('[data-qx="delete-call"]'));
  await wait(200);
  await step("נשארה שיחה אחת לדוד", `document.querySelectorAll('#qualix-root .qx-call-item').length`, 1);
  await step("חזרה לרשימה", `(() => { document.querySelector('[data-qx="call-back"]').click(); return document.querySelectorAll('#qualix-root .qx-call[data-qx="call-group"]').length; })()`, 2);

  await step("לשונית פתקים", click('[data-qx="tab"][data-tab="memos"]'));
  await wait(200);
  await step("פתק קיים מוצג בלי ריפוד האפסים", `document.getElementById("qx-memo-text")?.value`, "פתק ראשון\nשורה שנייה");
  await step("פתק חדש", click('[data-qx="new-memo"]'));
  await wait(200);
  await step("הקלדת טקסט", fill("qx-memo-text", "שלום\nעולם גדול"), "ok");
  await step("מונה תווים", `document.getElementById("qx-memo-counter")?.textContent`, v => /^\d+ \/ 1000/.test(v));
  await step("מירכוז הכל", click('[data-qx="center-all"]'));
  await step("הטקסט מורכז ברווחים", `document.getElementById("qx-memo-text").value`, v => v.startsWith(" ") && v.includes("\n "));
  await step("תצוגת הטלפון", `document.querySelectorAll("#qx-memo-preview div").length`, 2);
  await step("מסגרת מרובעת: שורת הגל ושורת הקווים באותו רוחב (עד 3%)", `(() => { const ta = document.getElementById("qx-memo-text"); ta.value = "~".repeat(17) + "\\n|" + " ".repeat(28) + "|\\n" + "'".repeat(32) + "\\nשלום 304512 עולם"; ta.dispatchEvent(new Event("input", { bubbles: true })); const w = [...document.querySelectorAll("#qx-memo-preview > div")].map(d => [...d.querySelectorAll("i")].reduce((n, i) => n + parseFloat(i.style.width), 0)); const max = Math.max(w[0], w[1], w[2]), min = Math.min(w[0], w[1], w[2]); return (max - min) / max < 0.03 ? "ok" : "diff " + w.map(x => x.toFixed(0)).join("/"); })()`, "ok");
  await step("ספרות בתוך שורה עברית נשארות משמאל לימין", `[...document.querySelectorAll("#qx-memo-preview > div")][3].querySelector('.qx-run[dir="ltr"]')?.textContent`, "304512");
  await step("שני פתקים ברשימה", `document.querySelectorAll('#qualix-root .qx-list [data-qx="memo"]').length`, 2);
  await step("אזהרת השחזור של הפתקים מוצגת בגרסה", `document.querySelector("#qualix-root .qx-memo-note")?.textContent`, v => /שם הקובץ/.test(v));
  await step("בורר תו המילוי קיים", `[...document.querySelectorAll("#qx-memo-fill option")].map(o => o.value).join(",")`, "space,dot,tab");
  await step("מירכוז בנקודות: שורה ארוכה נשברת ומרופדת משני הצדדים", `(() => { const ta = document.getElementById("qx-memo-text"); ta.value = Array.from({ length: 12 }, () => "שלום עולם").join(" "); ta.dispatchEvent(new Event("input", { bubbles: true })); const sel = document.getElementById("qx-memo-fill"); sel.value = "dot"; sel.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector('[data-qx="center-all"]').click(); const lines = document.getElementById("qx-memo-text").value.split("\\n"); return lines.length + " " + (lines.every(l => /^\\.+שלום.*עולם\\.+$/.test(l)) ? "dots-ok" : "bad:" + lines[0]); })()`, v => /^\d+ dots-ok$/.test(v) && Number(v.split(" ")[0]) >= 3);
  await step("חזרה למילוי ברווחים", `(() => { const sel = document.getElementById("qx-memo-fill"); sel.value = "space"; sel.dispatchEvent(new Event("change", { bubbles: true })); return sel.value; })()`, "space");

  // ניהול פתקים ישיר: תיקיית Memo של הכרטיס — בלי גרסה, בלי שחזור
  await step("בלי כניסה: שורת השרת מציעה כניסה עם Google", `(() => { document.querySelector('[data-page="qualix"]').click(); return document.querySelector("#qualix-root .qx-cloud.off") ? "off" : "אין"; })()`, "off");
  await step("הגרסה מסומנת 'בכרטיס'", `document.querySelector("#qualix-root .qx-version .qx-badge.card")?.textContent`, v => /בכרטיס/.test(v));
  await step("כניסה לניהול פתקים", click('[data-qx="direct-memos"]'));
  await wait(400);
  await step("כותרת העמוד", `document.getElementById("page-title").textContent`, "ניהול פתקים");
  await step("הפתק מתיקיית Memo מוצג", `document.getElementById("qx-memo-text")?.value`, "פתק ראשון\nשורה שנייה");
  await step("עריכת הפתק", fill("qx-memo-text", "פתק ראשון\nנערך במחשב"), "ok");
  await step("מסומן כלא שמור", `document.getElementById("qx-save-state")?.className`, "qx-dirty");
  await step("פתק חדש", click('[data-qx="new-memo"]'));
  await wait(200);
  await step("טקסט לפתק החדש", fill("qx-memo-text", "פתק חדש מהמחשב"), "ok");
  await step("שמירה לטלפון", click('[data-qx="direct-save"]'));
  await wait(500);
  await step("שני קבצים בתיקיית Memo, התוכן נכון", `(() => { const Q = window.ANKAL_QUALIX; const keys = [...window.__mem.keys()].filter(k => k.startsWith("Memo/")); const texts = keys.map(k => Q.parseMemo(window.__mem.get(k))).sort(); return keys.length + " | " + texts.join(" / "); })()`, "2 | פתק חדש מהמחשב / פתק ראשון\nנערך במחשב");
  await step("אין שינויים אחרי השמירה", `document.getElementById("qx-save-state")?.className`, "qx-note");
  await step("מחיקת הפתק הנוכחי", click('[data-qx="delete-memo"]'));
  await wait(200);
  await step("אישור המחיקה", click('[data-modal-choice="yes"]'));
  await wait(200);
  await step("שמירת המחיקה לטלפון", click('[data-qx="direct-save"]'));
  await wait(400);
  await step("נשאר קובץ אחד בתיקיית Memo", `[...window.__mem.keys()].filter(k => k.startsWith("Memo/")).length`, 1);
  await step("קטגוריות הגרסה עדיין בתפריט הצד", `document.querySelectorAll('#qualix-subnav [data-qx="tab"]').length`, 7);

  await step("לשונית לוח שנה", click('[data-qx="tab"][data-tab="calendar"]'));
  await wait(200);
  await step("תצוגת חודש", `document.querySelectorAll("#qualix-root .qx-cal .qx-day:not(.empty)").length`, v => v >= 28 && v <= 31);
  await step("ניווט לאוקטובר 2026", `(() => { window.ANKAL_QUALIX_UI.state.calMonth = "2026-10"; window.ANKAL_QUALIX_UI.render(); return document.querySelector("#qualix-root .qx-toolbar strong").textContent; })()`, v => /2026/.test(v));
  await step("האירוע הקיים מופיע ביום 5", `document.querySelector('#qualix-root .qx-day[data-date="2026-10-05"] .qx-ev')?.textContent`, v => /רופא שיניים/.test(v));
  await step("תאריך עברי בתא היום", `document.querySelector('#qualix-root .qx-day[data-date="2026-10-05"] .qx-heb')?.textContent`, v => /^כ״ד תשרי$/.test(v));
  await step("חודשים עבריים בכותרת", `[...document.querySelectorAll("#qualix-root .qx-toolbar .qx-note")].map(e => e.textContent).join(" | ")`, v => /תשרי–חשוון תשפ״ז/.test(v));
  await step("לחיצה על יום פותחת אירוע חדש בתאריך", click('[data-qx="day-add"][data-date="2026-10-12"]'));
  await wait(300);
  await step("התאריך מולא מראש", `document.getElementById("qx-ev-date").value`, "2026-10-12");
  await step("מילוי כותרת", fill("qx-ev-title", "פגישה"), "ok");
  await step("חזרה שבועית עד סוף אוקטובר", `(() => { document.getElementById("qx-ev-repeat").value = "weekly"; document.getElementById("qx-ev-until").value = "2026-10-31"; return "ok"; })()`, "ok");
  await step("שמירת האירוע", click('[data-modal-choice="save"]'));
  await wait(300);
  await step("שלושה מופעים שבועיים בחודש", `document.querySelectorAll('#qualix-root .qx-ev').length`, 4);
  await step("הצגה כרשימה", click('[data-qx="cal-toggle"]'));
  await wait(200);
  await step("ארבעה אירועים ברשימה", `document.querySelectorAll('#qualix-root tr[data-qx="edit-event"]').length`, 4);
  await step("פתיחת מופע מהסדרה", click('#qualix-root .qx-day[data-date="2026-10-19"] .qx-ev'));
  await wait(300);
  await step("מחיקת כל הסדרה", click('[data-modal-choice="delete-series"]'));
  await wait(300);
  await step("אישור המחיקה", click('[data-modal-choice="yes"]'));
  await wait(300);
  await step("נשאר רק האירוע המקורי", `document.querySelectorAll('#qualix-root .qx-ev').length`, 1);
  await step("אירוע בודד חדש", click('[data-qx="add-event"]'));
  await wait(300);
  await step("מילוי כותרת", fill("qx-ev-title", "פגישה"), "ok");
  await step("מילוי תאריך", fill("qx-ev-date", "2026-11-02"), "ok");
  await step("שמירת האירוע", click('[data-modal-choice="save"]'));
  await wait(300);
  await step("שני אירועים בסך הכל", `window.ANKAL_QUALIX_UI.state.open.data.events.length`, 2);

  await step("לשונית רשימות השמעה", click('[data-qx="tab"][data-tab="playlists"]'));
  await wait(200);
  await step("רשימה קיימת עם שיר", `document.querySelectorAll('#qualix-root [data-qx="song-remove"]').length`, 1);
  await step("הוספת שיר", click('[data-qx="add-song"]'));
  await wait(300);
  await step("נתיב השיר", fill("qx-song-path", "E:\\b.mp3"), "ok");
  await step("אישור", click('[data-modal-choice="add"]'));
  await wait(300);
  await step("שני שירים", `document.querySelectorAll('#qualix-root [data-qx="song-remove"]').length`, 2);
  await step("הזזה למעלה", click('[data-qx="song-up"][data-i="1"]'));
  await wait(200);
  await step("הסדר התהפך", `document.querySelector("#qualix-root .qx-table tbody tr td:nth-child(2)")?.textContent`, "E:\\b.mp3");

  await step("לשונית חיזוי טקסט", click('[data-qx="tab"][data-tab="dictionary"]'));
  await wait(200);
  await step("הוספת מילה", `(() => { document.getElementById("qx-word").value = "אנקל"; document.querySelector('[data-qx="add-word"]').click(); return document.querySelectorAll("#qualix-root .qx-word").length; })()`, 1);
  await step("כפתור ייבוא מאקסל קיים", `document.querySelector('[data-qx="import-words"]')?.textContent.trim()`, v => /אקסל/.test(v));
  await step("מקום פנוי מוצג", `document.querySelector("#qualix-root .qx-toolbar .qx-note")?.textContent`, v => /מקום לעוד/.test(v));

  await step("שמירה כגרסה חדשה", click('[data-qx="save"]'));
  await wait(300);
  await step("אישור השמירה", click('[data-modal-choice="save"]'));
  await wait(1500);
  await step("חלון הסיום", `document.getElementById("modal-title")?.textContent`, v => /מוכנה/.test(v));
  await step("סגירת החלון", click('[data-modal-choice="ok"]'));
  await step("הקבצים שנכתבו", `(() => {
    const Q = window.ANKAL_QUALIX; const keys = [...window.__mem.keys()].filter(k => k.startsWith("ibphone/") && !k.includes("2026-10-01_10-00-00"));
    const folder = keys[0]?.split("/")[1]; if (!folder) return "לא נכתבה תיקייה";
    const get = n => window.__mem.get("ibphone/" + folder + "/" + n);
    const pb = Q.parsePhonebook(get("phonebook.ib")); const head = Q.parseHead(get("ibphone_head.in"));
    const added = pb.contacts.find(c => c.name === "בדיקה חדש");
    const calls = Q.parseCallog(get("callog.ib")).entries.reduce((n, e) => n + e.calls.length, 0);
    const events = Q.parseSchedule(get("schedule.ib")).events.length;
    const memoMan = Q.parseManifest(get("memo.ib")).entries.length;
    const lst = Q.parseLst(get("שירים.lst"));
    const udb = Q.parseUdb(get("000000000000001")).words;
    const crcOk = head.crcs[2] === Q.crc16arc(get("phonebook.ib")) && head.crcs[0] === Q.crc16arc(get("schedule.ib")) && head.crcs[1] === Q.crc16arc(get("callog.ib"));
    return [pb.contacts.length, added ? added.mobile + "/" + added.group + "/bit" + added.groupBit : "חסר", calls, events, memoMan, lst.map(e => e.path).join(","), udb.join(","), head.categories.length, crcOk ? "crc-ok" : "crc-bad", head.folder === folder ? "folder-ok" : "folder-bad"].join(" | ");
  })()`, v => v === "4 | 0501112222/חברים/bit2 | 2 | 2 | 2 | E:\\b.mp3,E:\\a.mp3 | אנקל | 7 | crc-ok | folder-ok");
  await step("אין שינויים אחרי השמירה", `document.querySelector(".qx-save .qx-dirty") ? "יש" : "אין"`, "אין");
  await step("אין שורת מקור בתוך קטגוריה", `document.querySelector("#qualix-root .qx-source") ? "יש" : "אין"`, "אין");
  await step("שתי גרסאות ברשימה", `(() => { document.querySelector('[data-page="qualix"]').click(); return document.querySelectorAll("#qualix-root .qx-version").length; })()`, 2);
  await step("שורת המקור חזרה בעמוד הגרסאות", `document.querySelector("#qualix-root .qx-source") ? "יש" : "אין"`, "יש");
  await step("הגרסה החדשה היא הנוכחית", `document.querySelector("#qualix-root .qx-version.current h3")?.textContent`, v => /2026/.test(v));

  // שינוי בגרסה הפתוחה ואז פתיחת גרסה אחרת — חייב לשאול
  await step("חזרה לעורך", `(() => { document.querySelector('#qualix-subnav [data-tab="dictionary"]').click(); return document.getElementById("page-title").textContent; })()`, "חיזוי טקסט");
  await step("שינוי נוסף (מילה)", `(() => { document.getElementById("qx-word").value = "שלום"; document.querySelector('[data-qx="add-word"]').click(); return document.querySelectorAll("#qualix-root .qx-word").length; })()`, 2);
  await step("לגרסאות", click('[data-page="qualix"]'));
  await step("פתיחת הגרסה הישנה", `(() => { const btns = [...document.querySelectorAll('#qualix-root [data-qx="open"]')]; btns[btns.length - 1].click(); return btns.length; })()`, 2);
  await wait(300);
  await step("נשאלנו על שינויים שלא נשמרו", `document.getElementById("modal-title")?.textContent`, v => /לשמור/.test(v));
  await step("המשך בלי לשמור", click('[data-modal-choice="discard"]'));
  await wait(500);
  await step("הגרסה הישנה נפתחה (3 אנשי קשר)", `document.querySelectorAll('#qualix-root .contact-card[data-qx="edit-contact"]').length`, 3);
  await step("לגרסאות", click('[data-page="qualix"]'));
  await step("פתיחת הגרסה החדשה בלי שאלה", click('[data-qx="open"]'));
  await wait(500);
  await step("אין חלון פתוח", `document.getElementById("modal-backdrop").classList.contains("open") ? "פתוח" : "סגור"`, "סגור");
  await step("העברה לניהול אנשי קשר", click('[data-qx="contacts-to-list"]'));
  await wait(300);
  await step("יצירת הרשימה", click('[data-modal-choice="go"]'));
  await wait(500);
  await step("עברנו לעמוד אנשי קשר", `document.getElementById("page-title").textContent`, "אנשי קשר");
  await step("ארבעה אנשי קשר ברשימה", `document.getElementById("nav-contact-count").textContent`, "4");
  await step("הקבוצה נשמרה ברשימה (3 עם קבוצה)", `JSON.stringify(JSON.parse(localStorage.getItem("ankal.v2.workspace") || "{}").lists?.map(l => l.contacts.filter(c => c.group).length))`, v => /3/.test(v));
  await step("עריכת איש קשר מציגה שדה קבוצה", `(() => { document.querySelector("[data-open-contact]").click(); return document.getElementById("contact-group") ? document.getElementById("contact-group").value : "אין שדה"; })()`, v => v !== "אין שדה");

  console.log("\n=== בדיקת עשן: גיבוי קיוליקס ===");
  for (const s of steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.label}: ${JSON.stringify(s.value)}`);
  if (consoleErrors.length) { console.log("\n=== שגיאות ריצה ==="); for (const e of [...new Set(consoleErrors)]) console.log("  ! " + e.slice(0, 500)); } else console.log("\nאין שגיאות ריצה.");
  cleanup(consoleErrors.length || steps.some(s => !s.ok) ? 1 : 0);
  function cleanup(code) { try { proc.kill(); } catch (_) { } server.close(); setTimeout(() => process.exit(code), 300); }
});

function get(url) { return new Promise((resolve, reject) => { http.get(url, res => { let body = ""; res.on("data", d => body += d); res.on("end", () => resolve(body)); }).on("error", reject); }); }
async function loadWs() {
  const net = require("net"), crypto = require("crypto"), { EventEmitter } = require("events");
  return class WS extends EventEmitter {
    constructor(url) {
      super(); const parsed = new URL(url); const key = crypto.randomBytes(16).toString("base64"); this.on("error", () => { });
      this.socket = net.connect(Number(parsed.port), parsed.hostname, () => { this.socket.write(`GET ${parsed.pathname} HTTP/1.1\r\nHost: ${parsed.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`); });
      this.socket.on("error", () => { }); let handshake = false; let buffer = Buffer.alloc(0);
      this.socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!handshake) { const end = buffer.indexOf("\r\n\r\n"); if (end < 0) return; handshake = true; buffer = buffer.slice(end + 4); this.emit("open"); }
        while (buffer.length >= 2) { const len1 = buffer[1] & 127; let offset = 2, length = len1; if (len1 === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; } else if (len1 === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; } if (buffer.length < offset + length) return; const payload = buffer.slice(offset, offset + length); buffer = buffer.slice(offset + length); this.emit("message", payload); }
      });
    }
    send(text) { const payload = Buffer.from(text); const mask = crypto.randomBytes(4); const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4])); let header; if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]); else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0xFE; header.writeUInt16BE(payload.length, 2); } else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0xFF; header.writeBigUInt64BE(BigInt(payload.length), 2); } this.socket.write(Buffer.concat([header, mask, masked])); }
  };
}
