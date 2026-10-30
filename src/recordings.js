/* הקלטות שיחה — העמוד. ארכיון של כל הקלטות השיחה, מהכרטיס ומתיקיות במחשב, שנשמר במחשב הזה (IndexedDB) עם
   כל מה שנוסף להן: תמלול, סיכום, הערות, תגיות, מועדפים ושמות. ארבע תצוגות (רשימה, לוח שנה, אנשים, נתונים),
   חלונית פרטים, נגן בתחתית, ו-AI אצל הספק שהמשתמש בחר עם המפתח שלו (המפתחות נשמרים במחשב הזה בלבד).
   הלוגיקה ב-recordings-core.js; הכרטיס מגיע מגיבוי קיוליקס (qualix-ui.js → cardConnected). */
(function () {
  "use strict";
  const Q = window.ANKAL_QUALIX, C = window.ANKAL_RECORDINGS_CORE, A = () => window.ANKAL_APP, QX = () => window.ANKAL_QUALIX_UI;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = id => document.getElementById(id);
  const join = (...p) => p.filter(x => x !== "" && x != null).join("/");
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nf = n => Number(n || 0).toLocaleString("he-IL");
  const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : (n || 0) + " B";
  class UserError extends Error { constructor(m, code) { super(m); this.code = code; this.user = true; } }
  const onPage = () => document.getElementById("app-shell")?.dataset.activePage === "recordings";
  const modalOpen = () => document.getElementById("modal-backdrop")?.classList.contains("open");

  /* ---------- אחסון: IndexedDB בדפדפן/בתוכנה הזו; בלעדיו — זיכרון בלבד, עם אזהרה ---------- */
  const DB = {
    db: null, mem: null,
    open() {
      return new Promise(res => {
        const fallback = () => { DB.mem = { recs: new Map(), kv: new Map() }; res(false); };
        try { const q = indexedDB.open("ankal-recordings", 1); q.onupgradeneeded = () => { const d = q.result; if (!d.objectStoreNames.contains("recs")) d.createObjectStore("recs", { keyPath: "id" }); if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); }; q.onsuccess = () => { DB.db = q.result; res(true); }; q.onerror = fallback; q.onblocked = fallback; } catch (_) { fallback(); }
      });
    },
    tx(store, mode, fn) { return new Promise((res, rej) => { const t = DB.db.transaction(store, mode), q = fn(t.objectStore(store)); let out; if (q) q.onsuccess = () => { out = q.result; }; t.oncomplete = () => res(out); t.onerror = t.onabort = () => rej(t.error); }); },
    all() { return DB.mem ? Promise.resolve([...DB.mem.recs.values()]) : DB.tx("recs", "readonly", os => os.getAll()); },
    get(key) { return DB.mem ? Promise.resolve(DB.mem.kv.get(key)) : DB.tx("kv", "readonly", os => os.get(key)); },
    set(key, val) { if (DB.mem) { DB.mem.kv.set(key, val); return Promise.resolve(); } return DB.tx("kv", "readwrite", os => { os.put(val, key); }); },
    put(list) { const plain = list.map(C.strip); if (!plain.length) return Promise.resolve(); if (DB.mem) { plain.forEach(r => DB.mem.recs.set(r.id, r)); return Promise.resolve(); } return DB.tx("recs", "readwrite", os => { plain.forEach(r => os.put(r)); }); },
    del(ids) { if (!ids.length) return Promise.resolve(); if (DB.mem) { ids.forEach(id => DB.mem.recs.delete(id)); return Promise.resolve(); } return DB.tx("recs", "readwrite", os => { ids.forEach(id => os.delete(id)); }); },
    clear() { if (DB.mem) { DB.mem.recs.clear(); DB.mem.kv.clear(); return Promise.resolve(); } return DB.tx("recs", "readwrite", os => { os.clear(); }).then(() => DB.tx("kv", "readwrite", os => { os.clear(); })); }
  };
  const KEYS_KEY = "ankal.recordings.keys", MODELS_KEY = "ankal.recordings.models";
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } } };

  /* ---------- מצב ---------- */
  const DEFAULTS = { sttProvider: "gemini", llmProvider: "gemini", sttModel: { gemini: "gemini-flash-latest", elevenlabs: "scribe_v2", openai: "gpt-transcribe", groq: "whisper-large-v3" }, llmModel: { gemini: "gemini-flash-latest", anthropic: "claude-opus-5-5", openai: "gpt-5.4-mini" }, hideShort: 0, batchMinSec: 8, concurrency: 2, speed: 1, autoNext: false, followTr: true, useLists: true };
  const R = { loaded: null, recs: [], byId: new Map(), byTime: new Map(), index: null, aliases: {}, settings: JSON.parse(JSON.stringify(DEFAULTS)), keys: {}, folders: [], card: null, contacts: [], tagsAll: [], view: "list", f: C.defaultFilter(), filtered: [], aside: null, moreOpen: false, calMonth: "", calDay: "", peopleQ: "", peopleSort: "sec", syncing: "", busy: new Map(), errors: new Map(), ctrl: new Map(), jobs: { running: false, stop: false, done: 0, fail: 0, total: 0, lastErr: "" }, rendered: false };

  function ensureLoaded() {
    if (R.loaded) return R.loaded;
    return (R.loaded = (async () => {
      await DB.open();
      try {
        const [recs, settings, aliases, folders] = await Promise.all([DB.all(), DB.get("settings"), DB.get("aliases"), DB.get("folders")]);
        if (settings) R.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), settings, { sttModel: Object.assign({}, DEFAULTS.sttModel, settings.sttModel), llmModel: Object.assign({}, DEFAULTS.llmModel, settings.llmModel) });
        R.aliases = aliases || {}; R.folders = Array.isArray(folders) ? folders : [];
        for (const r of recs || []) { R.recs.push(r); R.byId.set(r.id, r); }
      } catch (e) { console.error(e); A()?.toast?.("טעינת ארכיון ההקלטות נכשלה: " + (e.message || e), "error"); }
      R.keys = ls.get(KEYS_KEY, {}); R.view = ls.get("ankal.recordings.view", "list");
      reprep();
    })());
  }
  const saveSettings = () => DB.set("settings", R.settings);
  const saveAliases = () => DB.set("aliases", R.aliases);
  const saveFolders = () => DB.set("folders", R.folders.map(f => ({ id: f.id, name: f.name, kind: f.kind, root: f.root || "", handle: f.handle || null, added: f.added, lastSync: f.lastSync || 0 })));
  const saveSoon = (() => { const pend = new Map(); let t = 0; return r => { r._ && (r._.blob = null); pend.set(r.id, r); clearTimeout(t); t = setTimeout(() => { const v = [...pend.values()]; pend.clear(); DB.put(v); }, 500); }; })();
  async function saveRec(r) { r._ && (r._.blob = null); await DB.put([r]); }

  function rebuild() {
    R.recs.sort((a, b) => b.time - a.time);
    R.byTime = new Map(); for (const r of R.recs) { if (!R.byTime.has(r.time)) R.byTime.set(r.time, []); R.byTime.get(r.time).push(r); }
    R.contacts = C.people(R.recs).sort((a, b) => b.n - a.n);
    const tags = new Map(); for (const r of R.recs) for (const t of C.tagsOf(r)) tags.set(t, (tags.get(t) || 0) + 1); R.tagsAll = [...tags.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    R.index = Q.recordingIndex(R.recs.map(r => ({ id: r.id, name: r.src.name, contactName: r.contactName, number: r.number, time: r.time })));
  }
  function reprep() { for (const r of R.recs) C.prep(r, R.aliases); rebuild(); }
  function applyFilter() { R.filtered = C.filterRecs(R.recs, R.f, { hideShort: +R.settings.hideShort || 0 }); }

  /* ---------- איפה הקבצים: הכרטיס (דרך גיבוי קיוליקס) ותיקיות במחשב ---------- */
  const cardAdapter = () => R.card && R.card.adapter;
  async function folderAdapter(folder, ask) {
    if (folder.kind === "electron") { const api = window.electronAPI?.qualix; if (!api) return null; if (!folder._open) folder._open = await api.reopen(folder.root); return folder._open ? QX().electronAdapter(folder.root, folder.name) : null; }
    if (folder.kind === "fsa" && folder.handle) { try { let p = await folder.handle.queryPermission({ mode: "readwrite" }); if (p !== "granted" && ask) p = await folder.handle.requestPermission({ mode: "readwrite" }); return p === "granted" ? QX().fsaAdapter(folder.handle, folder.name) : null; } catch (_) { return null; } }
    return null;
  }
  const adapterFor = (id, ask) => id === "card" ? Promise.resolve(cardAdapter()) : (f => f ? folderAdapter(f, ask) : Promise.resolve(null))(R.folders.find(x => x.id === id));
  const locLabel = l => l.folder === "card" ? "הכרטיס" : (R.folders.find(f => f.id === l.folder)?.name || "תיקייה שהוסרה");
  async function readRec(r) {
    if (!r.loc.length) throw new UserError("הקובץ של ההקלטה הזו כבר לא נמצא — לא בכרטיס ולא בתיקיות במחשב. התמלול והסיכום נשמרו בארכיון.");
    // תיקייה במחשב קודם — מהירה מהכרטיס
    for (const l of [...r.loc].sort((a, b) => (a.folder === "card") - (b.folder === "card"))) { const ad = await adapterFor(l.folder, true); if (!ad) continue; try { return { bytes: await ad.read(l.rel), loc: l }; } catch (_) { } }
    throw new UserError(r.loc.some(l => l.folder === "card") && !cardAdapter() ? "ההקלטה נמצאת בכרטיס, והוא לא מחובר. חברו את הכרטיס ונסו שוב." : "לא הצלחנו לקרוא את הקובץ — אולי הוא הועבר או נמחק. לחצו “סנכרון” ונסו שוב.", "resync");
  }
  const MIME = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", webm: "audio/webm", amr: "audio/amr", "3gp": "audio/3gpp", wav: "audio/wav", wma: "audio/x-ms-wma" };
  const mimeOf = name => MIME[(/\.([^.]+)$/.exec(name) || [])[1]?.toLowerCase()] || "application/octet-stream";
  /* קובץ → מה שהדפדפן מנגן + PCM לגלי הקול ולתמלול. WAV של הטלפון (IMA-ADPCM) ו-PCM מפוענחים כאן; mp3/m4a
     וכו' — דרך הדפדפן (ל-PCM ב-16kHz, מה שספקי התמלול צריכים). */
  async function decode(bytes, name) {
    const info = /\.wav$/i.test(name) ? Q.parseWavHeader(bytes, bytes.length) : null;
    if (info && info.format === 0x11) { const pcm = Q.decodeImaAdpcm(bytes, info); return { pcm, sr: info.sampleRate, blob: new Blob([Q.pcmToWav(pcm, info.sampleRate)], { type: "audio/wav" }) }; }
    if (info && info.format === 1 && info.bits === 16) {
      let pcm = new Int16Array(bytes.slice(info.dataOffset, info.dataOffset + (info.dataLength & ~1)).buffer);
      if (info.channels > 1) { const m = new Int16Array(Math.floor(pcm.length / info.channels)); for (let i = 0; i < m.length; i++) { let a = 0; for (let c = 0; c < info.channels; c++) a += pcm[i * info.channels + c]; m[i] = a / info.channels; } pcm = m; }
      return { pcm, sr: info.sampleRate, blob: new Blob([bytes], { type: "audio/wav" }) };
    }
    const blob = new Blob([bytes], { type: mimeOf(name) });
    try {
      const AC = window.AudioContext || window.webkitAudioContext, ac = new AC(), ab = await ac.decodeAudioData(bytes.slice().buffer); ac.close?.();
      const src = ab.getChannelData(0), ratio = ab.sampleRate / 16000, n = Math.floor(src.length / ratio), pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) { const v = src[Math.floor(i * ratio)]; pcm[i] = Math.max(-1, Math.min(1, v)) * 32767; }
      return { pcm, sr: 16000, blob };
    } catch (_) { return { pcm: null, sr: 0, blob }; }
  }

  /* ---------- סנכרון: הכרטיס ותיקיות במחשב ---------- */
  /* משך: פתיחת כל קובץ בכרטיס קר לוקחת כ-9 שניות ל-700 הקלטות. כל ההקלטות של הטלפון באותו מבנה, ולכן קוראים
     כותרת של שלוש לדוגמה בכל תיקייה; אם הן זהות — השאר לפי הגודל (המדויק מתעדכן בהשמעה). אחרת — את כולן. */
  async function durations(ad, dir, files) {
    const wavs = files.filter(f => f.size && /\.wav$/i.test(f.name)); if (!wavs.length) return;
    const read = async list => { const out = new Map(); if (ad.readHeads) { const h = await ad.readHeads(dir, list.map(f => f.name), 512); list.forEach((f, k) => { if (h[k]) out.set(f.name, h[k]); }); } else for (const f of list) { try { out.set(f.name, (await ad.read(join(dir, f.name))).subarray(0, 512)); } catch (_) { } } return out; };
    const probes = [...new Set([wavs[0], wavs[wavs.length >> 1], wavs[wavs.length - 1]])], ph = await read(probes);
    const infos = probes.map(f => ph.has(f.name) ? Q.parseWavHeader(ph.get(f.name), f.size) : null), first = infos[0];
    if (first && infos.every(w => w && ["format", "channels", "sampleRate", "blockAlign", "dataOffset"].every(k => w[k] === first[k]))) { for (const f of wavs) f.duration = Q.wavDurationFromSize(first, f.size); return; }
    const all = await read(wavs); for (const f of wavs) { const w = all.has(f.name) ? Q.parseWavHeader(all.get(f.name), f.size) : null; if (w) f.duration = w.duration; }
  }
  const SKIP_DIR = /^(\.|\$RECYCLE\.BIN$|System Volume Information$|ibphone$|@cstardata$|System$|FOUND\.\d+$|PB$|Memo$)/i;
  async function scanDir(ad, dir, depth, out) {
    let entries = []; try { entries = await ad.list(dir); } catch (_) { return; }
    const files = [];
    for (const e of entries) {
      if (e.kind === "directory") { if (depth > 0 && !SKIP_DIR.test(e.name)) await scanDir(ad, join(dir, e.name), depth - 1, out); continue; }
      if (C.parseFileName(e.name, e.mtime)) files.push({ name: e.name, rel: join(dir, e.name), size: e.size || 0, mtime: e.mtime || 0 });
    }
    await durations(ad, dir, files); out.push(...files);
  }
  /* מי ומה: אנשי הקשר מהגרסה הפתוחה ומהגיבוי האחרון בכרטיס (וגיבויים ישנים יותר כשנשאר שם בהקלטות שלא נמצא),
     השיחות מכל יומני הגיבויים (כל יומן זוכר רק 100 מספרים), ובסוף — הרשימות של אנק״ל, כשהמשתמש לא כיבה. */
  async function contactsContext() {
    const contacts = [], calls = [], seen = new Set(), p = R.card;
    if (p) {
      const open = p.openContacts?.(); if (open) contacts.push(...open);
      const missing = new Set(R.recs.map(r => r.src.name).filter(Boolean)); for (const c of contacts) missing.delete(c.name);
      let books = 0;
      for (const bk of p.backups?.() || []) {
        if (bk.categories.includes("callog")) { try { for (const e of Q.parseCallog(await p.adapter.read(join(bk.rel, "callog.ib"))).entries) for (const c of e.calls) { const key = `${e.number}|${e.type}|${c.time}`; if (!seen.has(key)) { seen.add(key); calls.push({ number: e.number, type: e.type, time: c.time, duration: c.duration }); } } } catch (_) { } }
        if (bk.categories.includes("phonebook") && books < 6 && (!books || missing.size)) { try { const pb = Q.parsePhonebook(await p.adapter.read(join(bk.rel, "phonebook.ib"))); contacts.push(...pb.contacts); for (const c of pb.contacts) missing.delete(c.name); books++; } catch (_) { } }
      }
    }
    if (R.settings.useLists) { try { for (const l of A().getLists()) for (const c of l.contacts) contacts.push({ name: c.name, mobile: c.mobile, home: c.home, work: c.work, fax: c.fax }); } catch (_) { } }
    return { contacts, calls };
  }
  async function afterScan(res, quiet, where) {
    for (const r of res.added) { R.recs.push(r); }
    const enriched = C.enrich(R.recs, await contactsContext());
    await DB.put([...new Set([...res.added, ...res.changed, ...enriched])]);
    reprep(); refresh(); notifyQualix();
    if (!quiet && res.added.length) A().toast(`נוספו ${nf(res.added.length)} הקלטות חדשות מ${where}`);
  }
  async function syncCard(quiet) {
    const ad = cardAdapter(); if (!ad || R.syncing) return;
    R.syncing = "קורא את ההקלטות מהכרטיס…"; renderTop();
    try {
      const dirs = (await ad.list("")).filter(e => e.kind === "directory" && /^audio( \d+)?$/i.test(e.name)).map(e => e.name).sort(), files = [];
      // בכרטיס רק הקלטות שיחה של הטלפון (שם עם תאריך ושעה) — לא שיעורים ושירים שיושבים לידן
      for (const dir of dirs) { const list = (await ad.list(dir)).filter(e => e.kind === "file").map(e => ({ name: e.name, rel: join(dir, e.name), size: e.size || 0, mtime: e.mtime || 0 })).filter(f => C.parseFileName(f.name, f.mtime)?.stamped); await durations(ad, dir, list); files.push(...list); }
      if (ad !== cardAdapter()) return;
      const res = C.mergeScan(R.byId, "card", files); Object.assign(R.card, { dirs, empty: res.empty, synced: Date.now() });
      await afterScan(res, quiet, "הכרטיס");
    } catch (e) { console.error(e); A().toast("קריאת ההקלטות מהכרטיס נכשלה: " + (e.message || e), "error"); }
    finally { R.syncing = ""; renderTop(); }
  }
  async function syncFolder(folder, ask, quiet) {
    if (R.syncing) return;
    const ad = await folderAdapter(folder, ask); if (!ad) { folder._need = true; renderTop(); return; }
    folder._need = false; R.syncing = `סורק את “${folder.name}”…`; renderTop();
    try { const files = []; await scanDir(ad, "", 4, files); const res = C.mergeScan(R.byId, folder.id, files); folder.lastSync = Date.now(); saveFolders(); await afterScan(res, quiet, `“${folder.name}”`); }
    catch (e) { console.error(e); A().toast("הסריקה נכשלה: " + (e.message || e), "error"); }
    finally { R.syncing = ""; renderTop(); }
    probeLater();
  }
  async function syncAll(ask) { if (cardAdapter()) await syncCard(false); for (const f of R.folders) await syncFolder(f, ask, false); if (!cardAdapter() && !R.folders.length) addFolder(); }
  /* משך של mp3/m4a וכו' (לא WAV): דרך נגן הדפדפן, ברקע, אחד-אחד */
  let probing = false;
  async function probeLater() {
    if (probing) return; probing = true;
    try {
      for (const r of R.recs.filter(r => !r.duration && r.loc.length && !/\.wav$/i.test(r.fileName))) {
        try { const { bytes } = await readRec(r); const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(r.fileName) })); r.duration = await new Promise(res => { const a = new Audio(); const fin = v => { URL.revokeObjectURL(url); res(isFinite(v) && v > 0 ? v : 0); }; a.preload = "metadata"; a.onloadedmetadata = () => fin(a.duration); a.onerror = () => fin(0); setTimeout(() => fin(0), 8000); a.src = url; }); if (r.duration) { await saveRec(r); updateRow(r.id); } } catch (_) { }
      }
    } finally { probing = false; }
  }
  async function addFolder() {
    let folder = null;
    try {
      if (window.electronAPI?.qualix) {
        const picked = await window.electronAPI.qualix.chooseFolder("בחירת תיקיית הקלטות במחשב"); if (!picked) return null;
        const card = String(cardAdapter()?.root || "").toLowerCase(), t = String(picked.root).toLowerCase();
        if (card && (t === card || t.startsWith(card.endsWith("\\") ? card : card + "\\"))) { A().toast("זו תיקייה בתוך הכרטיס — ההקלטות שבכרטיס כבר נקראות לבד. בחרו תיקייה במחשב.", "warning"); return null; }
        folder = R.folders.find(f => f.kind === "electron" && f.root.toLowerCase() === t) || null;
        if (!folder) { folder = { id: "f" + Date.now().toString(36), name: picked.label, kind: "electron", root: picked.root, added: Date.now(), lastSync: 0, _open: true }; R.folders.push(folder); }
        else folder._open = true;
      } else {
        if (!window.showDirectoryPicker) { A().toast("הדפדפן הזה לא תומך בתיקיות. השתמשו ב-Chrome או Edge, או בתוכנה למחשב.", "error"); return null; }
        const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "ankal-recordings" });
        const cardH = cardAdapter()?.handle; if (cardH && (await cardH.resolve(handle)) !== null) { A().toast("זו תיקייה בתוך הכרטיס — בחרו תיקייה במחשב.", "warning"); return null; }
        for (const f of R.folders) { try { if (f.handle && await f.handle.isSameEntry(handle)) { folder = f; f.handle = handle; } } catch (_) { } }
        if (!folder) { folder = { id: "f" + Date.now().toString(36), name: handle.name, kind: "fsa", handle, added: Date.now(), lastSync: 0 }; R.folders.push(folder); }
      }
    } catch (e) { if (e?.name !== "AbortError") { console.error(e); A().toast("לא הצלחנו לפתוח את התיקייה", "error"); } return null; }
    await saveFolders(); return folder;
  }
  async function addAndSync() { const f = await addFolder(); if (f) await syncFolder(f, true, false); }

  /* ---------- סינון ותצוגה ---------- */
  function refresh(resetScroll) { applyFilter(); const cnt = $("nav-recordings-count"); if (cnt) cnt.textContent = R.recs.length || ""; if (!onPage() || !$("recordings-root")) return; if (!R.rendered) return renderPage(); renderTop(); renderFilters(); renderView(); renderAside(); if (resetScroll) $("rx-view")?.scrollIntoView({ block: "nearest" }); }
  function renderPage() {
    const root = $("recordings-root"); if (!root) return; R.rendered = true;
    root.innerHTML = `<div id="rx-top"></div><div id="rx-filters"></div><div class="rx-body" id="rx-body"><div id="rx-view" class="rx-view"></div><aside id="rx-aside" class="rx-aside"></aside></div>`;
    renderTop(); renderFilters(); renderView(); renderAside();
  }
  const VIEWS = [["list", "☰", "רשימה"], ["calendar", "▦", "לוח שנה"], ["people", "👥", "אנשים"], ["stats", "📊", "נתונים"]];
  function renderTop() {
    const el = $("rx-top"); if (!el) return;
    const cnt = $("nav-recordings-count"); if (cnt) cnt.textContent = R.recs.length || "";
    const ad = cardAdapter(), onCard = R.recs.filter(r => r.loc.some(l => l.folder === "card")).length, empty = R.card?.empty?.length || 0;
    const card = ad ? `<span class="rx-src on"><i class="qx-dot"></i><b>${esc(ad.label || "הכרטיס")}</b> · ${nf(onCard)} הקלטות${empty ? ` · ${empty} ריקים` : ""}</span>` : `<span class="rx-src"><i class="qx-dot"></i>הכרטיס לא מחובר <button class="btn btn-quiet btn-sm" data-rx="card-connect">${window.electronAPI?.qualix ? "זיהוי כרטיס" : "בחירת הכרטיס"}</button></span>`;
    const need = R.folders.filter(f => f._need);
    const folders = `<button class="rx-src ${R.folders.length ? "on" : ""}" data-rx="folders"><i>💾</i>${R.folders.length ? `${R.folders.length === 1 ? esc(R.folders[0].name) : R.folders.length + " תיקיות"} במחשב` : "תיקיות במחשב"}</button>`;
    el.innerHTML = `<div class="rx-bar">${card}${folders}<button class="btn btn-quiet btn-sm" data-rx="sync" ${R.syncing ? "disabled" : ""}>${R.syncing ? `<span class="rx-spin"></span>${esc(R.syncing)}` : "↻ סנכרון"}</button><div class="spacer"></div>${ad ? `<button class="btn btn-quiet btn-sm" data-rx="clean">🧹 ניקוי הכרטיס</button><button class="btn btn-quiet btn-sm" data-rx="export">⇩ העברה למחשב</button>` : ""}<button class="btn btn-quiet btn-sm" data-rx="settings">⚙ הגדרות ו-AI</button></div>
      ${need.length ? `<div class="rx-banner">כדי לנגן ולתמלל מ${esc(need.map(f => f.name).join(", "))} צריך לאשר שוב גישה לתיקייה. <button class="btn btn-secondary btn-sm" data-rx="perm">אישור גישה</button></div>` : ""}${DB.mem && R.recs.length ? `<div class="rx-banner">אין כאן אחסון מקומי, ולכן התמלולים, הסיכומים וההערות יימחקו כשהעמוד ייסגר.</div>` : ""}
      <form class="rx-search" id="rx-search-form"><label class="search-field"><span>⌕</span><input id="rx-q" type="search" value="${esc(R.f.q)}" placeholder="חיפוש בשם, מספר, תמלול, סיכום, הערה או תגית…  ( / )"></label><button class="btn btn-secondary btn-sm" type="submit" data-rx="ai-search" title="כתבו בקשה רגילה, למשל: שיחות ארוכות עם אבא בחודש שעבר">✦ חיפוש חכם</button></form>
      <nav class="rx-views">${VIEWS.map(([k, i, l]) => `<button class="${R.view === k ? "active" : ""}" data-rx="view" data-view="${k}"><span>${i}</span>${l}${k === "list" ? ` <span class="qx-n">${nf(R.filtered.length)}</span>` : ""}</button>`).join("")}</nav>`;
  }
  function opts(map, val) { return Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === val ? "selected" : ""}>${esc(Array.isArray(v) ? v[0] : v)}</option>`).join(""); }
  function renderFilters() {
    const el = $("rx-filters"); if (!el) return;
    if (!R.recs.length) { el.innerHTML = ""; return; }
    const f = R.f, more = C.hiddenCount(f), wdS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
    el.innerHTML = `<div class="rx-fbar"><div class="rx-seg">${C.DATES.map(([k, l]) => `<button class="${f.date === k ? "on" : ""}" data-rx="date" data-v="${k}">${l}</button>`).join("")}</div>
      ${f.date === "custom" ? `<span class="rx-range"><input type="date" id="rx-from" value="${esc(f.from)}"> עד <input type="date" id="rx-to" value="${esc(f.to)}"></span>` : ""}
      <input id="rx-contact" class="rx-in" list="rx-contacts" placeholder="+ איש קשר" autocomplete="off"><datalist id="rx-contacts">${R.contacts.slice(0, 1500).map(c => `<option value="${esc(c.who)}">${C.nCalls(c.n)}</option>`).join("")}</datalist>
      <select id="rx-dur" class="rx-in" title="משך">${opts(C.DUR, f.dur)}</select><select id="rx-status" class="rx-in" title="מצב">${opts(C.STATUS, f.status)}</select><select id="rx-sort" class="rx-in" title="מיון">${opts(C.SORT, f.sort)}</select>
      <button class="btn btn-quiet btn-sm" data-rx="more">${R.moreOpen ? "− פחות מסננים" : "＋ עוד מסננים"}${more ? ` <span class="rx-dot">${more}</span>` : ""}</button>${C.isFiltered(f) ? `<button class="btn btn-quiet btn-sm" data-rx="clear">ניקוי הסינון</button>` : ""}</div>
      ${R.moreOpen ? `<div class="rx-fbar"><select id="rx-tod" class="rx-in">${opts(C.TOD, f.tod)}</select><select id="rx-kind" class="rx-in">${opts(C.KIND, f.kind)}</select><select id="rx-tag" class="rx-in"><option value="">כל התגיות</option>${R.tagsAll.map(t => `<option ${t === f.tag ? "selected" : ""}>${esc(t)}</option>`).join("")}</select><span class="rx-wd">ימים: ${wdS.map((d, i) => `<button class="${f.wd.includes(i) ? "on" : ""}" data-rx="wd" data-i="${i}" title="יום ${C.HE_WD[i]}">${d}</button>`).join("")}</span></div>` : ""}
      ${f.contacts.length || f.ids ? `<div class="rx-chips">${f.contacts.map(c => `<span class="rx-chip">${esc(c)}<button data-rx="rm-contact" data-c="${esc(c)}" aria-label="הסרה">✕</button></span>`).join("")}${f.ids ? `<span class="rx-chip">רק עם ${esc(f.idsLabel)} (${f.ids.size})<button data-rx="rm-ids" aria-label="הסרה">✕</button></span>` : ""}</div>` : ""}
      <div class="rx-dirs" id="rx-dirs" role="tablist" aria-label="כיוון השיחה">${dirTabsHtml()}</div>
      <div class="rx-res" id="rx-res"></div>`;
    renderResbar();
  }
  /* הכל / נכנסות / יוצאות / כיוון לא ידוע — עם מונה לפי כל שאר המסננים, כמו הלשוניות ביומן של הטלפון */
  function dirTabsHtml() {
    const base = C.filterRecs(R.recs, Object.assign({}, R.f, { dir: "any" }), { hideShort: +R.settings.hideShort || 0 }), n = k => k === "any" ? base.length : base.filter(r => k === "unknown" ? !r.type : r.type === k).length;
    return [["any", "הכל"], ["incoming", "↙ נכנסות"], ["outgoing", "↗ יוצאות"], ["unknown", "כיוון לא ידוע"]].map(([k, l]) => `<button class="qx-filter ${R.f.dir === k ? "active" : ""} ${k}" role="tab" aria-selected="${R.f.dir === k}" data-rx="dir" data-v="${k}">${l} <span class="qx-n">${nf(n(k))}</span></button>`).join("");
  }
  function renderResbar() {
    const el = $("rx-res"); if (!el) return;
    const n = R.filtered.length, sec = R.filtered.reduce((a, r) => a + (r.duration || 0), 0), todo = R.filtered.filter(r => !r.sum).length;
    el.innerHTML = `<span><b>${nf(n)}</b> הקלטות · <b>${C.fmtTotal(sec)}</b> זמן שיחה</span><div class="spacer"></div>${n ? `<button class="btn btn-quiet btn-sm" data-rx="ask-results">✦ שאלה על התוצאות</button><button class="btn btn-quiet btn-sm" data-rx="batch" ${todo ? "" : "disabled"}>✦ תמלול וסיכום (${nf(todo)})</button><button class="btn btn-quiet btn-sm" data-rx="excel">⇩ ייצוא לאקסל</button>` : ""}`;
  }
  function renderView() {
    const el = $("rx-view"); if (!el) return;
    if (!R.recs.length) { el.innerHTML = welcomeHtml(); return; }
    if (R.view === "calendar") { el.innerHTML = calendarHtml(); scrollYearMap(); } else if (R.view === "people") { el.innerHTML = peopleHtml(); renderPeopleTable(); } else if (R.view === "stats") el.innerHTML = statsHtml(); else renderList(el);
    $("rx-body")?.classList.toggle("has-aside", !!R.aside);
  }
  function welcomeHtml() {
    return `<div class="rx-welcome"><div class="rx-reel">🎙</div><h2>כל השיחות, לפי יום ולפי אדם</h2><p>הטלפון מקליט כל שיחה לתיקיית Audio בכרטיס. חברו את הכרטיס — ההקלטות נכנסות לארכיון, עם שם ומספר מאנשי הקשר וכיוון השיחה מהיומן. אפשר להוסיף גם תיקייה במחשב עם הקלטות שכבר הועברו.</p>
      <div class="qx-row" style="justify-content:center"><button class="btn btn-primary" data-rx="card-connect">${window.electronAPI?.qualix ? "זיהוי כרטיס" : "בחירת הכרטיס"}</button><button class="btn btn-quiet" data-rx="add-folder">💾 הוספת תיקייה מהמחשב</button></div>
      <p class="qx-note">הכול נשמר במחשב הזה. תמלול וסיכום ב-AI — רק כשמבקשים, אצל הספק שבוחרים בהגדרות ועם המפתח שלכם.</p></div>`;
  }

  /* ---------- רשימה ---------- */
  const tapeW = d => Math.max(2, Math.min(100, Math.log10(1 + (d || 0)) / Math.log10(1 + 2400) * 100));
  const DIR_ICON = { incoming: "↙", outgoing: "↗" };
  function hl(text) {
    const s = esc(text), q = C.norm(R.f.q); if (!q) return s;
    const terms = q.split(" ").filter(t => t.length > 1).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); if (!terms.length) return s;
    try { return s.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>"); } catch (_) { return s; }
  }
  function avatar(r) { const who = r._.who, tel = !r._.saved; return `<span class="contact-avatar rx-av" style="--tint:${A().avatarHue(who)}">${tel ? "☎" : esc(A().initialOf(who))}</span>`; }
  function rowHtml(r, withDate) {
    const busy = R.busy.get(r.id), playing = P.rec?.id === r.id, sub = r.sum?.title || (r._.saved && r.number ? C.formatPhone(r.number) : "");
    return `<div class="rx-row ${R.aside?.id === r.id ? "sel" : ""} ${playing ? "playing" : ""} ${r.loc.length ? "" : "gone"}" data-rx="open" data-id="${esc(r.id)}" data-sd="${withDate ? 1 : ""}" role="button" tabindex="0" ${r.loc.length ? "" : `title="הקובץ לא נמצא כרגע — התמלול והסיכום שמורים"`}>
      <span class="rx-time">${withDate ? esc(r._.day.split("-").reverse().join(".")) + " " : ""}${r.iso.slice(11, 16)}</span>${avatar(r)}
      <span class="rx-who"><b>${hl(r._.who)}</b><small>${hl(sub)}</small></span>
      <span class="rx-dirx ${r.type}" title="${r.type ? Q.CALL_TYPE_HE[r.type] : "כיוון לא ידוע"}">${DIR_ICON[r.type] || ""}</span>
      <span class="rx-tape" aria-hidden="true"><i style="width:${tapeW(r.duration)}%"></i></span><span class="rx-dur">${C.fmtDur(r.duration)}</span>
      <span class="rx-flags">${busy ? `<span class="rx-spin" title="${esc(busy)}"></span>` : ""}${r.tr ? `<i class="rx-fl" title="יש תמלול">ת</i>` : ""}${r.sum ? `<i class="rx-fl s" title="יש סיכום">ס</i>` : ""}${r.note ? `<i class="rx-fl n" title="יש הערה">✎</i>` : ""}</span>
      <button class="rx-ib rx-star ${r.star ? "on" : ""}" data-rx="star" data-id="${esc(r.id)}" title="מועדף" aria-label="מועדף">★</button>
      <button class="rx-ib rx-playb" data-rx="play" data-id="${esc(r.id)}" title="ניגון" aria-label="ניגון">${playing && !P.audio.paused ? "❚❚" : "▶"}</button></div>`;
  }
  let listObs = null;
  function renderList(el) {
    const list = R.filtered;
    if (!list.length) { el.innerHTML = `<div class="empty-box"><div class="empty-icon">⌕</div><h3>אין הקלטות שמתאימות לסינון</h3><p>נסו מילים אחרות או טווח תאריכים רחב יותר.</p><button class="btn btn-quiet" data-rx="clear">ניקוי הסינון</button></div>`; return; }
    const grouped = R.f.sort === "new" || R.f.sort === "old", items = [];
    if (grouped) { const tot = C.byDay(list); let last = null; for (const r of list) { if (r._.day !== last) { last = r._.day; items.push({ day: last, n: tot.get(last).n, s: tot.get(last).s }); } items.push(r); } } else items.push(...list);
    el.innerHTML = `<div class="rx-list" id="rx-list"></div><div id="rx-sentinel" class="rx-sentinel"></div>`;
    const listEl = $("rx-list"), today = C.localDay(Date.now()), yest = C.addDays(today, -1); let pos = 0;
    const more = () => {
      const parts = [], end = Math.min(items.length, pos + 250);
      for (; pos < end; pos++) { const it = items[pos]; parts.push(it.day ? `<div class="rx-day"><span class="rx-day-n">${esc(C.fmtDay(it.day, it.day.slice(0, 4) !== today.slice(0, 4)))}</span>${it.day === today ? `<span class="rx-badge">היום</span>` : it.day === yest ? `<span class="rx-badge">אתמול</span>` : ""}<span class="rx-day-t">${C.fmtTotal(it.s)} · ${C.nCalls(it.n)}</span></div>` : rowHtml(it, !grouped)); }
      listEl.insertAdjacentHTML("beforeend", parts.join(""));
      if (pos >= items.length) { listObs?.disconnect(); $("rx-sentinel")?.remove(); }
    };
    more(); listObs?.disconnect();
    if (pos < items.length && typeof IntersectionObserver === "function") { listObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: "800px" }); listObs.observe($("rx-sentinel")); }
  }
  function updateRow(id) { const r = R.byId.get(id); if (!r) return; document.querySelectorAll(`.rx-row[data-id="${CSS.escape(id)}"]`).forEach(el => { const t = document.createElement("div"); t.innerHTML = rowHtml(r, el.dataset.sd === "1"); el.replaceWith(t.firstElementChild); }); }

  /* ---------- לוח שנה: מפת חום של כל התקופה, חודש, ויום עם ציר שיחות ---------- */
  const HEAT_TIP = ["אין שיחות", "עד 10 דק׳", "10–30 דק׳", "30–60 דק׳", "1–2 שעות", "מעל שעתיים"];
  function calendarHtml() {
    const agg = C.byDay(R.filtered), today = C.localDay(Date.now());
    if (!R.calMonth) R.calMonth = (R.filtered[0]?._.day || today).slice(0, 7);
    const days = R.recs.map(r => r._.day).sort(), first = days[0] || today, [fy, fm, fd] = first.split("-").map(Number);
    const start = new Date(fy, fm - 1, fd); start.setDate(start.getDate() - start.getDay());
    const [ty, tm, td] = today.split("-").map(Number), end = new Date(ty, tm - 1, td), cells = []; let col = 0, lastMon = -1;
    for (const d = new Date(start); d <= end || d.getDay() !== 0; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) { col++; const probe = new Date(d); probe.setDate(probe.getDate() + 6); const mo = probe.getDate() <= 7 ? probe.getMonth() : -1; cells.push(`<span class="rx-ym-m" style="grid-column:${col}">${mo >= 0 && mo !== lastMon ? C.HE_MON[mo].slice(0, 3) : ""}</span>`); if (mo >= 0) lastMon = mo; }
      const k = C.localDay(d.getTime()), a = agg.get(k), out = d > end;
      cells.push(`<button class="rx-c ${out ? "x" : "h" + C.heat(a?.s)} ${k === R.calDay ? "on" : ""}" style="grid-column:${col};grid-row:${d.getDay() + 2}" data-rx="cal-day" data-day="${k}" ${out ? "disabled" : ""} data-tip="${esc(C.fmtDay(k, true))}\n${a ? `${C.fmtTotal(a.s)} · ${C.nCalls(a.n)}` : "אין שיחות"}" aria-label="${esc(C.fmtDay(k, true))}"></button>`);
      if (cells.length > 4000) break;
    }
    const [y, mo] = R.calMonth.split("-").map(Number), nDays = new Date(y, mo, 0).getDate(), lead = new Date(y, mo - 1, 1).getDay(), mcells = [];
    let monS = 0, monN = 0, monD = 0;
    for (let i = 0; i < lead; i++) mcells.push(`<div class="rx-dc out"></div>`);
    for (let dd = 1; dd <= nDays; dd++) { const k = `${y}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`, a = agg.get(k); if (a) { monS += a.s; monN += a.n; monD++; } mcells.push(`<button class="rx-dc h${C.heat(a?.s)} ${k === today ? "today" : ""} ${k === R.calDay ? "on" : ""}" data-rx="cal-day" data-day="${k}" data-tip="${esc(C.fmtDay(k, true))}\n${a ? `${C.nCalls(a.n)}, ${C.fmtTotal(a.s)}` : "אין שיחות"}"><span class="rx-dn">${dd}</span>${a ? `<span class="rx-dm">${C.fmtTotal(a.s)}</span>` : ""}</button>`); }
    let dayHtml = `<div class="rx-dayp"><h3>בחרו יום</h3><p class="qx-note">לחיצה על יום בלוח מציגה את ציר השיחות שלו: מי, מתי וכמה זמן.</p></div>`;
    if (R.calDay) {
      const sel = agg.get(R.calDay), recs = (sel?.recs || []).slice().sort((a, b) => a.time - b.time), ppl = new Set(recs.map(r => r._.who)).size;
      const sec = r => +r.iso.slice(11, 13) * 3600 + +r.iso.slice(14, 16) * 60 + +r.iso.slice(17, 19);
      dayHtml = `<div class="rx-dayp"><h3>${esc(C.fmtDay(R.calDay, true))}</h3><div class="rx-big">${C.fmtTotal(sel?.s || 0)}</div><div class="qx-note">${sel ? `${C.nCalls(sel.n)} עם ${ppl === 1 ? "אדם אחד" : ppl + " אנשים"}, הארוכה ${C.fmtDur(Math.max(...recs.map(r => r.duration || 0)))}` : "אין שיחות ביום הזה"}</div>
        ${sel ? `<div class="rx-tl"><div class="rx-tl-track">${recs.map(r => `<button class="rx-tl-b" data-rx="open" data-id="${esc(r.id)}" style="inset-inline-start:${(sec(r) / 864).toFixed(3)}%;inline-size:${Math.max(0.25, (r.duration || 0) / 864).toFixed(3)}%" data-tip="${esc(r.iso.slice(11, 16) + " " + r._.who)}\n${C.fmtDur(r.duration)}"></button>`).join("")}</div><div class="rx-tl-ax">${[0, 6, 12, 18].map(h => `<span style="inset-inline-start:${h / 24 * 100}%">${String(h).padStart(2, "0")}:00</span>`).join("")}</div></div>
        <div class="rx-mini">${recs.map(r => rowHtml(r, false)).join("")}</div><button class="btn btn-quiet btn-sm" data-rx="day-list">הצג את היום ברשימה</button>` : ""}</div>`;
    }
    return `<div class="rx-cal"><div class="rx-panel"><div class="rx-ph"><h3>כל התקופה</h3><span class="qx-note">כל ריבוע הוא יום. כהה יותר = יותר זמן שיחה.</span></div><div class="rx-ym-scroll"><div class="rx-ym">${cells.join("")}</div></div>
      <div class="rx-legend"><span>פחות</span>${[0, 1, 2, 3, 4, 5].map(i => `<i class="h${i}" data-tip="${HEAT_TIP[i]}"></i>`).join("")}<span>יותר</span></div></div>
      <div class="rx-cal-main"><div class="rx-panel"><div class="rx-mon-h"><button class="btn btn-quiet btn-sm" data-rx="mon" data-d="-1" aria-label="החודש הקודם">›</button><h3>${C.HE_MON[mo - 1]} ${y}</h3><button class="btn btn-quiet btn-sm" data-rx="mon" data-d="1" aria-label="החודש הבא">‹</button><span class="qx-note">${monN ? `${C.fmtTotal(monS)} · ${C.nCalls(monN)} ב-${monD} ימים` : "אין שיחות בחודש הזה"}</span></div>
        <div class="rx-mg">${C.HE_WD.map(d => `<div class="rx-wdh">${d}</div>`).join("")}${mcells.join("")}</div></div>${dayHtml}</div></div>`;
  }

  // מפת השנה נגללת בתוך עצמה אל היום שנבחר (או אל הימים האחרונים) — בלי לגלול את העמוד
  function scrollYearMap() {
    requestAnimationFrame(() => {
      const sc = document.querySelector(".rx-ym-scroll"); if (!sc) return;
      const cells = sc.querySelectorAll(".rx-c:not(.x)"), on = sc.querySelector(".rx-c.on") || cells[cells.length - 1]; if (!on) return;
      const sb = sc.getBoundingClientRect(), ob = on.getBoundingClientRect(); sc.scrollLeft += (ob.left + ob.width / 2) - (sb.left + sb.width / 2);
    });
  }
  /* ---------- אנשים ---------- */
  function peopleHtml() { return `<div class="rx-panel"><div class="qx-toolbar"><label class="search-field"><span>⌕</span><input id="rx-ppl-q" type="search" value="${esc(R.peopleQ)}" placeholder="סינון לפי שם או מספר"></label><span class="qx-note">לחיצה על שורה פותחת את כל הפרטים; ✎ בחלונית משנה שם</span><div class="spacer"></div><button class="btn btn-quiet btn-sm" data-rx="names">👥 שמות למספרים לא שמורים</button></div><div id="rx-ppl-t"></div></div>`; }
  function renderPeopleTable() {
    const el = $("rx-ppl-t"); if (!el) return;
    const months = C.monthsOf(R.recs), list = C.people(R.filtered, months), q = C.norm(R.peopleQ), qd = q.replace(/\D/g, "");
    let rows = q ? list.filter(c => C.norm(c.who).includes(q) || (qd && Q.localNumber(c.number).includes(qd))) : list;
    const so = R.peopleSort; rows.sort(so === "n" ? (a, b) => b.n - a.n : so === "last" ? (a, b) => b.last - a.last : so === "name" ? (a, b) => a.who.localeCompare(b.who, "he") : so === "avg" ? (a, b) => b.s / b.n - a.s / a.n : (a, b) => b.s - a.s);
    const maxS = Math.max(1, ...rows.map(c => c.s)), shown = rows.slice(0, 400);
    const th = (k, l) => `<th><button class="${so === k ? "on" : ""}" data-rx="psort" data-k="${k}">${l}${so === k ? " ▾" : ""}</button></th>`;
    const utc = day => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, m - 1, d); }, today = utc(C.localDay(Date.now()));
    const rel = t => { const day = Q.phoneTimeToIso(t).slice(0, 10), d = Math.round((today - utc(day)) / 864e5); return d <= 0 ? "היום" : d === 1 ? "אתמול" : d < 30 ? `לפני ${d} ימים` : day.split("-").reverse().join("."); };
    el.innerHTML = rows.length ? `<div class="qx-table-wrap"><table class="qx-table rx-ptable"><thead><tr>${th("name", "איש קשר")}${th("sec", "זמן שיחה")}${th("n", "שיחות")}${th("avg", "ממוצע")}${th("last", "אחרונה")}<th>לפי חודש</th></tr></thead><tbody>
      ${shown.map(c => `<tr data-rx="person" data-who="${esc(c.who)}" tabindex="0"><td><span class="rx-pname"><span class="contact-avatar rx-av" style="--tint:${A().avatarHue(c.who)}">${c.saved ? esc(A().initialOf(c.who)) : "☎"}</span><span><b>${esc(c.who)}</b>${c.saved && c.number ? `<small dir="ltr">${esc(C.formatPhone(c.number))}</small>` : ""}</span></span></td><td><span class="rx-pbar"><span class="rx-tape"><i style="width:${(c.s / maxS * 100).toFixed(1)}%"></i></span><span>${C.fmtTotal(c.s)}</span></span></td><td class="num">${nf(c.n)}</td><td class="num">${C.fmtDur(c.s / c.n)}</td><td>${rel(c.last)}</td><td><span class="rx-strip">${c.mon.map((v, i) => `<i class="h${C.heat(v / 4)}" data-tip="${C.HE_MON[+months[i].slice(5) - 1]} ${months[i].slice(0, 4)}: ${C.fmtTotal(v)}"></i>`).join("")}</span></td></tr>`).join("")}
      </tbody></table></div>${rows.length > shown.length ? `<p class="qx-note">מוצגים ${shown.length} מתוך ${nf(rows.length)} — סננו לפי שם כדי למצוא אחרים.</p>` : ""}` : `<div class="empty-box"><h3>לא נמצאו אנשי קשר</h3></div>`;
  }

  /* ---------- נתונים: אריחי מספרים ועמודות (סדרה אחת בכל תרשים, גוון אחד, ערך השיא מסומן, טבלה לכל תרשים) ---------- */
  function bars(items, { short = it => it.label, fmt = C.fmtTotal, every = 1, tip, name }) {
    const max = Math.max(1, ...items.map(i => i.v)), peak = items.reduce((a, b, i) => b.v > items[a].v ? i : a, 0);
    return `<div class="rx-bc">${items.map((it, i) => `<div class="rx-bc-col" tabindex="0" data-tip="${esc(tip(it))}">${i === peak && it.v ? `<span class="rx-bc-v" style="bottom:calc(${(it.v / max * 100).toFixed(1)}% + 3px)">${esc(fmt(it.v))}</span>` : ""}<i style="height:${(it.v / max * 100).toFixed(2)}%"></i></div>`).join("")}</div>
      <div class="rx-bc-x">${items.map((it, i) => `<span>${i % every === 0 ? esc(short(it)) : ""}</span>`).join("")}</div>
      <details class="rx-tbl"><summary>טבלה</summary><table class="qx-table"><thead><tr><th>${esc(name)}</th><th>ערך</th></tr></thead><tbody>${items.map(it => `<tr><td>${esc(it.label)}</td><td class="num">${esc(tip(it).split("\n").slice(1).join(" "))}</td></tr>`).join("")}</tbody></table></details>`;
  }
  function statsHtml() {
    const s = C.stats(R.filtered); if (!s) return `<div class="empty-box"><h3>אין נתונים לסינון הזה</h3></div>`;
    const t = it => `${it.label}\n${C.fmtTotal(it.v)}, ${C.nCalls(it.n)}`;
    const months = s.months.map(m => ({ label: `${C.HE_MON[+m.key.slice(5) - 1]} ${m.key.slice(0, 4)}`, short: C.HE_MON[+m.key.slice(5) - 1].slice(0, 3), v: m.v, n: m.n }));
    const hours = s.hours.map(h => ({ label: `${String(h.key).padStart(2, "0")}:00–${String((h.key + 1) % 24).padStart(2, "0")}:00`, short: String(h.key).padStart(2, "0"), v: h.v, n: h.n }));
    const wds = s.wds.map(w => ({ label: `יום ${C.HE_WD[w.key]}`, short: ["א", "ב", "ג", "ד", "ה", "ו", "ש"][w.key], v: w.v, n: w.n }));
    const buckets = s.buckets.map(b => ({ label: b.label, v: b.v, n: b.v, s: b.s })), topMax = Math.max(1, s.top[0]?.s || 1);
    const kpi = (v, l, sub) => `<div class="rx-kpi"><div class="v">${v}</div><div class="l">${l}</div><div class="s">${sub}</div></div>`;
    return `<div class="rx-kpis">${kpi(nf(s.n), "שיחות", `${nf(s.contacts)} אנשי קשר`)}${kpi((s.total / 3600).toFixed(1), "שעות שיחה", `בממוצע ${C.fmtTotal(s.perDay)} ביום`)}${kpi(C.fmtDur(s.avg), "אורך ממוצע", `חציון ${C.fmtDur(s.median)}`)}
      ${kpi(C.fmtDur(s.longest.duration), "השיחה הארוכה", `<button class="rx-link" data-rx="open" data-id="${esc(s.longest.id)}">${esc(s.longest._.who)}, ${esc(s.longest._.day.split("-").reverse().join("."))}</button>`)}${kpi(C.fmtTotal(s.best.s), "היום העמוס", `<button class="rx-link" data-rx="cal-goto" data-day="${s.best.day}">${esc(s.best.day.split("-").reverse().join("."))}, ${C.nCalls(s.best.n)}</button>`)}${kpi(nf(s.ai), "מסוכמות ב-AI", `${Math.round(s.ai / s.n * 100)}% מהשיחות`)}</div>
      <div class="rx-charts"><div class="rx-panel span2"><h3>זמן שיחה לפי חודש</h3>${bars(months, { short: it => it.short, tip: t, name: "חודש" })}</div>
        <div class="rx-panel"><h3>לפי שעה ביום</h3>${bars(hours, { short: it => it.short, every: 3, tip: t, name: "שעה" })}</div>
        <div class="rx-panel"><h3>לפי יום בשבוע</h3>${bars(wds, { short: it => it.short, tip: t, name: "יום" })}</div>
        <div class="rx-panel"><h3>אנשי הקשר המובילים</h3><p class="qx-note">לפי זמן שיחה כולל · לחיצה פותחת</p><div class="rx-hb">${s.top.map(c => `<button class="rx-hb-r" data-rx="person" data-who="${esc(c.who)}" data-tip="${esc(c.who)}\n${C.nCalls(c.n)}, ${C.fmtTotal(c.s)}"><span class="n">${esc(c.who)}</span><span class="b"><i style="width:${(c.s / topMax * 100).toFixed(1)}%"></i></span><span class="v">${C.fmtTotal(c.s)}</span></button>`).join("")}</div></div>
        <div class="rx-panel"><h3>אורך השיחות</h3>${bars(buckets, { fmt: v => C.nCalls(v), tip: it => `${it.label}\n${C.nCalls(it.v)}, ${C.fmtTotal(it.s)}`, name: "משך" })}</div></div>`;
  }

  /* ---------- חלונית הפרטים: הקלטה או איש קשר ---------- */
  const SPK = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]; // 4 גוונים שנבדקו לעיוורון צבעים; דובר חמישי ומעלה — אפור
  function openRec(id) { if (R.aside?.id !== id) R.trq = ""; R.aside = { type: "rec", id }; renderAside(); document.querySelectorAll(".rx-row.sel").forEach(el => el.classList.remove("sel")); document.querySelectorAll(`.rx-row[data-id="${CSS.escape(id)}"]`).forEach(el => el.classList.add("sel")); }
  function openPerson(who) { R.aside = { type: "person", who }; renderAside(); }
  function closeAside() { R.aside = null; renderAside(); document.querySelectorAll(".rx-row.sel").forEach(el => el.classList.remove("sel")); }
  function renderAside() {
    const el = $("rx-aside"), a = R.aside; $("rx-body")?.classList.toggle("has-aside", !!a); if (!el) return;
    if (!a) { el.innerHTML = ""; return; }
    const ae = document.activeElement, aid = ae && el.contains(ae) ? ae.id : null, sel = aid && "selectionStart" in ae ? [ae.selectionStart, ae.selectionEnd] : null;
    const key = a.type + ":" + (a.id || a.who), st = el.dataset.k === key ? el.scrollTop : 0; el.dataset.k = key;
    if (a.type === "rec") { const r = R.byId.get(a.id); if (!r) return closeAside(); el.innerHTML = recAsideHtml(r); } else el.innerHTML = personAsideHtml(a.who);
    el.scrollTop = st;
    if (aid) { const n = $(aid); if (n) { n.focus({ preventScroll: true }); try { if (sel) n.setSelectionRange(sel[0], sel[1]); } catch (_) { } } }
    highlightSeg(true);
  }
  function recAsideHtml(r) {
    const busy = R.busy.get(r.id), err = R.errors.get(r.id), sm = r.sum, who = r._.who;
    const others = R.recs.filter(x => x._.who === who && x.id !== r.id), spk = new Map(); (r.tr?.segs || []).forEach(s => { if (s.sp && !spk.has(s.sp)) spk.set(s.sp, spk.size); });
    const trq = C.norm(R.trq || ""), playing = P.rec?.id === r.id && !P.audio.paused;
    const list = items => items?.length ? `<ul class="rx-sum-l">${items.map(p => `<li>${hl(p)}</li>`).join("")}</ul>` : "";
    return `<div class="rx-as-head">${avatar(r)}<div class="rx-as-title"><h2>${esc(who)}</h2><div class="qx-note" dir="auto">${r._.saved ? esc(r.number ? C.formatPhone(r.number) : "") : "מספר שלא שמור באנשי הקשר"}</div></div><button class="rx-ib" data-rx="rename" data-who="${esc(who)}" title="שינוי שם / איחוד">✎</button><button class="rx-ib" data-rx="close" title="סגירה (Esc)">✕</button></div>
      <div class="rx-as-meta"><div><span>תאריך</span><b>${esc(C.fmtDay(r._.day, true))}</b></div><div><span>שעה</span><b>${r.iso.slice(11, 16)}</b></div><div><span>משך</span><b>${C.fmtDur(r.duration)}</b></div><div><span>כיוון</span><b>${r.type ? `${DIR_ICON[r.type]} ${Q.CALL_TYPE_HE[r.type]}` : "לא ידוע"}</b></div></div>
      <div class="rx-as-act"><button class="btn btn-primary btn-sm" data-rx="play" data-id="${esc(r.id)}" ${r.loc.length ? "" : "disabled"}>${playing ? "❚❚ השהיה" : "▶ ניגון"}</button>
        ${busy ? `<button class="btn btn-secondary btn-sm" disabled><span class="rx-spin"></span>${esc(busy)}</button><button class="btn btn-quiet btn-sm" data-rx="cancel" data-id="${esc(r.id)}">ביטול</button>` : `<button class="btn btn-secondary btn-sm" data-rx="ai" data-id="${esc(r.id)}" data-mode="${r.tr ? "sum" : "both"}" ${r.loc.length || r.tr ? "" : "disabled"}>✦ ${r.tr && r.sum ? "סיכום מחדש" : r.tr ? "סיכום" : "תמלול וסיכום"}</button>`}
        <button class="rx-ib rx-star ${r.star ? "on" : ""}" data-rx="star" data-id="${esc(r.id)}" title="מועדף">★</button><button class="rx-ib" data-rx="save-file" data-id="${esc(r.id)}" title="שמירה במחשב (WAV רגיל)" ${r.loc.length ? "" : "disabled"}>⬇</button><button class="rx-ib" data-rx="person" data-who="${esc(who)}" title="כל השיחות עם ${esc(who)}">👥</button><button class="rx-ib" data-rx="delete" data-id="${esc(r.id)}" title="מחיקה">🗑</button></div>
      ${err ? `<div class="qx-warn rx-err">${esc(err)}</div>` : ""}
      <section class="rx-sec"><div class="rx-sec-h"><h3>סיכום</h3></div>${sm ? `<div class="rx-sum-t">${hl(sm.title)}</div><p class="rx-sum-p">${hl(sm.summary)}</p>${sm.points?.length ? `<div class="rx-sum-k">נקודות עיקריות</div>${list(sm.points)}` : ""}${sm.actions?.length ? `<div class="rx-sum-k">משימות וסיכומים</div>${list(sm.actions)}` : ""}${sm.dates?.length ? `<div class="rx-sum-k">מועדים וסכומים</div>${list(sm.dates)}` : ""}
        <div class="rx-tags">${sm.sentiment ? `<span class="rx-senti">אווירה: ${esc(sm.sentiment)}</span>` : ""}${(sm.tags || []).map(t => `<button class="rx-tag ai" data-rx="tag-filter" data-tag="${esc(t)}" title="שיחות עם התגית">${esc(t)}</button>`).join("")}</div>`
        : `<div class="rx-ai-empty">${r.tr ? "יש תמלול. אפשר ליצור ממנו סיכום עם נקודות עיקריות ומשימות." : "עוד אין תמלול. בלחיצה אחת ה-AI יתמלל את השיחה ויכין סיכום, נקודות עיקריות ומשימות."}</div>`}</section>
      <section class="rx-sec"><div class="rx-sec-h"><h3>תמלול</h3><div class="spacer"></div>${r.tr ? `<input id="rx-trq" class="rx-in" placeholder="חיפוש בתמלול" value="${esc(R.trq || "")}"><button class="rx-ib" data-rx="copy-tr" data-id="${esc(r.id)}" title="העתקת התמלול">⧉</button>` : ""}</div>
        ${r.tr ? (r.tr.segs.length ? `<div class="rx-tr" id="rx-tr">${r.tr.segs.map((s, i) => trq && !C.norm(s.t).includes(trq) ? "" : `<div class="rx-tseg" data-i="${i}"><button class="rx-ts" data-rx="seek" data-id="${esc(r.id)}" data-s="${s.s ?? ""}" ${s.s == null || !r.loc.length ? "disabled" : ""}>${s.s == null ? "" : C.fmtDur(s.s)}</button><div>${s.sp ? `<span class="rx-sp"><i style="background:${spk.get(s.sp) < 4 ? SPK[spk.get(s.sp)] : "#898781"}"></i>${esc(s.sp)}</span>` : ""}${hl(s.t)}</div></div>`).join("")}</div>` : `<p class="qx-note">לא זוהה דיבור בהקלטה.</p>`)
          + `<div class="qx-note">תומלל ב-${esc(STT[r.tr.provider]?.label || r.tr.provider)} (${esc(r.tr.model)}), ${new Date(r.tr.at).toLocaleDateString("he-IL")}. <button class="rx-link" data-rx="ai" data-id="${esc(r.id)}" data-mode="tr" ${busy || !r.loc.length ? "disabled" : ""}>תמלול מחדש</button></div>`
          : `<div class="rx-ai-empty">אין תמלול עדיין. ${busy || !r.loc.length ? "" : `<button class="rx-link" data-rx="ai" data-id="${esc(r.id)}" data-mode="tr">תמלול בלבד</button>`}</div>`}</section>
      <section class="rx-sec"><div class="rx-sec-h"><h3>הערות ותגיות</h3></div><div class="rx-tags">${(r.tags || []).map(t => `<span class="rx-tag">${esc(t)}<button data-rx="rm-tag" data-id="${esc(r.id)}" data-tag="${esc(t)}" aria-label="הסרה">✕</button></span>`).join("")}<input id="rx-tag-in" class="rx-in" list="rx-tags-dl" placeholder="+ תגית ו-Enter"><datalist id="rx-tags-dl">${R.tagsAll.slice(0, 200).map(t => `<option value="${esc(t)}">`).join("")}</datalist></div>
        <textarea id="rx-note" class="rx-note" rows="3" placeholder="הערה אישית על השיחה">${esc(r.note || "")}</textarea></section>
      <section class="rx-sec"><div class="rx-sec-h"><h3>שאלה על השיחה</h3></div><div class="rx-ask"><input id="rx-ask-in" class="rx-in" placeholder="${r.tr ? "למשל: מה סוכם לגבי התשלום?" : "קודם צריך תמלול"}" ${r.tr ? "" : "disabled"}><button class="btn btn-secondary btn-sm" data-rx="ask-one" data-id="${esc(r.id)}" ${r.tr ? "" : "disabled"}>שאלה</button></div><div class="rx-answer" id="rx-ask-out"></div></section>
      ${others.length ? `<section class="rx-sec"><div class="rx-sec-h"><h3>עוד שיחות עם ${esc(who)}</h3><div class="spacer"></div><button class="rx-link" data-rx="person" data-who="${esc(who)}">כל ה-${nf(others.length + 1)}</button></div><div class="rx-mini">${others.slice(0, 6).map(o => rowHtml(o, true)).join("")}</div></section>` : ""}
      <div class="rx-file">${r.loc.length ? r.loc.map(l => `${esc(locLabel(l))}: <bdi dir="ltr">${esc(l.rel)}</bdi> · ${fmtSize(l.size)}`).join("<br>") : "הקובץ לא נמצא כרגע בכרטיס או בתיקיות במחשב"}${r.number && r.number !== r.src.number ? `<br>המספר הושלם מ${r.inLog ? "יומן השיחות" : "אנשי הקשר"}` : ""}</div>`;
  }
  function personAsideHtml(who) {
    const recs = R.recs.filter(r => r._.who === who); if (!recs.length) return `<div class="empty-box"><h3>אין שיחות</h3></div>`;
    const tot = recs.reduce((a, r) => a + (r.duration || 0), 0), months = C.monthsOf(R.recs), mv = months.map(m => recs.filter(r => r._.month === m).reduce((a, r) => a + (r.duration || 0), 0)), mmax = Math.max(1, ...mv);
    const phones = [...new Set(recs.map(r => r.number && C.formatPhone(r.number)).filter(Boolean))], todo = recs.filter(r => !r.sum).length, inc = recs.filter(r => r.type === "incoming").length, out = recs.filter(r => r.type === "outgoing").length;
    return `<div class="rx-as-head"><span class="contact-avatar rx-av" style="--tint:${A().avatarHue(who)}">${recs[0]._.saved ? esc(A().initialOf(who)) : "☎"}</span><div class="rx-as-title"><h2>${esc(who)}</h2><div class="qx-note" dir="auto">${esc(phones.join(", "))}</div></div><button class="rx-ib" data-rx="rename" data-who="${esc(who)}" title="שינוי שם / איחוד">✎</button><button class="rx-ib" data-rx="close" title="סגירה">✕</button></div>
      <div class="rx-as-meta"><div><span>שיחות</span><b>${nf(recs.length)}</b></div><div><span>זמן כולל</span><b>${C.fmtTotal(tot)}</b></div><div><span>ממוצע</span><b>${C.fmtDur(tot / recs.length)}</b></div><div><span>נכנסות / יוצאות</span><b>${inc} / ${out}</b></div></div>
      <div class="rx-as-act"><button class="btn btn-primary btn-sm" data-rx="person-filter" data-who="${esc(who)}">☰ כל השיחות ברשימה</button><button class="btn btn-secondary btn-sm" data-rx="ask-person" data-who="${esc(who)}">✦ שאלה על השיחות</button>${todo ? `<button class="btn btn-quiet btn-sm" data-rx="batch-person" data-who="${esc(who)}">✦ סיכום ${C.nCalls(todo)}</button>` : ""}</div>
      <section class="rx-sec"><h3>זמן שיחה לפי חודש</h3><div class="rx-cmon">${mv.map((v, i) => `<i style="height:${(v / mmax * 100).toFixed(1)}%" data-tip="${C.HE_MON[+months[i].slice(5) - 1]} ${months[i].slice(0, 4)}\n${C.fmtTotal(v)}"></i>`).join("")}</div><div class="rx-cmon-x">${months.map(m => `<span>${C.HE_MON[+m.slice(5) - 1].slice(0, 3)}</span>`).join("")}</div></section>
      <section class="rx-sec"><div class="rx-sec-h"><h3>שיחות אחרונות</h3></div><div class="rx-mini">${recs.slice(0, 25).map(o => rowHtml(o, true)).join("")}</div></section>`;
  }
  async function toggleStar(id) { const r = R.byId.get(id); if (!r) return; r.star = !r.star; await saveRec(r); updateRow(id); if (R.aside?.id === id) renderAside(); }
  async function renameDialog(who) {
    const keys = [...new Set(R.recs.filter(r => r._.who === who).map(r => r._.key))], hasAlias = keys.some(k => R.aliases[k]);
    const choice = await A().modal({ kicker: "שינוי שם", title: who, html: `<label class="modal-field">השם שיוצג<input id="rx-rn" list="rx-rn-dl" value="${esc(who)}"></label><datalist id="rx-rn-dl">${R.contacts.filter(c => c.saved && c.who !== who).slice(0, 500).map(c => `<option value="${esc(c.who)}">`).join("")}</datalist><p class="qx-note">בחירה בשם של איש קשר קיים מאחדת את השיחות של שניהם. השם משתנה רק כאן, בארכיון ההקלטות — לא בטלפון.</p>`, buttons: [{ id: "save", label: "שמירה", primary: true }, ...(hasAlias ? [{ id: "reset", label: "חזרה לשם המקורי" }] : []), { id: "cancel", label: "ביטול" }] });
    if (choice === "cancel") return; const name = choice === "reset" ? "" : ($("rx-rn")?.value || "").trim(); if (choice === "save" && !name) return;
    for (const k of keys) { if (!name) delete R.aliases[k]; else R.aliases[k] = name; }
    await saveAliases(); reprep();
    const now = name || (R.recs.find(r => keys.includes(r._.key))?._.who) || who;
    R.f.contacts = R.f.contacts.map(c => c === who ? now : c); if (R.aside?.type === "person") R.aside.who = now;
    refresh(); A().toast(name ? `השם עודכן ל“${name}”` : "השם המקורי חזר");
  }

  /* ---------- נגן ---------- */
  const P = { audio: typeof Audio === "function" ? new Audio() : { paused: true, addEventListener() { } }, rec: null, entry: null, loading: false, raf: 0, hoverX: null };
  const Cache = { m: new Map(), max: 6,
    async get(r) {
      if (this.m.has(r.id)) { const v = this.m.get(r.id); this.m.delete(r.id); this.m.set(r.id, v); return v; }
      const { bytes } = await readRec(r), d = await decode(bytes, r.fileName);
      const v = { url: URL.createObjectURL(d.blob), peaks: d.pcm ? C.peaksOf(d.pcm, 1200) : null, dur: d.pcm ? d.pcm.length / d.sr : r.duration };
      this.m.set(r.id, v);
      while (this.m.size > this.max) { const [k, old] = this.m.entries().next().value; if (P.rec?.id === k) break; URL.revokeObjectURL(old.url); this.m.delete(k); }
      if (v.dur && Math.abs(v.dur - (r.duration || 0)) > 0.5) { r.duration = v.dur; saveSoon(r); }
      return v;
    } };
  function ensurePlayer() {
    if ($("rx-player")) return;
    const el = document.createElement("div"); el.id = "rx-player"; el.className = "rx-player hidden"; el.setAttribute("dir", "rtl");
    el.innerHTML = `<button class="rx-p-info" data-rxp="info" title="פרטי ההקלטה"><span class="contact-avatar rx-av" id="rx-p-av"></span><span><b id="rx-p-who"></b><small id="rx-p-when"></small></span></button>
      <div class="rx-p-ctl"><button data-rxp="prev" title="הקודמת (K)" aria-label="הקודמת">⏮</button><button data-rxp="back" title="10 שניות אחורה" aria-label="10 שניות אחורה">↻10</button><button data-rxp="play" class="rx-p-main" id="rx-p-play" aria-label="ניגון">▶</button><button data-rxp="fwd" title="10 שניות קדימה" aria-label="10 שניות קדימה">10↺</button><button data-rxp="next" title="הבאה (J)" aria-label="הבאה">⏭</button></div>
      <div class="rx-p-wave" dir="ltr"><span id="rx-p-cur">0:00</span><canvas id="rx-p-canvas" aria-label="ציר ההקלטה"></canvas><span id="rx-p-dur">0:00</span></div>
      <div class="rx-p-opts"><button data-rxp="speed" id="rx-p-speed" title="מהירות">1×</button><label class="rx-p-auto" title="בסוף ההקלטה עוברים לבאה ברשימה"><input type="checkbox" id="rx-p-auto"> הבאה אוטומטית</label><button data-rxp="close" title="סגירת הנגן" aria-label="סגירת הנגן">✕</button></div>`;
    document.body.appendChild(el);
    $("rx-p-auto").checked = !!R.settings.autoNext; setSpeedLabel();
    const cv = $("rx-p-canvas");
    cv.addEventListener("click", e => { const dur = P.audio.duration; if (!dur || !P.entry) return; const b = cv.getBoundingClientRect(); P.audio.currentTime = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * dur; tick(); });
    cv.addEventListener("mousemove", e => { const b = cv.getBoundingClientRect(); P.hoverX = e.clientX - b.left; const dur = P.audio.duration; cv.title = dur ? C.fmtDur(Math.max(0, Math.min(1, P.hoverX / b.width)) * dur) : ""; drawWave(); });
    cv.addEventListener("mouseleave", () => { P.hoverX = null; drawWave(); });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => drawWave()).observe(cv);
    $("rx-p-auto").addEventListener("change", e => { R.settings.autoNext = e.target.checked; saveSettings(); });
  }
  function setSpeedLabel() { const b = $("rx-p-speed"); if (b) b.textContent = String(R.settings.speed || 1).replace(/^0/, "") + "×"; }
  function setPlayIcon() {
    const playing = P.rec && !P.audio.paused, b = $("rx-p-play"); if (b) { b.innerHTML = P.loading ? `<span class="rx-spin"></span>` : playing ? "❚❚" : "▶"; b.setAttribute("aria-label", playing ? "השהיה" : "ניגון"); }
    document.querySelectorAll(".rx-row.playing").forEach(el => { if (el.dataset.id !== P.rec?.id) { el.classList.remove("playing"); const pb = el.querySelector(".rx-playb"); if (pb) pb.textContent = "▶"; } });
    if (P.rec) document.querySelectorAll(`.rx-row[data-id="${CSS.escape(P.rec.id)}"]`).forEach(el => { el.classList.add("playing"); const pb = el.querySelector(".rx-playb"); if (pb) pb.textContent = playing ? "❚❚" : "▶"; });
    const ab = document.querySelector(`#rx-aside [data-rx="play"]`); if (ab && R.aside?.id === P.rec?.id) ab.textContent = playing ? "❚❚ השהיה" : "▶ ניגון";
  }
  function setPlayerInfo() {
    const r = P.rec, pl = $("rx-player"); if (!pl) return; pl.classList.toggle("hidden", !r); document.body.classList.toggle("rx-has-player", !!r); if (!r) return;
    const av = $("rx-p-av"); av.style.setProperty("--tint", A().avatarHue(r._.who)); av.textContent = r._.saved ? A().initialOf(r._.who) : "☎";
    $("rx-p-who").textContent = r._.who; $("rx-p-when").textContent = `${C.fmtDay(r._.day)}, ${r.iso.slice(11, 16)}`; $("rx-p-dur").textContent = C.fmtDur(r.duration); $("rx-p-cur").textContent = "0:00";
  }
  async function play(id, from = 0) {
    const r = R.byId.get(id); if (!r) return; ensurePlayer();
    P.loading = true; P.rec = r; P.entry = null; setPlayerInfo(); setPlayIcon(); drawWave();
    try {
      const e = await Cache.get(r); if (P.rec !== r) return;
      P.entry = e; P.audio.src = e.url; P.audio.playbackRate = R.settings.speed || 1;
      await new Promise((res, rej) => { P.audio.onloadedmetadata = res; P.audio.onerror = () => rej(new Error("הדפדפן לא הצליח לנגן את הקובץ")); });
      if (from) P.audio.currentTime = from;
      P.loading = false; await P.audio.play().catch(() => { });
    } catch (err) { P.loading = false; if (P.rec === r) P.entry = null; showErr(err); }
    setPlayIcon(); drawWave(); setMedia(); if (R.aside?.id === id) renderAside();
  }
  function togglePlay(id) {
    if (id && P.rec?.id !== id) return play(id);
    if (!P.rec) { const first = R.filtered.find(r => r.loc.length); if (first) play(first.id); return; }
    if (!P.entry) return play(P.rec.id);
    if (P.audio.paused) P.audio.play().catch(() => { }); else P.audio.pause();
  }
  function neighbor(dir) { const L = R.filtered.filter(r => r.loc.length); if (!P.rec || !L.length) return null; const i = L.findIndex(r => r.id === P.rec.id); return i < 0 ? L[0] : L[i + dir] || null; }
  function setMedia() {
    if (!("mediaSession" in navigator) || !P.rec || typeof MediaMetadata !== "function") return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: P.rec._.who, artist: `${C.fmtDay(P.rec._.day, true)} ${P.rec.iso.slice(11, 16)}`, album: "אנק״ל · הקלטות שיחה" });
      navigator.mediaSession.setActionHandler("play", () => P.audio.play()); navigator.mediaSession.setActionHandler("pause", () => P.audio.pause());
      navigator.mediaSession.setActionHandler("previoustrack", () => { const n = neighbor(-1); if (n) play(n.id); }); navigator.mediaSession.setActionHandler("nexttrack", () => { const n = neighbor(1); if (n) play(n.id); });
    } catch (_) { }
  }
  function drawWave() {
    const cv = $("rx-p-canvas"); if (!cv) return; const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const cs = getComputedStyle(cv), off = cs.getPropertyValue("--rx-wave").trim() || "#c9d3e2", on = cs.getPropertyValue("--rx-wave-on").trim() || "#2a78d6";
    const dur = P.audio.duration || P.entry?.dur || P.rec?.duration || 0, prog = dur ? (P.audio.currentTime || 0) / dur : 0, bw = 2, gap = 1, n = Math.floor(w / (bw + gap)), pk = P.entry?.peaks;
    for (let i = 0; i < n; i++) {
      let v = 0.12; if (pk) { const a = Math.floor(i / n * pk.length), b = Math.max(a + 1, Math.floor((i + 1) / n * pk.length)); v = 0; for (let j = a; j < b; j++) if (pk[j] > v) v = pk[j]; }
      const bh = Math.max(2, v * (h - 4)), x = i * (bw + gap); ctx.fillStyle = (x + bw / 2) / w <= prog ? on : off; ctx.fillRect(x, (h - bh) / 2, bw, bh);
    }
    if (P.hoverX != null && dur) { ctx.fillStyle = on; ctx.fillRect(P.hoverX - 1, 0, 2, h); }
  }
  function tick() {
    if (!P.rec) return; const cur = $("rx-p-cur"); if (cur) cur.textContent = C.fmtDur(P.audio.currentTime);
    if (P.audio.duration && isFinite(P.audio.duration)) { const d = $("rx-p-dur"); if (d) d.textContent = C.fmtDur(P.audio.duration); }
    drawWave(); highlightSeg(); if (!P.audio.paused) P.raf = requestAnimationFrame(tick);
  }
  let lastSeg = -1;
  function highlightSeg(force) {
    const list = $("rx-tr"); if (!list || !P.rec || R.aside?.id !== P.rec.id) { lastSeg = -1; return; }
    const t = P.audio.currentTime; let idx = -1; P.rec.tr?.segs.forEach((s, i) => { if (s.s != null && s.s <= t + 0.25) idx = i; });
    if (idx === lastSeg && !force) return; lastSeg = idx;
    list.querySelectorAll(".rx-tseg.on").forEach(e => e.classList.remove("on"));
    const el = list.querySelector(`.rx-tseg[data-i="${idx}"]`);
    if (el) { el.classList.add("on"); if (R.settings.followTr && !P.audio.paused && !force) { const ar = $("rx-aside").getBoundingClientRect(), er = el.getBoundingClientRect(); if (er.top < ar.top + 90 || er.bottom > ar.bottom - 20) el.scrollIntoView({ block: "center", behavior: "smooth" }); } }
  }
  P.audio.addEventListener("play", () => { setPlayIcon(); cancelAnimationFrame(P.raf); P.raf = requestAnimationFrame(tick); });
  P.audio.addEventListener("pause", () => { setPlayIcon(); tick(); });
  P.audio.addEventListener("seeked", tick);
  P.audio.addEventListener("ended", () => { setPlayIcon(); if (R.settings.autoNext) { const n = neighbor(1); if (n) play(n.id); } });
  const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
  function closePlayer() { try { P.audio.pause(); } catch (_) { } P.rec = null; P.entry = null; setPlayerInfo(); setPlayIcon(); }

  /* ---------- AI: ספקים, מודלים ובקשות ----------
     כל בקשה יוצאת מהדף ישירות לספק שנבחר, עם המפתח של המשתמש. Claude: בקשה ישירה ל-Messages API (אנק״ל הוא אתר
     סטטי בלי bundler, כמו שאר הספקים כאן), גרסת API 2026-10-21, ובמודלים שתומכים — fallback בצד השרת לסירוב. */
  const KEY_META = { gemini: { label: "Google Gemini", url: "https://aistudio.google.com/apikey", hint: "מפתח אחד מספיק גם לתמלול וגם לסיכום, ויש מכסה חינמית." }, elevenlabs: { label: "ElevenLabs", url: "https://elevenlabs.io/app/settings/api-keys", hint: "תמלול מדויק במיוחד בעברית, עם הפרדת דוברים." }, openai: { label: "OpenAI", url: "https://platform.openai.com/api-keys", hint: "" }, anthropic: { label: "Claude (Anthropic)", url: "https://console.anthropic.com/settings/keys", hint: "לסיכומים ולשאלות." }, groq: { label: "Groq", url: "https://console.groq.com/keys", hint: "Whisper מהיר וזול." } };
  const STT = { gemini: { label: "Google Gemini", key: "gemini", chunk: 600 }, elevenlabs: { label: "ElevenLabs Scribe", key: "elevenlabs", chunk: 3 * 3600 }, openai: { label: "OpenAI", key: "openai", chunk: 600 }, groq: { label: "Groq Whisper", key: "groq", chunk: 600 } };
  const LLM = { gemini: { label: "Google Gemini", key: "gemini" }, anthropic: { label: "Claude (Anthropic)", key: "anthropic" }, openai: { label: "OpenAI", key: "openai" } };
  const SUGGEST = {
    "stt-gemini": [["gemini-flash-latest", "תמיד ה-Flash העדכני — מומלץ"], ["gemini-3.8-flash", "מהיר ומדויק"], ["gemini-4-argon", "החזק ביותר, איטי ויקר יותר"], ["gemini-3.5-flash-lite", "הזול והמהיר ביותר"]],
    "llm-gemini": [["gemini-flash-latest", "תמיד ה-Flash העדכני — מומלץ"], ["gemini-3.8-flash", "מהיר וזול"], ["gemini-4-argon", "החזק ביותר"], ["gemini-3.5-flash-lite", "הזול ביותר"]],
    "stt-elevenlabs": [["scribe_v2", "מומלץ: הדיוק הגבוה ביותר, הפרדת דוברים"], ["scribe_v1", "הגרסה הקודמת"]],
    "stt-openai": [["gpt-transcribe", "מומלץ"], ["gpt-4o-transcribe-diarize", "עם הפרדת דוברים וזמנים"], ["whisper-1", "עם זמנים לכל משפט"]],
    "stt-groq": [["whisper-large-v3", "מדויק יותר"], ["whisper-large-v3-turbo", "מהיר וזול יותר"]],
    "llm-anthropic": [["claude-opus-5-5", "מומלץ: ה-Opus העדכני"], ["claude-sonnet-5-5", "מהיר וזול יותר"], ["claude-haiku-5-5", "המהיר והזול ביותר"], ["claude-fable-5-1", "החזק ביותר, יקר"]],
    "llm-openai": [["gpt-5.4-mini", "מהיר וזול"], ["gpt-5.4", ""]]
  };
  function classifyModels(p, ids) {
    const out = {};
    if (p === "gemini") { const ok = ids.filter(m => /gemini/i.test(m) && !/tts|image|embed|imagen|veo|lyria|robotics|live|aqa|learnlm|translate|native-audio/i.test(m)); out["llm-gemini"] = ok.filter(m => !/transcribe/i.test(m)); out["stt-gemini"] = ok; }
    if (p === "openai") { out["llm-openai"] = ids.filter(m => /^(gpt-|o\d|chat-latest)/.test(m) && !/audio|realtime|transcribe|tts|image|search|embed|whisper|instruct|moderation/i.test(m)); out["stt-openai"] = ids.filter(m => /transcribe|whisper/i.test(m) && !/realtime/i.test(m)); }
    if (p === "groq") out["stt-groq"] = ids.filter(m => /whisper/i.test(m));
    if (p === "anthropic") out["llm-anthropic"] = ids.filter(m => /claude/i.test(m));
    return out;
  }
  function needKey(p) { const k = (R.keys[p] || "").trim(); if (!k) throw new UserError(`חסר מפתח API של ${KEY_META[p].label}. הוסיפו אותו ב“הגדרות ו-AI”.`, "nokey"); return k; }
  async function apiFetch(url, opts, who, signal) {
    let r; try { r = await fetch(url, Object.assign({}, opts, { signal })); } catch (e) { if (e.name === "AbortError") throw e; throw new Error(`${who}: הבקשה לא הגיעה לשרת (${e.message}). בדקו את החיבור לאינטרנט; אם הוא תקין, ייתכן שהספק או הסינון חוסמים פנייה ישירה — נסו ספק אחר בהגדרות.`); }
    if (r.ok) return r.json();
    let msg = ""; try { const t = await r.text(); try { const j = JSON.parse(t); msg = j.error?.message || j.detail?.message || (typeof j.detail === "string" ? j.detail : "") || j.message || (typeof j.error === "string" ? j.error : "") || t; } catch (_) { msg = t; } } catch (_) { }
    const e = new Error(r.status === 401 || r.status === 403 ? `${who}: המפתח נדחה (${r.status}). בדקו את המפתח בהגדרות.` : r.status === 429 ? `${who}: הגעתם למגבלת הקצב או המכסה (429). נסו שוב בעוד כמה דקות.` : `${who}: ${String(msg).slice(0, 300) || "שגיאה"} (${r.status})${r.status === 404 ? " — ייתכן ששם המודל לא קיים; ב“הגדרות ו-AI” לחצו “בדיקה” ליד המפתח כדי לראות את המודלים הזמינים." : ""}`);
    e.status = r.status; throw e;
  }
  async function geminiText(model, parts, { system, json, signal } = {}) {
    const key = needKey("gemini"), body = { contents: [{ role: "user", parts }], generationConfig: {} };
    if (json) body.generationConfig.responseMimeType = "application/json"; if (system) body.systemInstruction = { parts: [{ text: system }] };
    const j = await apiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, "Gemini", signal);
    const c = j.candidates?.[0], text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    if (!text) throw new Error(`Gemini החזיר תשובה ריקה${c?.finishReason ? " (" + c.finishReason + ")" : ""}${j.promptFeedback?.blockReason ? " — " + j.promptFeedback.blockReason : ""}`);
    return text;
  }
  // מודלים שמקבלים fallback בצד השרת בסירוב (Opus 5/5.5, Fable 5.1, Sonnet 5.5) ומודלים שמקבלים effort (משפחת 5)
  const CLAUDE_FALLBACK = /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/, CLAUDE_EFFORT = /^claude-[a-z]+-5/;
  async function llm({ system, user, json = false, signal }) {
    const p = R.settings.llmProvider, model = R.settings.llmModel[p] || DEFAULTS.llmModel[p];
    if (p === "gemini") return geminiText(model, [{ text: user }], { system, json, signal });
    if (p === "anthropic") {
      const key = needKey("anthropic"), headers = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2026-10-21", "anthropic-dangerous-direct-browser-access": "true" };
      const body = { model, max_tokens: 16000, system: system + (json ? "\nהחזר JSON תקין בלבד, בלי טקסט נוסף ובלי סימני ```." : ""), messages: [{ role: "user", content: user }] };
      if (CLAUDE_EFFORT.test(model)) body.output_config = { effort: json ? "low" : "medium" };
      if (CLAUDE_FALLBACK.test(model)) { headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; body.fallbacks = "default"; }
      const j = await apiFetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) }, "Claude", signal);
      if (j.stop_reason === "refusal") throw new Error("Claude סירב לבקשה הזו" + (j.stop_details?.explanation ? `: ${j.stop_details.explanation}` : ". נסו ספק אחר בהגדרות."));
      return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    }
    if (p === "openai") {
      const key = needKey("openai"), body = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }; if (json) body.response_format = { type: "json_object" };
      const j = await apiFetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify(body) }, "OpenAI", signal);
      return j.choices?.[0]?.message?.content || "";
    }
    throw new Error("ספק AI לא מוכר");
  }
  const blobToB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
  const STT_RUN = {
    async gemini(c, model, signal) { const t = await geminiText(model, [{ inline_data: { mime_type: "audio/wav", data: await blobToB64(c.blob) } }, { text: C.TRANSCRIBE_PROMPT }], { json: !/transcribe/i.test(model), signal }); return C.segsFromGemini(t); },
    async elevenlabs(c, model, signal) { const fd = new FormData(); fd.append("model_id", model || "scribe_v2"); fd.append("file", c.blob, "call.wav"); fd.append("language_code", "heb"); fd.append("diarize", "true"); fd.append("tag_audio_events", "false"); fd.append("timestamps_granularity", "word"); return C.segsFromElevenLabs(await apiFetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": needKey("elevenlabs") }, body: fd }, "ElevenLabs", signal)); },
    async openai(c, model, signal, base = "https://api.openai.com/v1", who = "OpenAI", keyName = "openai") {
      const fd = new FormData(), verbose = /whisper/i.test(model), diar = /diarize/i.test(model); fd.append("file", c.blob, "call.wav"); fd.append("model", model); fd.append("language", "he"); fd.append("response_format", diar ? "diarized_json" : verbose ? "verbose_json" : "json"); if (diar) fd.append("chunking_strategy", "auto");
      return C.segsFromOpenAI(await apiFetch(base + "/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + needKey(keyName) }, body: fd }, who, signal), diar);
    },
    groq(c, model, signal) { return STT_RUN.openai(c, model, signal, "https://api.groq.com/openai/v1", "Groq", "groq"); }
  };
  async function transcribe(r, { signal, onStep } = {}) {
    const p = R.settings.sttProvider, model = R.settings.sttModel[p] || DEFAULTS.sttModel[p]; needKey(STT[p].key);
    onStep?.("מכין את הקובץ…");
    const { bytes } = await readRec(r), d = await decode(bytes, r.fileName); let chunks;
    if (d.pcm) chunks = C.splitPoints(d.pcm, d.sr, STT[p].chunk).map(([a, b]) => ({ blob: new Blob([Q.pcmToWav(d.pcm.subarray(a, b), d.sr)], { type: "audio/wav" }), offset: a / d.sr }));
    else if (bytes.length < 14e6) chunks = [{ blob: d.blob, offset: 0 }]; else throw new UserError("לא הצלחנו לפענח את הקובץ הזה לתמלול.");
    const segs = [];
    for (let i = 0; i < chunks.length; i++) { onStep?.(chunks.length > 1 ? `מתמלל חלק ${i + 1} מתוך ${chunks.length}…` : "מתמלל…"); for (const s of await STT_RUN[p](chunks[i], model, signal)) segs.push({ s: s.s == null ? null : Math.round((s.s + chunks[i].offset) * 10) / 10, sp: s.sp || "", t: s.t }); }
    r.tr = { segs, provider: p, model, at: Date.now() }; await saveRec(r); return r.tr;
  }
  async function summarize(r, { signal, onStep } = {}) {
    if (!r.tr) await transcribe(r, { signal, onStep });
    if (!C.trText(r).trim()) { r.sum = C.EMPTY_SUMMARY(); await saveRec(r); return r.sum; }
    onStep?.("מסכם…"); const q = C.summaryRequest(r), p = R.settings.llmProvider;
    r.sum = C.normalizeSummary(C.parseJSONLoose(await llm({ system: q.system, user: q.user, json: true, signal })), { provider: p, model: R.settings.llmModel[p] || DEFAULTS.llmModel[p] });
    await saveRec(r); return r.sum;
  }
  async function runOne(r, mode) {
    if (R.busy.has(r.id)) return false;
    const ctrl = new AbortController(); R.ctrl.set(r.id, ctrl); R.errors.delete(r.id);
    const step = s => { R.busy.set(r.id, s); updateRow(r.id); if (R.aside?.id === r.id) renderAside(); };
    try { if (mode === "tr") await transcribe(r, { signal: ctrl.signal, onStep: step }); else await summarize(r, { signal: ctrl.signal, onStep: step }); }
    catch (e) { if (e.name !== "AbortError") { if (e.code === "nokey") showErr(e); else R.errors.set(r.id, e.message); } R.busy.delete(r.id); R.ctrl.delete(r.id); updateRow(r.id); if (R.aside?.id === r.id) renderAside(); return false; }
    R.busy.delete(r.id); R.ctrl.delete(r.id); rebuild(); r._.blob = null; updateRow(r.id); if (R.aside?.id === r.id) renderAside(); renderResbar(); return true;
  }
  async function startBatch(recs) {
    const J = R.jobs; if (J.running) return A().toast("כבר רץ עיבוד — אפשר לעצור אותו בחלונית למטה", "warning");
    const min = +R.settings.batchMinSec || 0, todo = recs.filter(r => !r.sum && (r.duration || 0) >= min && (r.loc.length || r.tr)), skipped = recs.filter(r => !r.sum).length - todo.length;
    if (!todo.length) return A().toast(skipped ? `השיחות שנשארו קצרות מ-${min} שניות או שהקובץ שלהן לא נמצא` : "כל השיחות כבר מסוכמות", "warning");
    try { needKey(STT[R.settings.sttProvider].key); needKey(LLM[R.settings.llmProvider].key); } catch (e) { return showErr(e); }
    const sec = todo.filter(r => !r.tr).reduce((a, r) => a + (r.duration || 0), 0);
    if (!(await A().confirmBox("תמלול וסיכום", `יתומללו ויסוכמו ${nf(todo.length)} שיחות (${C.fmtTotal(sec)} אודיו לתמלול)${skipped ? `, בלי ${C.nCalls(skipped)} קצרות מ-${min} שניות` : ""}. תמלול: ${STT[R.settings.sttProvider].label}; סיכום: ${LLM[R.settings.llmProvider].label}. הבקשות יוצאות עם המפתחות שלכם ועשויות לעלות כסף אצל הספק. אפשר לעצור בכל רגע.`, "התחלה"))) return;
    Object.assign(J, { running: true, stop: false, done: 0, fail: 0, total: todo.length, lastErr: "" }); renderJobs();
    const queue = todo.slice(), conc = Math.max(1, Math.min(6, +R.settings.concurrency || 2));
    const worker = async () => { while (queue.length && !J.stop) { const r = queue.shift(); if (await runOne(r, "both")) J.done++; else { J.fail++; J.lastErr = R.errors.get(r.id) || ""; if (/המפתח נדחה|חסר מפתח/.test(J.lastErr) || (J.fail >= 8 && !J.done)) J.stop = true; if (/429/.test(J.lastErr)) await sleep(15000); } renderJobs(); } };
    await Promise.all(Array.from({ length: conc }, worker));
    J.running = false; renderJobs(); A().toast(`הסתיים: ${J.done === 1 ? "שיחה אחת סוכמה" : nf(J.done) + " שיחות סוכמו"}${J.fail ? `, ${nf(J.fail)} נכשלו` : ""}`, J.fail && !J.done ? "error" : undefined);
    rebuild(); refresh();
  }
  function renderJobs() {
    let el = $("rx-jobs"); const J = R.jobs;
    if (!J.running && !J.total) { el?.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "rx-jobs"; el.className = "rx-jobs"; document.body.appendChild(el); }
    const pct = J.total ? (J.done + J.fail) / J.total * 100 : 0;
    el.innerHTML = `<div class="rx-j-h">${J.running ? `<span class="rx-spin"></span>` : ""}<b>${J.running ? (J.stop ? "עוצר…" : "תמלול וסיכום") : "העיבוד הסתיים"}</b><span>${nf(J.done + J.fail)} / ${nf(J.total)}</span><div class="spacer"></div>${J.running ? `<button class="btn btn-quiet btn-sm" data-rxj="stop">עצירה</button>` : `<button class="rx-ib" data-rxj="close" aria-label="סגירה">✕</button>`}</div><div class="rx-prog"><i style="width:${pct}%"></i></div><div class="qx-note">${nf(J.done)} הצליחו${J.fail ? `, ${nf(J.fail)} נכשלו` : ""}</div>${J.lastErr ? `<div class="qx-note rx-j-e">${esc(J.lastErr.slice(0, 160))}</div>` : ""}`;
  }
  async function openAsk(recs, label) {
    const withAI = recs.filter(r => r.sum || r.tr).length; let busy = false;
    const go = async () => {
      const q = ($("rx-mask")?.value || "").trim(), out = $("rx-mans"); if (!q || busy || !out) return; busy = true; out.innerHTML = `<span class="rx-spin"></span> קורא את השיחות וחושב…`;
      try { const c = C.corpus(recs); if (!c.used) throw new UserError("עוד אין תמלולים או סיכומים לשיחות האלה. תמללו או סכמו קודם לפחות חלק מהן."); const qq = C.askRequest(c, q); out.innerHTML = C.mdLite(await llm(qq)) + `<p class="qx-note">התשובה מבוססת על ${C.nCalls(c.used)}.</p>`; }
      catch (e) { out.innerHTML = `<div class="qx-warn">${esc(e.message || e)}</div>`; } finally { busy = false; }
    };
    await A().modal({ kicker: "שאלה על השיחות", title: label, html: `<p>${C.nCalls(recs.length)}, מתוכן <b>${nf(withAI)}</b> עם תמלול או סיכום. ה-AI עונה רק על סמך השיחות שכבר עובדו.</p>${withAI ? "" : `<div class="qx-warn">עוד אין תמלולים לשיחות האלה. אפשר להפעיל “תמלול וסיכום” ואז לשאול.</div>`}<label class="modal-field">השאלה<input id="rx-mask" placeholder="למשל: מה סיכמנו לגבי המחיר? על מה דיברנו בפעם האחרונה?"></label><div class="rx-answer" id="rx-mans"></div>`, buttons: [{ id: "ask", label: "שאלה", primary: true }, { id: "close", label: "סגירה" }], beforeResolve: v => { if (v === "ask") { go(); return false; } return true; } });
  }
  async function askOne(r) {
    const q = ($("rx-ask-in")?.value || "").trim(), out = $("rx-ask-out"); if (!q || !out) return;
    out.innerHTML = `<span class="rx-spin"></span> חושב…`;
    try { out.innerHTML = C.mdLite(await llm(C.askRequest(C.corpus([r]), q))); } catch (e) { out.innerHTML = ""; showErr(e); }
  }
  async function aiSearch() {
    const text = ($("rx-q")?.value || "").trim(); if (!text) return A().toast("כתבו בשורת החיפוש מה מחפשים, למשל: “שיחות ארוכות עם אבא בחודש שעבר”", "warning");
    const b = document.querySelector('[data-rx="ai-search"]'); if (b) { b.disabled = true; b.innerHTML = `<span class="rx-spin"></span> מבין…`; }
    try { const q = C.filterRequest(text, R.contacts); const { f, explain } = C.filterFromAI(C.parseJSONLoose(await llm({ system: q.system, user: q.user, json: true })), R.contacts); R.f = f; R.moreOpen = C.hiddenCount(f) > 0; refresh(true); A().toast(explain ? `הסינון: ${explain}` : "הסינון עודכן"); }
    catch (e) { showErr(e); } finally { const b2 = document.querySelector('[data-rx="ai-search"]'); if (b2) { b2.disabled = false; b2.textContent = "✦ חיפוש חכם"; } }
  }
  function showErr(e) {
    if (e?.name === "AbortError") return; if (!e?.user) console.error(e);
    if (e?.code === "nokey") return A().modal({ kicker: "צריך מפתח API", title: "חסר מפתח", html: `<p>${esc(e.message)}</p><p class="qx-note">המפתח נשמר רק במחשב הזה, והבקשות יוצאות ישירות לספק.</p>`, buttons: [{ id: "settings", label: "פתיחת ההגדרות", primary: true }, { id: "close", label: "סגירה" }] }).then(c => { if (c === "settings") openSettings(); });
    A().toast(e?.message || String(e), "error");
  }

  /* ---------- הגדרות ---------- */
  async function openSettings() {
    const st = R.settings, live = ls.get(MODELS_KEY, {});
    const provOpts = (map, v) => Object.entries(map).map(([k, x]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(x.label)}</option>`).join("");
    const modelOpts = (kind, prov, cur) => { const sug = SUGGEST[kind + "-" + prov] || [], have = new Set(live[kind + "-" + prov] || []), extra = [...have].filter(id => !sug.some(s => s[0] === id)).sort().reverse(); const all = [...sug.map(s => s[0]), ...extra]; return `<optgroup label="${have.size ? "מומלצים (✓ = זמין בחשבון שלכם)" : "מומלצים"}">${sug.map(([id, note]) => `<option value="${esc(id)}" ${id === cur ? "selected" : ""}>${esc(id)}${have.has(id) ? " ✓" : ""}${note ? " · " + esc(note) : ""}</option>`).join("")}</optgroup>${extra.length ? `<optgroup label="עוד מודלים בחשבון שלכם">${extra.map(id => `<option ${id === cur ? "selected" : ""}>${esc(id)}</option>`).join("")}</optgroup>` : ""}${cur && !all.includes(cur) ? `<option selected>${esc(cur)}</option>` : ""}`; };
    const sel = (id, list, v) => `<select id="${id}">${list.map(([k, l]) => `<option value="${k}" ${+v === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const html = `<div class="rx-set"><h3>תמלול וסיכום ב-AI</h3><div class="qx-form"><label class="modal-field">ספק תמלול<select id="rxs-stt">${provOpts(STT, st.sttProvider)}</select></label><label class="modal-field">מודל תמלול<select id="rxs-sttm">${modelOpts("stt", st.sttProvider, st.sttModel[st.sttProvider])}</select></label>
        <label class="modal-field">ספק לסיכומים ולשאלות<select id="rxs-llm">${provOpts(LLM, st.llmProvider)}</select></label><label class="modal-field">מודל<select id="rxs-llmm">${modelOpts("llm", st.llmProvider, st.llmModel[st.llmProvider])}</select></label></div>
        <p class="qx-note">הכי פשוט: מפתח Gemini אחד לשניהם. לתמלול המדויק ביותר בעברית, עם הפרדת דוברים: ElevenLabs. ההקלטות נשלחות לספק רק כשמבקשים תמלול.</p>
      <h3>מפתחות API</h3><p class="qx-note">נשמרים רק במחשב הזה, לא בגיבוי ולא בשרת של אנק״ל.</p>
        ${Object.entries(KEY_META).map(([k, m]) => `<div class="rx-key"><label>${esc(m.label)} <a href="${m.url}" target="_blank" rel="noopener">להוצאת מפתח</a></label><input type="password" data-rxkey="${k}" value="${esc(R.keys[k] || "")}" dir="ltr" autocomplete="off" spellcheck="false"><button class="btn btn-quiet btn-sm" type="button" data-rxs="test" data-p="${k}">בדיקה</button><div class="qx-note" data-rxst="${k}">${esc(m.hint)}</div></div>`).join("")}
      <h3>תצוגה וניגון</h3><div class="qx-form"><label class="modal-field">הסתרת שיחות קצרות${sel("rxs-hide", [[0, "להציג הכל"], [3, "קצרות מ-3 שניות"], [5, "קצרות מ-5 שניות"], [10, "קצרות מ-10 שניות"], [30, "קצרות מ-30 שניות"]], st.hideShort)}</label>
        <label class="modal-field">בעיבוד מרוכז, לדלג על קצרות מ-${sel("rxs-min", [[0, "לא לדלג"], [5, "5 שניות"], [8, "8 שניות"], [15, "15 שניות"], [30, "30 שניות"], [60, "דקה"]], st.batchMinSec)}</label>
        <label class="modal-field">שיחות במקביל בעיבוד מרוכז${sel("rxs-conc", [1, 2, 3, 4, 6].map(v => [v, String(v)]), st.concurrency)}</label></div>
        <label class="check-line"><input type="checkbox" id="rxs-follow" ${st.followTr ? "checked" : ""}> גלילה אוטומטית בתמלול בזמן ניגון</label>
        <label class="check-line"><input type="checkbox" id="rxs-lists" ${st.useLists ? "checked" : ""}> להשלים שמות גם מהרשימות של אנק״ל (אחרי אנשי הקשר שבכרטיס)</label>
      <h3>נתונים</h3><p class="qx-note">הארכיון (ההקלטות שנמצאו, תמלולים, סיכומים, הערות, תגיות ושמות) נשמר במחשב הזה. כדאי לשמור גיבוי מדי פעם.</p>
        <div class="qx-row"><button class="btn btn-quiet btn-sm" type="button" data-rxs="backup">⬇ שמירת גיבוי</button><button class="btn btn-quiet btn-sm" type="button" data-rxs="restore">טעינת גיבוי</button><button class="btn btn-quiet btn-sm" type="button" data-rxs="excel-all">ייצוא הכל לאקסל</button><button class="btn btn-quiet btn-sm" type="button" data-rxs="names">👥 שמות למספרים</button><button class="btn btn-danger btn-sm" type="button" data-rxs="clear">מחיקת הארכיון</button></div>
      <p class="qx-note">קיצורי מקשים בעמוד: רווח — ניגון/השהיה, חצים — 5 שניות, J/K (ח/ל) — הבאה/הקודמת, / — חיפוש, Esc — סגירת החלונית.</p></div>`;
    const choice = await A().modal({ kicker: "הקלטות שיחה", title: "הגדרות ו-AI", html, buttons: [{ id: "save", label: "שמירה", primary: true }, { id: "cancel", label: "ביטול" }], enterConfirms: false });
    if (choice !== "save") return;
    const v = id => $(id)?.value; st.sttProvider = v("rxs-stt"); st.llmProvider = v("rxs-llm"); st.sttModel[st.sttProvider] = v("rxs-sttm") || DEFAULTS.sttModel[st.sttProvider]; st.llmModel[st.llmProvider] = v("rxs-llmm") || DEFAULTS.llmModel[st.llmProvider];
    st.hideShort = +v("rxs-hide"); st.batchMinSec = +v("rxs-min"); st.concurrency = +v("rxs-conc"); st.followTr = !!$("rxs-follow")?.checked; const lists = !!$("rxs-lists")?.checked, listsChanged = lists !== st.useLists; st.useLists = lists;
    document.querySelectorAll("[data-rxkey]").forEach(i => { const k = i.dataset.rxkey, val = i.value.trim(); if (val) R.keys[k] = val; else delete R.keys[k]; });
    ls.set(KEYS_KEY, R.keys); await saveSettings(); if (listsChanged) { C.enrich(R.recs, await contactsContext()); await DB.put(R.recs); reprep(); } refresh(); A().toast("ההגדרות נשמרו");
  }
  async function testKey(p) {
    const input = document.querySelector(`[data-rxkey="${p}"]`), st = document.querySelector(`[data-rxst="${p}"]`), key = (input?.value || "").trim(); if (!st) return;
    if (!key) { st.textContent = "אין מפתח"; return; } st.innerHTML = `<span class="rx-spin"></span> בודק…`;
    try {
      let ids = [];
      if (p === "gemini") ids = ((await apiFetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, {}, "Gemini")).models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace(/^models\//, ""));
      if (p === "openai" || p === "groq") ids = ((await apiFetch(p === "openai" ? "https://api.openai.com/v1/models" : "https://api.groq.com/openai/v1/models", { headers: { authorization: "Bearer " + key } }, p)).data || []).map(m => m.id).sort();
      if (p === "anthropic") ids = ((await apiFetch("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": key, "anthropic-version": "2026-10-21", "anthropic-dangerous-direct-browser-access": "true" } }, "Claude")).data || []).map(m => m.id);
      if (p === "elevenlabs") await apiFetch("https://api.elevenlabs.io/v1/models", { headers: { "xi-api-key": key } }, "ElevenLabs");
      const cls = classifyModels(p, ids), cache = ls.get(MODELS_KEY, {}); let n = 0; for (const [k, list] of Object.entries(cls)) if (list.length) { cache[k] = list; n = Math.max(n, list.length); } ls.set(MODELS_KEY, cache);
      st.textContent = "המפתח תקין" + (n ? `. נמצאו ${n} מודלים — יופיעו ברשימות בפתיחה הבאה של ההגדרות.` : ".");
    } catch (e) { st.textContent = e.message || String(e); }
  }
  function backup() { A().downloadBlob(new Blob([JSON.stringify(C.backupData(R.recs, R.aliases, R.settings))], { type: "application/json" }), "application/json", `גיבוי הקלטות שיחה ${C.localDay(Date.now())}.json`); }
  function restore() {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
    input.onchange = async () => { const f = input.files[0]; if (!f) return; try { const res = C.mergeBackup(R.byId, JSON.parse(await f.text())); for (const r of res.added) R.recs.push(r); Object.assign(R.aliases, res.aliases); await saveAliases(); await DB.put([...res.added, ...res.merged]); reprep(); refresh(); A().toast(`הגיבוי נטען: ${nf(res.added.length)} הקלטות נוספו, ${nf(res.merged.length)} עודכנו`); } catch (e) { A().toast(e.message || "הקובץ לא נקרא כגיבוי", "error"); } };
    input.click();
  }
  async function excel(recs) {
    try {
      await A().ensureXlsx(); const X = window.XLSX, ws = X.utils.aoa_to_sheet(C.exportRows(recs)); ws["!cols"] = [10, 6, 7, 22, 13, 7, 8, 8, 30, 50, 40, 20, 30, 6, 30].map(w => ({ wch: w }));
      const wb = X.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; X.utils.book_append_sheet(wb, ws, "שיחות");
      const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; A().downloadBlob(new Blob([X.write(wb, { type: "array", bookType: "xlsx" })], { type: mime }), mime, `שיחות ${C.localDay(Date.now())}.xlsx`);
    }
    catch (e) { console.error(e); A().toast("הייצוא לאקסל נכשל: " + (e.message || e), "error"); }
  }
  async function namesDialog() {
    const lists = A().getLists(), unsaved = new Set(R.recs.filter(r => !r._.saved && r.number).map(r => r._.key)).size;
    const choice = await A().modal({ kicker: "שמות למספרים", title: `${nf(unsaved)} מספרים בלי שם`, html: `<p>מספר שלא שמור בטלפון יכול לקבל שם מאנשי קשר אחרים: מרשימה באנק״ל, או מקובץ (VCF מהטלפון, CSV מ-Google, Excel). שם שכבר נתתם ידנית לא משתנה.</p>${lists.length ? `<label class="modal-field">רשימה באנק״ל<select id="rx-nl">${lists.map(l => `<option value="${esc(l.id)}">${esc(l.name)} (${l.contacts.length})</option>`).join("")}</select></label>` : ""}`, buttons: [...(lists.length ? [{ id: "list", label: "מהרשימה", primary: true }] : []), { id: "file", label: "מקובץ…", primary: !lists.length }, { id: "cancel", label: "ביטול" }] });
    let contacts = null;
    if (choice === "list") contacts = (lists.find(l => l.id === $("rx-nl")?.value) || {}).contacts;
    if (choice === "file") { const file = await new Promise(res => { const i = document.createElement("input"); i.type = "file"; i.accept = ".vcf,.csv,.xlsx,.xls"; i.onchange = () => res(i.files[0] || null); i.oncancel = () => res(null); i.click(); }); if (file) contacts = await A().importFileToContacts(file); }
    if (!contacts?.length) return;
    const res = C.namesFromContacts(R.recs, contacts, R.aliases); R.aliases = res.aliases; await saveAliases(); reprep(); refresh();
    A().modal({ kicker: "שמות למספרים", title: res.named ? `${nf(res.named)} מספרים קיבלו שם` : "לא נמצאו התאמות", html: `<p>${nf(contacts.length)} אנשי קשר נקראו; ${nf(res.calls)} שיחות קיבלו שם. אפשר לשנות כל שם ב-✎ בחלונית.</p>`, buttons: [{ id: "ok", label: "סגירה", primary: true }] });
  }
  async function clearArchive() {
    if (!(await A().confirmBox("מחיקת הארכיון", "למחוק את כל ארכיון ההקלטות מהמחשב הזה — תמלולים, סיכומים, הערות, תגיות, שמות ורשימת התיקיות? קבצי ההקלטות עצמם לא נמחקים. כדאי לשמור גיבוי קודם.", "מחיקה"))) return;
    closePlayer(); await DB.clear(); R.recs = []; R.byId.clear(); R.aliases = {}; R.folders = []; R.aside = null; reprep(); refresh(); A().toast("הארכיון נמחק"); if (cardAdapter()) syncCard(true);
  }

  /* ---------- הכרטיס: ניקוי, העברה למחשב, מחיקה ---------- */
  async function removeFiles(r, folders) {   // מוחק את הקובץ במקומות שנבחרו; מחזיר אם נשאר בלי קובץ
    for (const l of r.loc.filter(l => folders.includes(l.folder))) { const ad = await adapterFor(l.folder, true); if (!ad) continue; try { await ad.remove(l.rel); r.loc = r.loc.filter(x => x !== l); } catch (e) { console.error(e); } }
    return !r.loc.length;
  }
  const precious = r => r.tr || r.sum || r.note || r.star || (r.tags || []).length;
  async function forget(list) { const ids = list.map(r => r.id); ids.forEach(id => R.byId.delete(id)); R.recs = R.recs.filter(r => !ids.includes(r.id)); if (P.rec && ids.includes(P.rec.id)) closePlayer(); if (R.aside?.id && ids.includes(R.aside.id)) R.aside = null; await DB.del(ids); }
  async function cleanCard() {
    const ad = cardAdapter(); if (!ad) return;
    const empty = R.card.empty || [], onCard = R.recs.filter(r => r.loc.some(l => l.folder === "card")), shortOf = s => onCard.filter(r => (r.duration || 0) < s);
    const choice = await A().modal({ kicker: "הקלטות שיחה", title: "ניקוי הכרטיס", html: `<p>מה למחוק מהכרטיס?</p><label class="check-line"><input type="checkbox" id="rx-cl-empty" ${empty.length ? "checked" : "disabled"}> קבצים ריקים (0 בתים): <b>${empty.length}</b></label><p class="qx-note">הטלפון יוצר קובץ ריק כשההקלטה לא התחילה; בכל המקרים שנבדקו ההקלטה האמיתית של אותה שיחה נמצאת לידו, שנייה אחריו.</p>
      <label class="check-line"><input type="checkbox" id="rx-cl-short"> הקלטות קצרות מ-<select id="rx-cl-sec">${[2, 3, 5, 10].map(s => `<option value="${s}" ${s === 3 ? "selected" : ""}>${s} שניות (${shortOf(s).length})</option>`).join("")}</select></label><p class="qx-note">הקלטה של שנייה-שתיים היא בדרך כלל שיחה שנותקה מיד או צינתוק. לא מסומן מראש — כדאי להציץ ברשימה קודם (מסנן “קצרות”).</p>`, buttons: [{ id: "go", label: "המשך", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "go") return;
    const delEmpty = $("rx-cl-empty")?.checked ? empty : [], shorts = $("rx-cl-short")?.checked ? shortOf(Number($("rx-cl-sec")?.value) || 3) : [];
    if (!delEmpty.length && !shorts.length) return A().toast("לא נבחר שום דבר למחיקה", "warning");
    if (!(await A().confirmBox("מחיקה מהכרטיס", `למחוק מהכרטיס ${delEmpty.length + shorts.length} קבצים${shorts.length ? ` (מתוכם ${shorts.length} הקלטות קצרות)` : " ריקים"}? אי אפשר לשחזר מחיקה.`, "מחיקה"))) return;
    // הקלטה קצרה שנשארה בלי קובץ יוצאת מהארכיון, אלא אם יש לה משהו לשמור (תמלול, הערה, מועדף…)
    let n = 0; const gone = [], changed = [];
    for (const f of delEmpty) { busyNote(`מוחק מהכרטיס… ${n + 1}`); try { await ad.remove(f.rel); n++; } catch (e) { console.error(e); } }
    for (const r of shorts) { busyNote(`מוחק מהכרטיס… ${n + 1}`); if (await removeFiles(r, ["card"])) { if (precious(r)) changed.push(r); else gone.push(r); } else changed.push(r); n++; }
    busyNote("");
    R.card.empty = (R.card.empty || []).filter(f => !delEmpty.includes(f)); await forget(gone); await DB.put(changed); reprep(); refresh(); notifyQualix();
    A().toast(`נמחקו ${n} קבצים מהכרטיס`);
  }
  async function exportToComputer() {
    const ad = cardAdapter(); if (!ad) return;
    const onCard = R.recs.filter(r => r.loc.some(l => l.folder === "card")), shownOnCard = R.filtered.filter(r => r.loc.some(l => l.folder === "card"));
    const before = days => { const cut = C.addDays(C.localDay(Date.now()), -days); return onCard.filter(r => r._.day < cut); };
    const scopes = [["all", "כל ההקלטות שבכרטיס", onCard], ["7", "ישנות משבוע", before(7)], ["30", "ישנות מחודש", before(30)], ["90", "ישנות משלושה חודשים", before(90)], ...(shownOnCard.length !== onCard.length ? [["shown", "רק מה שמוצג עכשיו ברשימה", shownOnCard]] : [])];
    const size = list => fmtSize(list.reduce((n, r) => n + (r.loc.find(l => l.folder === "card")?.size || 0), 0));
    const choice = await A().modal({ kicker: "הקלטות שיחה", title: "העברה למחשב", html: `<label class="modal-field">אילו הקלטות<select id="rx-ex-scope">${scopes.map(([k, l, list]) => `<option value="${k}">${l} — ${list.length} (${size(list)})</option>`).join("")}</select></label>
      <label class="modal-field">לאן<select id="rx-ex-dest">${R.folders.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}<option value="">תיקייה חדשה במחשב…</option></select></label>
      <label class="modal-field">בפורמט<select id="rx-ex-format"><option value="orig">כמו בטלפון — הקובץ הקטן</option><option value="pcm">WAV רגיל — נפתח בכל נגן, גדול פי 4</option></select></label>
      <label class="check-line"><input type="checkbox" id="rx-ex-remove" checked> למחוק מהכרטיס אחרי שההעתקה נבדקה (מפנה מקום)</label>
      <p class="qx-note">כל חודש נכנס לתת-תיקייה משלו (למשל 2026-10), ושם הקובץ נשאר כמו בטלפון. קובץ נמחק מהכרטיס רק אחרי שנמצא במחשב באותו גודל. ההקלטות נשארות בארכיון עם כל התמלולים — ומתנגנות מהמחשב.</p>`, buttons: [{ id: "go", label: "העברה", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "go") return;
    const scope = $("rx-ex-scope")?.value || "all", destId = $("rx-ex-dest")?.value || "", plain = $("rx-ex-format")?.value === "pcm", removeAfter = !!$("rx-ex-remove")?.checked;
    const todo = (scopes.find(s => s[0] === scope) || scopes[0])[2].slice(); if (!todo.length) return A().toast("אין הקלטות בטווח שנבחר", "warning");
    const folder = destId ? R.folders.find(f => f.id === destId) : await addFolder(); if (!folder) return;
    const dest = await folderAdapter(folder, true); if (!dest) return A().toast("אין גישה לתיקייה במחשב", "error");
    const byMonth = new Map(); for (const r of todo) { const m = r._.month; if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(r); }
    let copied = 0, failed = 0, bytesOut = 0, removed = 0, k = 0; const changed = new Set();
    try {
      for (const [month, list] of byMonth) {
        const written = new Map();
        for (const r of list) {
          busyNote(`מעתיק למחשב… ${++k}/${todo.length}`);
          try { const l = r.loc.find(x => x.folder === "card"), bytes = await ad.read(l.rel), out = plain ? ((Q.playableWav(bytes) || {}).bytes || bytes) : bytes, rel = join(month, l.rel.split("/").pop()); await dest.write(rel, out); written.set(rel.split("/").pop(), { r, rel, size: out.length }); if (dest.utimes) { try { await dest.utimes(rel, new Date(r.iso).getTime()); } catch (_) { } } }
          catch (e) { console.error(e); failed++; }
        }
        // בדיקה: כל קובץ נמצא במחשב באותו גודל — רק אז הוא מקבל את המקום החדש, ורק אז מותר למחוק מהכרטיס
        const there = new Map((await dest.list(month)).filter(e => e.kind === "file").map(e => [e.name, e.size]));
        for (const [name, w] of written) {
          if (there.get(name) !== w.size) { failed++; continue; }
          copied++; bytesOut += w.size; w.r.loc = w.r.loc.filter(l => l.folder !== folder.id).concat({ folder: folder.id, rel: w.rel, size: w.size }); changed.add(w.r);
          if (removeAfter) { busyNote(`מוחק מהכרטיס את מה שהועתק… ${removed + 1}`); const l = w.r.loc.find(x => x.folder === "card"); try { await ad.remove(l.rel); w.r.loc = w.r.loc.filter(x => x !== l); removed++; } catch (e) { console.error(e); } }
        }
      }
    } catch (e) { console.error(e); A().toast("ההעברה נעצרה: " + (e.message || e), "error"); }
    finally { busyNote(""); }
    folder.lastSync = Date.now(); await saveFolders(); await DB.put([...changed]); reprep(); refresh(); notifyQualix();
    await A().modal({ kicker: "הקלטות שיחה", title: failed ? "ההעברה הסתיימה — חלק לא הועבר" : "ההעברה הסתיימה", html: `<p>הועתקו <b>${copied}</b> הקלטות (${fmtSize(bytesOut)}) לתיקייה <b>${esc(folder.name)}</b>, בתת-תיקייה לכל חודש.</p>${removeAfter ? `<p>נמחקו מהכרטיס: <b>${removed}</b>.</p>` : `<p class="qx-note">בכרטיס לא נמחק כלום.</p>`}${failed ? `<div class="qx-warn">${failed} קבצים לא הועתקו או לא נמצאו במחשב באותו גודל — הם נשארו בכרטיס.</div>` : ""}<p class="qx-note">ההקלטות נשארו בארכיון ומתנגנות מהמחשב.</p>`, buttons: [{ id: "ok", label: "סגירה", primary: true }] });
  }
  async function deleteRec(id) {
    const r = R.byId.get(id); if (!r) return;
    const where = r.loc.map(locLabel).join(", ");
    if (!(await A().confirmBox("מחיקת הקלטה", `למחוק את ההקלטה עם ${r._.who} מ-${r._.day.split("-").reverse().join(".")} ${r.iso.slice(11, 16)}?${where ? ` הקובץ יימחק מ: ${where}.` : ""} גם התמלול, הסיכום וההערות יימחקו. אי אפשר לשחזר.`, "מחיקה"))) return;
    const before = r.loc.length; await removeFiles(r, r.loc.map(l => l.folder));
    if (r.loc.length) { await saveRec(r); reprep(); refresh(); return A().toast(`חלק מהקבצים לא נמחקו (${r.loc.map(locLabel).join(", ")}) — ההקלטה נשארה בארכיון`, "warning"); }
    await forget([r]); reprep(); refresh(); notifyQualix(); A().toast(before ? "ההקלטה נמחקה" : "ההקלטה הוסרה מהארכיון");
  }
  async function saveFile(id) {
    const r = R.byId.get(id); if (!r) return; busyNote("מכין את הקובץ…");
    try { const { bytes } = await readRec(r), wav = /\.wav$/i.test(r.fileName) ? Q.playableWav(bytes) : null; A().downloadBlob(new Blob([wav ? wav.bytes : bytes], { type: wav ? "audio/wav" : mimeOf(r.fileName) }), wav ? "audio/wav" : mimeOf(r.fileName), r.fileName); }
    catch (e) { showErr(e); } finally { busyNote(""); }
  }
  async function foldersDialog() {
    const rows = R.folders.map(f => `<div class="modal-list-row"><span>💾 ${esc(f.name)}<br><small class="qx-note">${nf(R.recs.filter(r => r.loc.some(l => l.folder === f.id)).length)} הקלטות · סנכרון אחרון ${f.lastSync ? new Date(f.lastSync).toLocaleString("he-IL") : "לא בוצע"}</small></span><b><button class="btn btn-quiet btn-sm" data-rxf="sync" data-id="${esc(f.id)}">↻ סנכרון</button> <button class="btn btn-quiet btn-sm" data-rxf="remove" data-id="${esc(f.id)}">הסרה</button></b></div>`).join("");
    const choice = await A().modal({ kicker: "הקלטות שיחה", title: "תיקיות במחשב", html: `${rows ? `<div class="modal-list">${rows}</div>` : "<p>עוד לא נוספו תיקיות.</p>"}<p class="qx-note">תיקייה במחשב עם הקלטות (למשל לאן שהעברתם מהכרטיס). כל הקלטה מזוהה לפי התאריך, השעה ומי — כך שאותה הקלטה לא נכנסת פעמיים גם אם היא גם בכרטיס וגם במחשב. הסרת תיקייה לא מוחקת קבצים.</p>`, buttons: [{ id: "add", label: "💾 הוספת תיקייה", primary: true }, { id: "close", label: "סגירה" }] });
    if (choice === "add") addAndSync();
  }
  async function folderAction(act, id) {
    const f = R.folders.find(x => x.id === id); if (!f) return; document.querySelector('[data-modal-choice="close"]')?.click();
    if (act === "sync") return syncFolder(f, true, false);
    if (!(await A().confirmBox("הסרת תיקייה", `להסיר את “${f.name}” מהארכיון? הקבצים במחשב לא נמחקים; הקלטות שנמצאות רק שם יישארו בארכיון עם התמלולים, בלי אפשרות להשמיע.`, "הסרה"))) return;
    R.folders = R.folders.filter(x => x !== f); const changed = R.recs.filter(r => r.loc.some(l => l.folder === id)); changed.forEach(r => { r.loc = r.loc.filter(l => l.folder !== id); });
    await saveFolders(); await DB.put(changed); reprep(); refresh(); A().toast("התיקייה הוסרה");
  }
  function busyNote(text) { let el = $("rx-busy"); if (!text) { el?.remove(); return; } if (!el) { el = document.createElement("div"); el.id = "rx-busy"; el.className = "qx-warn rx-busy"; document.body.appendChild(el); } el.textContent = text; }

  /* ---------- אירועים ---------- */
  document.addEventListener("click", async e => {
    const j = e.target.closest?.("[data-rxj]"); if (j) { if (j.dataset.rxj === "stop") { R.jobs.stop = true; for (const c of R.ctrl.values()) c.abort(); } else R.jobs.total = 0; return renderJobs(); }
    const pb = e.target.closest?.("[data-rxp]");
    if (pb) {
      const a = pb.dataset.rxp;
      if (a === "play") return togglePlay(); if (a === "back") { P.audio.currentTime = Math.max(0, P.audio.currentTime - 10); return tick(); } if (a === "fwd") { P.audio.currentTime = Math.min(P.audio.duration || 0, P.audio.currentTime + 10); return tick(); }
      if (a === "prev" || a === "next") { const n = neighbor(a === "next" ? 1 : -1); if (n) play(n.id); return; }
      if (a === "speed") { const i = SPEEDS.indexOf(R.settings.speed || 1); R.settings.speed = SPEEDS[(i + 1) % SPEEDS.length]; P.audio.playbackRate = R.settings.speed; setSpeedLabel(); return saveSettings(); }
      if (a === "close") return closePlayer();
      if (a === "info" && P.rec) { if (!onPage()) { R.pendingOpen = P.rec.id; return A().setPage("recordings"); } return openRec(P.rec.id); }
      return;
    }
    const s = e.target.closest?.("[data-rxs]"); if (s) { const a = s.dataset.rxs; if (a === "test") return testKey(s.dataset.p); if (a === "backup") return backup(); if (a === "restore") return restore(); if (a === "excel-all") return excel(R.recs); if (a === "names") { document.querySelector('[data-modal-choice="cancel"]')?.click(); return namesDialog(); } if (a === "clear") { document.querySelector('[data-modal-choice="cancel"]')?.click(); return clearArchive(); } return; }
    const fb = e.target.closest?.("[data-rxf]"); if (fb) return folderAction(fb.dataset.rxf, fb.dataset.id);
    const el = e.target.closest?.("[data-rx]"); if (!el || !el.closest("#recordings-root")) return;
    const a = el.dataset.rx, id = el.dataset.id;
    try {
      switch (a) {
        case "open": return openRec(id);
        case "play": e.stopPropagation(); return togglePlay(id);
        case "star": e.stopPropagation(); return toggleStar(id);
        case "close": return closeAside();
        case "view": R.view = el.dataset.view; ls.set("ankal.recordings.view", R.view); renderTop(); return renderView();
        case "date": R.f.date = el.dataset.v; if (R.f.date === "custom" && !R.f.from) { R.f.from = R.recs[R.recs.length - 1]?._.day || ""; R.f.to = C.localDay(Date.now()); } return refresh(true);
        case "dir": R.f.dir = el.dataset.v; return refresh(true);
        case "wd": { const i = +el.dataset.i; R.f.wd = R.f.wd.includes(i) ? R.f.wd.filter(x => x !== i) : [...R.f.wd, i]; return refresh(true); }
        case "more": R.moreOpen = !R.moreOpen; return renderFilters();
        case "clear": R.f = C.defaultFilter(); return refresh(true);
        case "rm-contact": R.f.contacts = R.f.contacts.filter(c => c !== el.dataset.c); return refresh(true);
        case "rm-ids": R.f.ids = null; R.f.idsLabel = ""; return refresh(true);
        case "sync": return syncAll(true);
        case "card-connect": { const qx = QX(); if (window.electronAPI?.qualix) await qx.detectCards(false); else await qx.chooseFolder(); return; }
        case "folders": return foldersDialog();
        case "add-folder": return addAndSync();
        case "perm": for (const f of R.folders.filter(f => f._need)) await syncFolder(f, true, true); return;
        case "clean": return cleanCard();
        case "export": return exportToComputer();
        case "settings": return openSettings();
        case "ai-search": e.preventDefault(); return aiSearch();
        case "ask-results": return openAsk(R.filtered, R.f.contacts.length === 1 ? `השיחות עם ${R.f.contacts[0]}` : "השיחות שמוצגות כרגע");
        case "batch": return startBatch(R.filtered);
        case "excel": return excel(R.filtered);
        case "cal-day": { const sc = document.querySelector(".rx-ym-scroll"), keep = sc ? sc.scrollLeft : 0; R.calDay = el.dataset.day; R.calMonth = R.calDay.slice(0, 7); renderView(); const sc2 = document.querySelector(".rx-ym-scroll"); if (sc2 && el.closest(".rx-ym")) requestAnimationFrame(() => { sc2.scrollLeft = keep; }); return; }
        case "cal-goto": R.calDay = el.dataset.day; R.calMonth = R.calDay.slice(0, 7); R.view = "calendar"; renderTop(); return renderView();
        case "mon": { const [y, m] = R.calMonth.split("-").map(Number), d = new Date(y, m - 1 + +el.dataset.d, 1); R.calMonth = C.localDay(d.getTime()).slice(0, 7); R.calDay = ""; return renderView(); }
        case "day-list": Object.assign(R.f, { date: "custom", from: R.calDay, to: R.calDay }); R.view = "list"; return refresh(true);
        case "person": return openPerson(el.dataset.who);
        case "psort": R.peopleSort = el.dataset.k; return renderPeopleTable();
        case "names": return namesDialog();
        case "person-filter": R.f = Object.assign(C.defaultFilter(), { contacts: [el.dataset.who] }); R.view = "list"; return refresh(true);
        case "ask-person": return openAsk(R.recs.filter(r => r._.who === el.dataset.who), `השיחות עם ${el.dataset.who}`);
        case "batch-person": return startBatch(R.recs.filter(r => r._.who === el.dataset.who));
        case "rename": return renameDialog(el.dataset.who);
        case "ai": { const r = R.byId.get(id); if (r) runOne(r, el.dataset.mode === "tr" ? "tr" : "both"); return; }
        case "cancel": R.ctrl.get(id)?.abort(); return;
        case "seek": { const t = +el.dataset.s; if (P.rec?.id !== id) await play(id, t); else { P.audio.currentTime = t; if (P.audio.paused) P.audio.play().catch(() => { }); } return; }
        case "copy-tr": { const r = R.byId.get(id); try { await navigator.clipboard.writeText(C.trText(r)); A().toast("התמלול הועתק"); } catch (_) { A().toast("ההעתקה נכשלה", "error"); } return; }
        case "rm-tag": { const r = R.byId.get(id); r.tags = (r.tags || []).filter(t => t !== el.dataset.tag); await saveRec(r); rebuild(); return renderAside(); }
        case "tag-filter": R.f = Object.assign(C.defaultFilter(), { tag: el.dataset.tag }); R.moreOpen = true; R.view = "list"; return refresh(true);
        case "ask-one": return askOne(R.byId.get(id));
        case "save-file": return saveFile(id);
        case "delete": return deleteRec(id);
      }
    } catch (err) { showErr(err); }
  });
  document.addEventListener("dblclick", e => { const row = e.target.closest?.(".rx-row[data-id]"); if (row && !e.target.closest("button")) play(row.dataset.id); });
  document.addEventListener("submit", e => { if (e.target.id === "rx-search-form") { e.preventDefault(); aiSearch(); } });
  let qTimer = 0;
  document.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "rx-q") { R.f.q = t.value; clearTimeout(qTimer); qTimer = setTimeout(() => { applyFilter(); renderTop(); const q = $("rx-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } renderFilters(); renderView(); }, 200); }
    if (t.id === "rx-ppl-q") { R.peopleQ = t.value; renderPeopleTable(); }
    if (t.id === "rx-note" && R.aside?.type === "rec") { const r = R.byId.get(R.aside.id); if (r) { r.note = t.value; saveSoon(r); } }
    if (t.id === "rx-trq") { R.trq = t.value; renderAside(); }
  });
  document.addEventListener("change", e => {
    const t = e.target, f = R.f, map = { "rx-from": "from", "rx-to": "to", "rx-dur": "dur", "rx-status": "status", "rx-sort": "sort", "rx-tod": "tod", "rx-kind": "kind", "rx-tag": "tag" };
    if (map[t.id]) { f[map[t.id]] = t.value; return refresh(true); }
    if (t.id === "rx-contact") { const v = t.value.trim(); if (!v) return; const c = R.contacts.find(x => x.who === v) || R.contacts.find(x => C.norm(x.who).includes(C.norm(v))); if (!c) return A().toast("לא נמצא איש קשר בשם הזה", "warning"); if (!f.contacts.includes(c.who)) f.contacts.push(c.who); return refresh(true); }
    if (t.id === "rxs-stt" || t.id === "rxs-llm") { const kind = t.id === "rxs-stt" ? "stt" : "llm", m = $(t.id + "m"), cur = R.settings[kind + "Model"][t.value] || DEFAULTS[kind + "Model"][t.value]; if (m) { const sug = SUGGEST[kind + "-" + t.value] || [], live = ls.get(MODELS_KEY, {})[kind + "-" + t.value] || []; m.innerHTML = [...sug.map(s => s[0]), ...live.filter(id => !sug.some(s => s[0] === id))].map(id => `<option ${id === cur ? "selected" : ""}>${esc(id)}</option>`).join(""); } }
  });
  document.addEventListener("keydown", async e => {
    if (!onPage()) return;
    const t = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
    if (t.id === "rx-tag-in" && e.key === "Enter") { e.preventDefault(); const r = R.byId.get(R.aside?.id), v = t.value.trim().replace(/^#/, ""); if (!r || !v) return; r.tags = [...new Set([...(r.tags || []), v])]; await saveRec(r); rebuild(); renderAside(); $("rx-tag-in")?.focus(); return; }
    if (t.id === "rx-ask-in" && e.key === "Enter") { e.preventDefault(); return askOne(R.byId.get(R.aside?.id)); }
    if (t.matches?.(".rx-row[data-id]") && e.key === "Enter") { e.preventDefault(); return openRec(t.dataset.id); }
    if (modalOpen()) return;
    if (e.key === "Escape") { if (typing) return t.blur(); if (R.aside) return closeAside(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); $("rx-q")?.focus(); }
    else if (e.key === " ") { e.preventDefault(); togglePlay(); }
    // ציר הזמן בנגן משמאל לימין, ולכן חץ ימינה = קדימה
    else if (e.key === "ArrowRight" && P.entry) { e.preventDefault(); P.audio.currentTime = Math.min(P.audio.duration || 0, P.audio.currentTime + 5); tick(); }
    else if (e.key === "ArrowLeft" && P.entry) { e.preventDefault(); P.audio.currentTime = Math.max(0, P.audio.currentTime - 5); tick(); }
    else if (/^[jJח]$/.test(e.key)) { const n = neighbor(1); if (n) { play(n.id); if (R.aside?.type === "rec") openRec(n.id); } }
    else if (/^[kKל]$/.test(e.key)) { const n = neighbor(-1); if (n) { play(n.id); if (R.aside?.type === "rec") openRec(n.id); } }
  });
  // רמז צף לעמודות, ימים ומפת החום — גם במעבר מקלדת
  (() => {
    let tip = null, cur = null;
    const show = el => { if (el === cur) return; cur = el; if (!el) { tip?.classList.add("hidden"); return; } if (!tip) { tip = document.createElement("div"); tip.className = "rx-tip"; document.body.appendChild(tip); } tip.textContent = el.dataset.tip; tip.classList.remove("hidden"); const b = el.getBoundingClientRect(), tb = tip.getBoundingClientRect(); let x = b.left + b.width / 2 - tb.width / 2, y = b.top - tb.height - 8; if (y < 6) y = b.bottom + 8; tip.style.left = Math.max(6, Math.min(innerWidth - tb.width - 6, x)) + "px"; tip.style.top = y + "px"; };
    document.addEventListener("mouseover", e => show(e.target.closest?.("#recordings-root [data-tip]") || null));
    document.addEventListener("focusin", e => show(e.target.closest?.("#recordings-root [data-tip]") || null));
    document.addEventListener("scroll", () => show(null), true);
  })();
  window.addEventListener("beforeunload", e => { if (R.jobs.running) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- חיבור לשאר אנק״ל ---------- */
  // אחרי סנכרון: גיבוי קיוליקס מצייר מחדש את 🎙 בכרטיסי אנשי הקשר וביומן
  function notifyQualix() { QX()?.recordingsChanged?.(); }
  /* העמוד עצמו (setPage("recordings")). recOpts מגיעים מכרטיס איש קשר (ids) או מפרטי שיחה ביומן (play). */
  async function show() {
    await ensureLoaded(); R.rendered = false; applyFilter(); renderPage();
    const opts = R.pending; R.pending = null;
    // בתוכנה למחשב: כרטיס שחובר מזוהה לבד, כמו בניהול פתקים (בדפדפן בוחרים אותו — אין גישה לכוננים)
    if (!cardAdapter() && window.electronAPI?.qualix && !R.detected) { R.detected = true; await QX()?.detectCards(true); }
    if (cardAdapter() && !R.card.synced) await syncCard(true);
    for (const f of R.folders.filter(f => !f.lastSync || f.kind === "electron")) { if (!f._synced) { f._synced = true; await syncFolder(f, false, true); } }
    if (opts?.ids) { R.f = Object.assign(C.defaultFilter(), { ids: opts.ids, idsLabel: opts.label || "" }); R.view = "list"; refresh(true); }
    if (opts?.play) { R.f = C.defaultFilter(); R.view = "list"; refresh(true); openRec(opts.play); if (P.rec?.id === opts.play && P.entry) P.audio.play().catch(() => { }); else await play(opts.play); }
    if (R.pendingOpen) { openRec(R.pendingOpen); R.pendingOpen = null; }
  }
  function open(opts) { R.pending = opts || null; if (onPage()) return show(); A().setPage("recordings"); }
  /* הכרטיס חובר (או הוחלף) בגיבוי קיוליקס. provider: { adapter, backups(), openContacts() }, או null */
  async function cardConnected(provider) {
    await ensureLoaded();
    R.card = provider ? Object.assign({ dirs: [], empty: [], synced: 0 }, provider) : null;
    if (provider) await syncCard(true); else refresh();
  }
  function forContact(c) { if (!R.index || !c) return []; return R.index(c).map(x => R.byId.get(x.id)).filter(Boolean); }
  function ofCall(number, time) {
    const keys = Q.numberKeys(number);
    for (let dt = 0; dt <= 3; dt++) for (const t of dt ? [time - dt, time + dt] : [time]) for (const r of R.byTime.get(t) || []) if (r.number && Q.numberKeys(r.number).some(k => keys.includes(k))) return r;
    return null;
  }
  ensureLoaded();
  window.ANKAL_RECORDINGS = { show, open, cardConnected, forContact, ofCall, syncCard, syncFolder, play, state: R, player: P };
})();
