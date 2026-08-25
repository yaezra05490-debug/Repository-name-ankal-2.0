/* בדיקת עשן: מריצים את האתר בדפדפן אמיתי (headless), מזריקים רשימה עם כפולים
   וסימונים, ומריצים את האשף מקצה לקצה — כדי לתפוס שגיאות ריצה שבדיקות סטטיות
   לא רואות. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..", "src");

/* נתיב הדפדפן: פרמטר מפורש, אחרת מאתרים Chrome או Edge. */
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf", ".txt": "text/plain", ".xml": "text/xml" };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  // עמוד זרע ריק באותו origin: מזריקים ממנו את הרשימה ל-localStorage לפני
  // שהאפליקציה נטענת, כדי ש-beforeunload שלה לא ידרוס את הזרע בטעינה מחדש.
  if (rel === "/seed.html") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><meta charset=utf-8><title>seed</title>");
    return;
  }
  const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const PORT = 8731;
server.listen(PORT, async () => {
  const browser = findBrowser();
  if (!browser) {
    console.log("לא נמצא Chrome או Edge — בדיקת העשן דורשת דפדפן. דילוג.");
    server.close();
    return;
  }
  const userDir = path.join(require("os").tmpdir(), "ankal-smoke-" + Date.now());
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    "--user-data-dir=" + userDir,
    "--remote-debugging-port=9333",
    `http://127.0.0.1:${PORT}/seed.html`
  ];
  const proc = cp.spawn(browser, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d.toString(); });

  const started = Date.now();
  let target = null;
  while (Date.now() - started < 20000 && !target) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const list = await get(`http://127.0.0.1:9333/json/list`);
      target = JSON.parse(list).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    } catch (_) { /* עוד לא עלה */ }
  }
  if (!target) { console.error("הדפדפן לא עלה\n" + stderr.slice(-1500)); cleanup(1); return; }

  const WebSocket = await loadWs();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const consoleErrors = [];

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push("EXCEPTION: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push("CONSOLE: " + msg.params.args.map((a) => a.description || a.value).join(" "));
    }
  });

  const send = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || "eval failed");
    return res.result?.result?.value;
  };

  await new Promise((r) => ws.on("open", r));
  await send("Runtime.enable");
  await send("Page.enable");
  await new Promise((r) => setTimeout(r, 1500));

  const steps = [];
  const step = async (label, expression) => {
    try { const value = await evaluate(expression); steps.push({ label, ok: true, value }); return value; }
    catch (error) { steps.push({ label, ok: false, value: error.message }); return null; }
  };

  await step("עמוד הזרע נטען", "document.title");

  // שותלים רשימה עם סימונים ועם כמה סוגי כפילות.
  await step("שתילת רשימה", `(() => {
    const seed = [
      { name: "מרים הריס_1", mobile: "050-1234567" },
      { name: "מרים הריס",   mobile: "0501234567", email: "m@x.co" },
      { name: "גילה שטיב",   mobile: "052-1111111" },
      { name: "גילה שטיבל",  mobile: "053-2222222" },
      { name: "רון גל",      mobile: "03-1112222" },
      { name: "רון גל",      mobile: "052-3334444" },
      { name: "דנה ★ לוי",   mobile: "054-9998888" },
      { name: "אבי כהן",     mobile: "501234599" },
      { name: "אבי כהן",     mobile: "0501234599" },
      { name: "יחיד אחד",    mobile: "058-7776666" }
    ];
    localStorage.setItem("ankal.v2.workspace", JSON.stringify({
      lists: [{ id: "list_smoke", name: "בדיקה", contacts: seed.map((c, i) => Object.assign(
        { id: "c" + i, name: "", mobile: "", home: "", work: "", fax: "", email: "", note: "" }, c)),
        version: 1, remoteVersion: 0, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
        importHashes: [], separatedPairs: [], undo: [], redo: [], dirty: false }],
      activeListId: "list_smoke"
    }));
    return "ok";
  })()`);

  await step("מעבר לאפליקציה", `location.href = "/index.html", 'navigating'`);
  await new Promise((r) => setTimeout(r, 2500));
  await step("האתר נטען", "document.title");
  await step("המנוע נטען", "typeof window.ANKAL_DEDUPE");
  await step("הרשימה נקלטה", `document.getElementById("nav-contact-count").textContent`);

  await step("כפתור הורדת התוכנה קיים בדף הנחיתה", `document.querySelector('[data-action="download-app"]')?.textContent.trim() || "חסר"`);
  await step("כניסה לאפליקציה", `document.querySelector('[data-action="enter-app"]').click(), 'clicked'`);
  await new Promise((r) => setTimeout(r, 500));

  await step("נשאלת שאלת מצב העבודה", `document.getElementById("modal-title")?.textContent || "לא נשאלה"`);
  await step("בחירת מצב אופליין", `(() => {
    const b = document.querySelector('[data-modal-choice="offline"]'); if (!b) return "אין כפתור אופליין";
    b.click(); return "clicked";
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  await step("סדר התפריט", `[...document.querySelectorAll(".side-nav .nav-item")].map(b=>b.querySelector(".nav-label").textContent).join(" › ")`);
  await step("כרטיס אנשי קשר צבעוני", `(() => {
    document.querySelector('[data-page="contacts"]').click();
    const card = document.querySelector(".contact-card");
    if (!card) return "אין כרטיס";
    return card.style.getPropertyValue("--tint") + " · " + (card.querySelector(".contact-avatar")?.textContent || "אין עיגול");
  })()`);
  await step("גובה הכרטיסים נקבע לפי התוכן", `(() => {
    const hs = [...document.querySelectorAll(".contact-card")].map(c => Math.round(c.getBoundingClientRect().height));
    return "מינימום " + Math.min(...hs) + "px, מקסימום " + Math.max(...hs) + "px";
  })()`);

  await step("פס המלצה בניקוי והחלפה", `(() => {
    document.querySelector('[data-page="clean"]').click();
    return document.querySelector('[data-page-panel="clean"] .suggest-bar .btn')?.textContent.trim() || "אין פס";
  })()`);
  await step("פס המלצה בבדיקת כפולים", `(() => {
    document.querySelector('[data-page="duplicates"]').click();
    return document.querySelector('[data-page-panel="duplicates"] .suggest-bar .btn')?.textContent.trim() || "אין פס";
  })()`);
  await step("הפס מעביר לניהול חכם", `(() => {
    document.querySelector('[data-page-panel="duplicates"] .suggest-bar .btn').click();
    return document.getElementById("page-title").textContent;
  })()`);

  await step("הפעלת סריקה", `document.querySelector('[data-action="scan-symbols"]').click(), 'clicked'`);
  await new Promise((r) => setTimeout(r, 900));

  await step("מסך סיכום מוצג", `document.getElementById("smart-review").querySelector(".qsummary") ? "yes" : document.getElementById("smart-review").innerHTML.slice(0,200)`);
  await step("כמה סוגי בעיות נמצאו", `document.querySelectorAll("#smart-review .qcard").length`);
  await step("כותרות הכרטיסים", `[...document.querySelectorAll("#smart-review .qcard-title")].map(e=>e.textContent).join(" | ")`);

  await step("התחלת האשף", `document.querySelector('[data-action="review-start"]').click(), 'clicked'`);
  await new Promise((r) => setTimeout(r, 400));
  await step("מסך שלב מוצג", `document.querySelector("#smart-review .qstep h2")?.textContent || "אין מסך שלב"`);

  await step("מעבר אחד-אחד", `document.querySelector('[data-action="review-one-by-one"]').click(), 'clicked'`);
  await new Promise((r) => setTimeout(r, 400));
  await step("מסך פריט מוצג", `document.querySelector("#smart-review .qitem") ? "yes" : "no"`);
  await step("שם אחרי הסרת הסימון", `document.querySelector("#smart-review .qname-new")?.textContent || "—"`);

  await step("החלת ההסרה", `document.querySelector('[data-action="review-apply"]').click(), 'clicked'`);
  await new Promise((r) => setTimeout(r, 500));

  // עוברים לשלבי הכפולים: מדלגים על שלבים עד שמגיעים לקבוצת כפולים.
  for (let i = 0; i < 10; i++) {
    const key = await evaluate(`document.querySelector("#smart-review .qstep")?.dataset.stepKey || ""`);
    if (key === "phone") break;
    const next = await evaluate(`(() => {
      const b = document.querySelector('[data-action="review-skip-step"]') || document.querySelector('[data-action="review-skip-item"]');
      if (!b) return "none"; b.click(); return "clicked";
    })()`);
    if (next === "none") break;
    await new Promise((r) => setTimeout(r, 350));
  }
  await step("הגענו לשלב כפולים", `(() => {
    const el = document.querySelector("#smart-review .qstep");
    return el ? el.dataset.stepKind + " · " + el.dataset.stepKey : "לא הגענו למסך שלב";
  })()`);

  await step("פתיחת קבוצה אחת-אחת", `(() => {
    const b = document.querySelector('[data-action="review-one-by-one"]'); if (!b) return "no button"; b.click(); return "clicked";
  })()`);
  await new Promise((r) => setTimeout(r, 450));
  await step("טבלת השוואה מוצגת", `document.querySelectorAll("#smart-review .qtable tbody tr").length`);
  await step("שאלות שהוצגו", `[...document.querySelectorAll("#smart-review .qq-title")].map(e=>e.textContent).join(" | ") || "אין שאלות (מיזוג בטוח)"`);
  await step("שיוך מספרים שהוצע", `[...document.querySelectorAll("#smart-review .qphone")].map(r=>r.querySelector(".qphone-num").textContent+"→"+r.querySelector("select").selectedOptions[0].textContent).join(" | ") || "—"`);

  // המונה בסרגל משקף את הזיכרון מיד; ה-localStorage נכתב בהשהיה.
  const before = Number(await evaluate(`document.getElementById("nav-contact-count").textContent`));
  await step("מיזוג הקבוצה", `document.querySelector('[data-action="review-apply"]').click(), 'clicked'`);
  await new Promise((r) => setTimeout(r, 600));
  const after = Number(await evaluate(`document.getElementById("nav-contact-count").textContent`));
  steps.push({ label: "מספר אנשי הקשר אחרי מיזוג", ok: after === before - 1, value: `${before} → ${after}` });

  await step("ביטול הפעולה עובד", `(() => {
    const b = document.getElementById("undo-btn"); if (!b || b.disabled) return "כפתור הביטול מושבת";
    b.click(); return document.getElementById("nav-contact-count").textContent;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await step("ביצוע מחדש עובד", `(() => {
    const b = document.getElementById("redo-btn"); if (!b || b.disabled) return "כפתור החזרה מושבת";
    b.click(); return document.getElementById("nav-contact-count").textContent;
  })()`);

  // ממתינים לכתיבה המושהית ואז בודקים שהתוצאה באמת נשמרה.
  await new Promise((r) => setTimeout(r, 2500));
  await step("התוצאה נשמרה", `(() => {
    const cs = JSON.parse(localStorage.getItem("ankal.v2.workspace")).lists[0].contacts;
    return cs.length + " אנשי קשר: " + cs.map(c => [c.name, c.mobile, c.home].filter(Boolean).join("/")).join(" ; ");
  })()`);

  console.log("\n=== בדיקת עשן ===");
  for (const s of steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.label}: ${JSON.stringify(s.value)}`);
  if (consoleErrors.length) {
    console.log("\n=== שגיאות ריצה ===");
    for (const e of [...new Set(consoleErrors)]) console.log("  ! " + e.slice(0, 400));
  } else {
    console.log("\nאין שגיאות ריצה.");
  }
  cleanup(consoleErrors.length || steps.some((s) => !s.ok) ? 1 : 0);

  function cleanup(code) {
    try { proc.kill(); } catch (_) {}
    server.close();
    setTimeout(() => process.exit(code), 300);
  }
});

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let body = ""; res.on("data", (d) => body += d); res.on("end", () => resolve(body)); }).on("error", reject);
  });
}

async function loadWs() {
  // מימוש WebSocket מינימלי מעל net, כדי לא לדרוש התקנת חבילות.
  const net = require("net");
  const crypto = require("crypto");
  const { EventEmitter } = require("events");
  return class WS extends EventEmitter {
    constructor(url) {
      super();
      const parsed = new URL(url);
      const key = crypto.randomBytes(16).toString("base64");
      this.on("error", () => {}); // ניתוק בסוף הריצה אינו כשל
      this.socket = net.connect(Number(parsed.port), parsed.hostname, () => {
        this.socket.write(
          `GET ${parsed.pathname} HTTP/1.1\r\nHost: ${parsed.host}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      let handshake = false;
      let buffer = Buffer.alloc(0);
      this.socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!handshake) {
          const end = buffer.indexOf("\r\n\r\n");
          if (end < 0) return;
          handshake = true;
          buffer = buffer.slice(end + 4);
          this.emit("open");
        }
        this.socket.on("error", () => {});
        while (buffer.length >= 2) {
          const len1 = buffer[1] & 127;
          let offset = 2, length = len1;
          if (len1 === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
          else if (len1 === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
          if (buffer.length < offset + length) return;
          const payload = buffer.slice(offset, offset + length);
          buffer = buffer.slice(offset + length);
          this.emit("message", payload);
        }
      });
    }
    send(text) {
      const payload = Buffer.from(text);
      const mask = crypto.randomBytes(4);
      const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      let header;
      if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
      else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0xFE; header.writeUInt16BE(payload.length, 2); }
      else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0xFF; header.writeBigUInt64BE(BigInt(payload.length), 2); }
      this.socket.write(Buffer.concat([header, mask, masked]));
    }
  };
}
