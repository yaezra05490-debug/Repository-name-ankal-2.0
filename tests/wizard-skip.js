/* בדיקת "דלג" באשף: לוחצים דלג / דלג על הסוג / השאר נפרדים שוב ושוב בדפדפן
   אמיתי, ובודקים שכל לחיצה משנה את המסך. מסך שחוזר על עצמו אחרי לחיצה = תקוע.
   נכתב אחרי תלונה של משתמש שכפתור דלג הפסיק להגיב. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..", "src");

function findBrowser() {
  if (process.argv[2]) return process.argv[2];
  const candidates = [
    process.env.PROGRAMFILES + "\\Google\\Chrome\\Application\\chrome.exe",
    process.env["PROGRAMFILES(X86)"] + "\\Google\\Chrome\\Application\\chrome.exe",
    process.env.PROGRAMFILES + "\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env["PROGRAMFILES(X86)"] + "\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  for (const candidate of candidates) if (candidate && fs.existsSync(candidate)) return candidate;
  return null;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/seed.html") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><meta charset=utf-8><title>seed</title>"); return; }
  const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const PORT = 8732;
server.listen(PORT, async () => {
  const browser = findBrowser();
  if (!browser) { console.log("לא נמצא דפדפן — דילוג."); server.close(); return; }
  const userDir = path.join(require("os").tmpdir(), "ankal-skip-" + Date.now());
  const proc = cp.spawn(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--user-data-dir=" + userDir, "--remote-debugging-port=9334", `http://127.0.0.1:${PORT}/seed.html`], { stdio: ["ignore", "pipe", "pipe"] });

  let target = null;
  const started = Date.now();
  while (Date.now() - started < 20000 && !target) {
    await new Promise((r) => setTimeout(r, 400));
    try { target = JSON.parse(await get("http://127.0.0.1:9334/json/list")).find((t) => t.type === "page" && t.webSocketDebuggerUrl); } catch (_) {}
  }
  if (!target) { console.error("הדפדפן לא עלה"); cleanup(1); return; }

  const WebSocket = await loadWs();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1; const pending = new Map(); const errors = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") errors.push("EXCEPTION: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("CONSOLE: " + msg.params.args.map((a) => a.description || a.value).join(" "));
  });
  const send = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || "eval failed");
    return res.result?.result?.value;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await new Promise((r) => ws.on("open", r));
  await send("Runtime.enable"); await send("Page.enable"); await wait(1200);

  /* רשימה שמייצרת כל סוג מסך: סימונים (כולל שם שכולו סימון), וכפולים מכל
     הקטגוריות — זהים, בטוח, שם, מספרים, שניהם, מייל, דומה-חלש. */
  const reseed = async () => { await ev(`location.href = "/seed.html", "nav"`); await wait(700); await ev(SEED); await ev(`location.href = "/index.html?app=1", "nav"`); await wait(2200); await ev(`document.querySelector('[data-page="smart"]').click(), 1`); await wait(200); await ev(`document.querySelector('[data-action="scan-symbols"]').click(), 1`); await wait(900); };
  const SEED = `(() => {
    const seed = [
      { name: "מרים הריס_1", mobile: "050-1234567" }, { name: "מרים הריס_2", mobile: "050-1234567" },
      { name: "_1", mobile: "050-0000001" },
      { name: "★", mobile: "050-0000002" },
      { name: "דנה ★ לוי", mobile: "054-9998888" }, { name: "רון ★ גל", mobile: "054-9998877" },
      { name: "אבי_כהן", mobile: "052-1111111" },
      { name: "טל", mobile: "050-2222222" }, { name: "טל", mobile: "050-2222222" },
      { name: "טל", mobile: "050-2222223" }, { name: "טל", mobile: "050-2222223", email: "t@x.co" },
      { name: "יעל שמש", mobile: "03-1234567" }, { name: "יעל ש.", home: "+972-3-1234567" },
      { name: "רון גל", mobile: "03-1112222" }, { name: "רון גל", mobile: "052-3334444" },
      { name: "נועה", mobile: "050-5555555" }, { name: "נועה בר", mobile: "050-5555555", home: "02-5555555" },
      { name: "עדי", email: "a@x.co", mobile: "050-6666666" }, { name: "עדי", email: "b@x.co", mobile: "050-6666666" },
      { name: "גילה שטיב", mobile: "052-7777777" }, { name: "גילה שטיבל", mobile: "053-7777778" },
      { name: "קוד", mobile: "8224" }, { name: "קוד", mobile: "4939" },
      { name: "רות אבן", mobile: "050-8888888" }, { name: "רות אבן", mobile: "050-8888888" },
      { name: "יחיד", mobile: "058-1231234" }
    ];
    localStorage.setItem("ankal.v2.workspace", JSON.stringify({ lists: [{ id: "list_skip", name: "דלג", contacts: seed.map((c, i) => Object.assign({ id: "c" + i, name: "", mobile: "", home: "", work: "", fax: "", email: "", note: "" }, c)), version: 1, remoteVersion: 0, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), importHashes: [], separatedPairs: [], undo: [], redo: [], dirty: false }], activeListId: "list_skip" }));
    localStorage.setItem("ankal.entryChoice", "offline");
    return "ok";
  })()`;
  await ev(SEED);
  await ev(`location.href = "/index.html?app=1", "nav"`); await wait(2200);
  await ev(`document.querySelector('[data-page="smart"]').click(), 1`); await wait(200);
  await ev(`document.querySelector('[data-action="scan-symbols"]').click(), 1`); await wait(900);

  const snapshot = () => ev(`(() => {
    const p = document.getElementById("smart-review");
    const step = p.querySelector(".qstep"); const item = p.querySelector(".qitem"); const done = p.querySelector(".qdone"); const sum = p.querySelector(".qsummary");
    return {
      screen: done ? "done" : sum ? "overview" : item ? "item" : step ? "step" : "?",
      key: (step || item)?.closest("[data-step-key]")?.dataset.stepKey || document.querySelector("#smart-review [data-step-key]")?.dataset.stepKey || "",
      pos: item?.querySelector(".qitem-pos")?.textContent.trim() || "",
      title: (item?.querySelector("h2") || step?.querySelector("h2"))?.textContent.trim() || "",
      hasSkipItem: !!p.querySelector('[data-action="review-skip-item"]'),
      hasSkipStep: !!p.querySelector('[data-action="review-skip-step"]'),
      hasSeparate: !!p.querySelector('[data-action="review-separate"]'),
      hasOneByOne: !!p.querySelector('[data-action="review-one-by-one"]')
    };
  })()`);
  const click = async (action) => { await ev(`document.querySelector('[data-action="${action}"]')?.click(), 1`); await wait(160); };
  const sig = (s) => `${s.screen}|${s.key}|${s.pos}|${s.title}`;

  const results = [];
  const record = (label, ok, value) => { results.push({ label, ok, value }); };

  const overview = await snapshot();
  record("מסך הסיכום אחרי הסריקה", overview.screen === "overview", overview.screen);
  const cards = await ev(`[...document.querySelectorAll("#smart-review .qcard-title")].map(e => e.textContent).join(" | ")`);
  record("סוגים שנמצאו", true, cards);

  /* מסלול 1: "דלג ←" על כל פריט, בכל שלב, עד הסוף. */
  await click("review-start");
  let guard = 0, stuck = null, prev = null, transitions = 0;
  while (guard++ < 200) {
    const s = await snapshot();
    if (s.screen === "done" || s.screen === "overview") break;
    if (prev && sig(s) === prev) { stuck = { after: lastAction, at: s }; break; }
    prev = sig(s); transitions++;
    var lastAction;
    if (s.screen === "step" && s.hasOneByOne) { lastAction = "review-one-by-one"; await click(lastAction); continue; }
    if (s.screen === "item" && s.hasSkipItem) { lastAction = "review-skip-item"; await click(lastAction); continue; }
    stuck = { after: "(אין כפתור מתאים)", at: s }; break;
  }
  const end1 = await snapshot();
  record("מסלול דלג-פריט: הגיע לסוף בלי להיתקע", !stuck && end1.screen === "done", stuck ? `נתקע אחרי ${stuck.after} על: ${JSON.stringify(stuck.at)}` : `${transitions} מעברים → ${end1.screen}`);

  /* מסלול 2: סריקה מחדש, "דלג על הסוג הזה" בכל שלב. */
  await click("review-rescan"); await wait(900); await click("review-start");
  guard = 0; stuck = null; prev = null; transitions = 0;
  while (guard++ < 60) {
    const s = await snapshot();
    if (s.screen === "done" || s.screen === "overview") break;
    if (prev && sig(s) === prev) { stuck = { after: "review-skip-step", at: s }; break; }
    prev = sig(s); transitions++;
    if (s.hasSkipStep) { await click("review-skip-step"); continue; }
    stuck = { after: "(אין כפתור דלג-סוג)", at: s }; break;
  }
  const end2 = await snapshot();
  record("מסלול דלג-סוג: הגיע לסוף בלי להיתקע", !stuck && end2.screen === "done", stuck ? `נתקע על: ${JSON.stringify(stuck.at)}` : `${transitions} מעברים → ${end2.screen}`);

  /* מסלול 3: "אלה אנשים שונים" על כל קבוצת כפולים; "הסר" על כל סימון. */
  await click("review-rescan"); await wait(900); await click("review-start");
  guard = 0; stuck = null; prev = null; transitions = 0;
  while (guard++ < 200) {
    const s = await snapshot();
    if (s.screen === "done" || s.screen === "overview") break;
    if (prev && sig(s) === prev) { stuck = { after: lastAction, at: s }; break; }
    prev = sig(s); transitions++;
    if (s.screen === "step" && s.hasOneByOne) { lastAction = "review-one-by-one"; await click(lastAction); continue; }
    if (s.screen === "item" && s.hasSeparate) { lastAction = "review-separate"; await click(lastAction); continue; }
    if (s.screen === "item") { lastAction = "review-apply"; await click(lastAction); continue; }
    stuck = { after: "(אין כפתור)", at: s }; break;
  }
  const end3 = await snapshot();
  record("מסלול השאר-נפרדים/הסר: הגיע לסוף בלי להיתקע", !stuck && end3.screen === "done", stuck ? `נתקע אחרי ${stuck.after} על: ${JSON.stringify(stuck.at)}` : `${transitions} מעברים → ${end3.screen}`);

  /* מסלול 3ב — התלונה עצמה: לחצו "דלג" בטעות על קבוצת כפולים, ורוצים לחזור
     אליה כדי ללחוץ "אלה אנשים שונים". */
  await reseed();
  {
    // קופצים מהסיכום ישירות לכרטיס כפולים עם 2+ קבוצות, כדי שאחרי דלג יש עוד פריט.
    await ev(`(() => { const c = [...document.querySelectorAll("#smart-review .qcard")].find(el => !/סיומת|תו מיוחד|קו תחתון/.test(el.textContent) && Number(el.querySelector(".qcard-num")?.textContent) >= 2); c?.click(); return !!c; })()`);
    await wait(200);
    await click("review-one-by-one");
    const before = await snapshot();
    record("לפני הדילוג בטעות: מסך פריט של כפולים", before.screen === "item" && before.hasSeparate, `${before.title} · ${before.pos}`);
    const noBackYet = await ev(`!document.querySelector('[data-action="review-back"]')`);
    record("בלי דילוג אין כפתור 'הקודם'", noBackYet === true, String(noBackYet));
    await click("review-skip-item");
    const after = await snapshot();
    record("אחרי דלג: עברנו לפריט אחר", sig(after) !== sig(before), `${after.title} · ${after.pos}`);
    const hasBack = await ev(`!!document.querySelector('[data-action="review-back"]')`);
    record("אחרי דלג: כפתור 'הקודם' מופיע", hasBack === true, String(hasBack));
    await click("review-back");
    const back = await snapshot();
    record("'הקודם' מחזיר בדיוק לפריט שדילגו עליו", sig(back) === sig(before), `${back.title} · ${back.pos}`);
    record("ועכשיו אפשר ללחוץ 'אלה אנשים שונים'", back.hasSeparate === true, String(back.hasSeparate));
    const countBefore = await ev(`document.querySelectorAll("#smart-review .qtable tbody tr").length`);
    await click("review-separate");
    const separated = await snapshot();
    record("'אלה אנשים שונים' עבד אחרי החזרה", sig(separated) !== sig(back), `${countBefore} שורות → ${separated.title} · ${separated.pos}`);
  }

  /* מסלול 3ג: דילוג על הפריט האחרון נוחת ב"סיימנו" — גם משם חייבת להיות חזרה. */
  await click("review-rescan"); await wait(900); await click("review-start");
  guard = 0;
  while (guard++ < 200) {
    const s = await snapshot();
    if (s.screen === "done") break;
    if (s.screen === "step") { await click("review-one-by-one"); continue; }
    if (s.screen === "item") { await click("review-skip-item"); continue; }
    break;
  }
  const doneScreen = await snapshot();
  const doneHasBack = await ev(`!!document.querySelector('#smart-review .qdone [data-action="review-back"]')`);
  record("אחרי דילוג על הכול: מסך סיימנו עם כפתור חזרה", doneScreen.screen === "done" && doneHasBack, `${doneScreen.screen} · back=${doneHasBack}`);
  await click("review-back");
  const fromDone = await snapshot();
  record("חזרה מ'סיימנו' מגיעה לפריט האחרון שדילגו עליו", fromDone.screen === "item", `${fromDone.title} · ${fromDone.pos}`);

  /* מסלול 3ד: Enter לא מאשר מיזוג גורף — רק לחיצה. */
  await reseed();
  {
    const auto = await ev(`!!document.querySelector('[data-action="review-auto"]')`);
    if (auto) {
      const before = await ev(`document.getElementById("nav-contact-count").textContent`);
      await click("review-auto");
      const open = await ev(`document.getElementById("modal-backdrop").classList.contains("open")`);
      await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })), 1`); await wait(300);
      const stillOpen = await ev(`document.getElementById("modal-backdrop").classList.contains("open")`);
      const after = await ev(`document.getElementById("nav-contact-count").textContent`);
      record("Enter לא מאשר 'מזג את הוודאיים'", open && stillOpen && before === after, `חלון נשאר פתוח=${stillOpen}, אנשי קשר ${before}→${after}`);
      await ev(`document.querySelector('[data-modal-choice="no"]')?.click(), 1`); await wait(150);
    } else record("Enter לא מאשר 'מזג את הוודאיים'", true, "(אין כפולים ודאיים ברשימה — דילוג)");
  }
  { // ולעומת זאת, בחלון עריכה רגיל Enter כן שומר.
    await click("review-start"); await wait(150);
    let s = await snapshot(); guard = 0;
    while (guard++ < 20 && !(s.screen === "item")) { await click(s.hasOneByOne ? "review-one-by-one" : "review-skip-step"); s = await snapshot(); }
    await ev(`document.querySelector('#smart-review [data-review-edit-contact]')?.click(), 1`); await wait(200);
    const open = await ev(`document.getElementById("modal-backdrop").classList.contains("open")`);
    await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })), 1`); await wait(300);
    const closed = await ev(`!document.getElementById("modal-backdrop").classList.contains("open")`);
    record("Enter כן מאשר חלון עריכה רגיל", open && closed, `נפתח=${open}, נסגר=${closed}`);
  }

  /* מסלול 4: מהמסך "סיימנו" — לסיכום, קפיצה לכרטיס, ושוב דלג. */
  await click("review-overview"); await wait(200);
  const ov = await snapshot();
  record("חזרה לסיכום מהסוף", ov.screen === "overview", ov.screen);
  await ev(`document.querySelector("#smart-review .qcard")?.click(), 1`); await wait(200);
  const jumped = await snapshot();
  record("קפיצה מכרטיס לשלב", jumped.screen === "step", JSON.stringify(jumped));
  if (jumped.hasSkipStep) { await click("review-skip-step"); const after = await snapshot(); record("דלג-סוג אחרי קפיצה עובד", sig(after) !== sig(jumped), after.screen + " " + after.title); }

  console.log("\n=== בדיקת דלג באשף ===");
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.label}: ${r.value}`);
  if (errors.length) { console.log("\n=== שגיאות ריצה ==="); for (const e of [...new Set(errors)]) console.log("  ! " + e.slice(0, 500)); }
  else console.log("\nאין שגיאות ריצה.");
  cleanup(errors.length || results.some((r) => !r.ok) ? 1 : 0);

  function cleanup(code) { try { proc.kill(); } catch (_) {} server.close(); setTimeout(() => process.exit(code), 300); }
});

function get(url) { return new Promise((resolve, reject) => { http.get(url, (res) => { let body = ""; res.on("data", (d) => body += d); res.on("end", () => resolve(body)); }).on("error", reject); }); }

async function loadWs() {
  const net = require("net"); const crypto = require("crypto"); const { EventEmitter } = require("events");
  return class WS extends EventEmitter {
    constructor(url) {
      super(); const parsed = new URL(url); const key = crypto.randomBytes(16).toString("base64");
      this.on("error", () => {});
      this.socket = net.connect(Number(parsed.port), parsed.hostname, () => { this.socket.write(`GET ${parsed.pathname} HTTP/1.1\r\nHost: ${parsed.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`); });
      this.socket.on("error", () => {});
      let handshake = false; let buffer = Buffer.alloc(0);
      this.socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!handshake) { const end = buffer.indexOf("\r\n\r\n"); if (end < 0) return; handshake = true; buffer = buffer.slice(end + 4); this.emit("open"); }
        while (buffer.length >= 2) {
          const len1 = buffer[1] & 127; let offset = 2, length = len1;
          if (len1 === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
          else if (len1 === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
          if (buffer.length < offset + length) return;
          const payload = buffer.slice(offset, offset + length); buffer = buffer.slice(offset + length); this.emit("message", payload);
        }
      });
    }
    send(text) {
      const payload = Buffer.from(text); const mask = crypto.randomBytes(4); const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      let header;
      if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
      else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0xFE; header.writeUInt16BE(payload.length, 2); }
      else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0xFF; header.writeBigUInt64BE(BigInt(payload.length), 2); }
      this.socket.write(Buffer.concat([header, mask, masked]));
    }
  };
}
