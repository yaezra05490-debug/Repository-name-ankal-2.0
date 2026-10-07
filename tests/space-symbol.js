/* בדיקת רווח מיותר בשם: שם עם רווח בתחילתו, בסופו או רווח כפול חייב להופיע
   בניהול החכם כסימון להסרה, הרווח חייב להיראות על המסך (␣), ואחרי "הסר" —
   אחד-אחד או מכולם — השם נשמר נקי. נכתב אחרי שמשתמש מצא " דני" שהאשף התעלם ממנו. */
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

const PORT = 8734;
const DEBUG_PORT = 9336;
server.listen(PORT, async () => {
  const browser = findBrowser();
  if (!browser) { console.log("לא נמצא דפדפן — דילוג."); server.close(); return; }
  const userDir = path.join(require("os").tmpdir(), "ankal-space-" + Date.now());
  const proc = cp.spawn(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--user-data-dir=" + userDir, "--remote-debugging-port=" + DEBUG_PORT, `http://127.0.0.1:${PORT}/seed.html`], { stdio: ["ignore", "pipe", "pipe"] });

  let target = null;
  const started = Date.now();
  while (Date.now() - started < 20000 && !target) {
    await new Promise((r) => setTimeout(r, 400));
    try { target = JSON.parse(await get(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).find((t) => t.type === "page" && t.webSocketDebuggerUrl); } catch (_) {}
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

  /* רווח בהתחלה, רווח כפול + רווח בסוף, רווח קשיח (NBSP) בהתחלה, שם שמכיל את
     המילה "רווח" (אסור שיסומן), ושם נקי. */
  const SEED = `(() => {
    const seed = [
      { name: " דני כהן", mobile: "050-1111111" },
      { name: "רון  גל ", mobile: "050-2222222" },
      { name: "\\u00a0יעל לוי", mobile: "050-3333333" },
      { name: "רווח גדול", mobile: "050-4444444" },
      { name: "יחיד", mobile: "050-5555555" }
    ];
    localStorage.setItem("ankal.v2.workspace", JSON.stringify({ lists: [{ id: "list_space", name: "רווחים", contacts: seed.map((c, i) => Object.assign({ id: "c" + i, name: "", mobile: "", home: "", work: "", fax: "", email: "", note: "" }, c)), version: 1, remoteVersion: 0, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), importHashes: [], separatedPairs: [], undo: [], redo: [], dirty: false }], activeListId: "list_space" }));
    localStorage.setItem("ankal.entryChoice", "offline");
    return "ok";
  })()`;
  const reseed = async () => {
    await ev(`location.href = "/seed.html", "nav"`); await wait(700); await ev(SEED);
    await ev(`location.href = "/index.html?app=1&offline=1", "nav"`); await wait(2200);
    await ev(`document.querySelector('[data-page="smart"]').click(), 1`); await wait(200);
    await ev(`document.querySelector('[data-action="scan-symbols"]').click(), 1`); await wait(900);
  };
  const click = async (action) => { await ev(`document.querySelector('[data-action="${action}"]')?.click(), 1`); await wait(200); };
  const savedNames = async () => { await wait(2500); return ev(`JSON.parse(localStorage.getItem("ankal.v2.workspace")).lists[0].contacts.map(c => c.name).sort()`); };
  const CLEAN = ["דני כהן", "יחיד", "יעל לוי", "רווח גדול", "רון גל"].sort();

  const results = [];
  const record = (label, ok, value) => { results.push({ label, ok, value }); };

  await reseed();
  const key = await ev(`window.ANKAL_DEDUPE.SPACE_KEY`);
  const cards = await ev(`[...document.querySelectorAll("#smart-review .qcard-title")].map(e => e.textContent).join(" | ")`);
  record("הסיכום מציג סוג 'רווח מיותר'", /רווח מיותר/.test(cards || ""), cards);

  /* מסלול 1: אחד-אחד. */
  await click("review-start");
  const stepKey = await ev(`document.querySelector("#smart-review [data-step-key]")?.dataset.stepKey || ""`);
  record("השלב הראשון הוא שלב הרווחים", stepKey === key, stepKey);
  const stepCount = await ev(`document.querySelector("#smart-review .qlead strong")?.textContent || ""`);
  record("שלושה אנשי קשר בשלב (לא 'רווח גדול' ולא 'יחיד')", stepCount === "3", stepCount);
  const chipMarks = await ev(`document.querySelectorAll("#smart-review .qchip .qspace").length`);
  record("הרווחים מסומנים כבר במסך השלב", chipMarks >= 3, String(chipMarks));

  await click("review-one-by-one");
  const before = await ev(`document.querySelector("#smart-review .qname")?.innerHTML || ""`);
  record("'השם היום' מציג את הרווח כ-␣", /qspace/.test(before) && before.includes("␣"), before.replace(/<[^>]+>/g, "").trim());
  const after = await ev(`document.querySelector("#smart-review .qname-new")?.textContent || ""`);
  record("'אחרי ההסרה' הוא השם הנקי", after === "דני כהן", JSON.stringify(after));

  let applied = 0;
  for (let guard = 0; guard < 10; guard++) {
    const onItem = await ev(`!!document.querySelector("#smart-review .qitem")`);
    if (!onItem) break;
    await click("review-apply"); applied++;
  }
  record("'הסר' עבר על כל שלושת הפריטים", applied === 3, String(applied));
  const names1 = await savedNames();
  record("אחד-אחד: כל השמות נשמרו נקיים", JSON.stringify(names1) === JSON.stringify(CLEAN), JSON.stringify(names1));

  /* מסלול 2: "הסר מכולם" במכה אחת. */
  await reseed();
  await click("review-start");
  await click("review-bulk");
  const confirmText = await ev(`document.getElementById("modal-backdrop")?.classList.contains("open") ? document.querySelector("#modal-backdrop p")?.textContent : "לא נפתח"`);
  record("'הסר מכולם' שואל על 3 אנשי קשר", /3 אנשי קשר/.test(confirmText || ""), confirmText);
  await ev(`document.querySelector('[data-modal-choice="yes"]')?.click(), 1`); await wait(500);
  const names2 = await savedNames();
  record("מכולם: כל השמות נשמרו נקיים", JSON.stringify(names2) === JSON.stringify(CLEAN), JSON.stringify(names2));
  const rescanned = await ev(`(() => { document.querySelector('[data-action="review-rescan"]')?.click(); return 1; })()`);
  await wait(900);
  const cardsAfter = await ev(`[...document.querySelectorAll("#smart-review .qcard-title")].map(e => e.textContent).join(" | ") || "(ריק)"`);
  record("סריקה חוזרת לא מוצאת רווחים", rescanned === 1 && !/רווח מיותר/.test(cardsAfter), cardsAfter);

  console.log("\n=== בדיקת רווח מיותר בשם ===");
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.label}: ${typeof r.value === "string" ? r.value : JSON.stringify(r.value)}`);
  if (errors.length) { console.log("\n=== שגיאות ריצה ==="); for (const e of [...new Set(errors)]) console.log("  ! " + e.slice(0, 400)); }
  else console.log("\nאין שגיאות ריצה.");
  cleanup(errors.length || results.some((r) => !r.ok) ? 1 : 0);

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
  // מימוש WebSocket מינימלי מעל net, כדי לא לדרוש התקנת חבילות (כמו ב-smoke.js).
  const net = require("net");
  const crypto = require("crypto");
  const { EventEmitter } = require("events");
  return class WS extends EventEmitter {
    constructor(url) {
      super();
      const parsed = new URL(url);
      const key = crypto.randomBytes(16).toString("base64");
      this.on("error", () => {});
      this.socket = net.connect(Number(parsed.port), parsed.hostname, () => {
        this.socket.write(
          `GET ${parsed.pathname} HTTP/1.1\r\nHost: ${parsed.host}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      this.socket.on("error", () => {});
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
