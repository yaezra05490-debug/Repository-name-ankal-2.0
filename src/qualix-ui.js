/* גיבוי קיוליקס — הממשק. קורא תיקיית ibphone מכרטיס הזיכרון (או מתיקייה שנבחרה), נותן לערוך כל קטגוריה,
   ושומר גרסה חדשה שהטלפון יודע לשחזר. הפורמט עצמו חי ב-qualix.js; החלונות, ההודעות והרשימות מגיעים
   מ-app.js דרך window.ANKAL_APP. כל הלחיצות כאן עוברות ב-data-qx, בנפרד ממפת הפעולות של האפליקציה. */
(function () {
  "use strict";
  const Q = window.ANKAL_QUALIX;
  const A = () => window.ANKAL_APP;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LIMIT_KEY = "ankal.qualix.memoLimit", WIDTH_KEY = "ankal.qualix.widths";
  const CAT_HE = { phonebook: "אנשי קשר", callog: "יומן שיחות", schedule: "לוח שנה", settings: "הגדרות", memo: "הפתקים שלי", udb: "חיזוי טקסט", playlist: "רשימות השמעה" };
  const TABS = [["contacts", "אנשי קשר", "◫"], ["calls", "יומן שיחות", "☎"], ["memos", "הפתקים שלי", "✎"], ["calendar", "לוח שנה", "▦"], ["playlists", "רשימות השמעה", "♪"], ["dictionary", "חיזוי טקסט", "⌨"], ["settings", "הגדרות", "⚙"]];
  const isBackupName = n => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(n);
  const AUDIO = /\.(mp3|wav|amr|mid|midi|aac|m4a|wma)$/i;

  /* view: "versions" = רשימת הגרסאות (כמו "הרשימות שלי"), "editor" = הקטגוריות של הגרסה הפתוחה (כמו "אנשי קשר") */
  const qx = { adapter: null, layout: null, backups: [], open: null, view: "versions", tab: "contacts", busy: "", search: "", memoLimit: 1000, widths: null, memoIdx: 0, plIdx: 0, rendered: false, keepView: false };
  try { qx.memoLimit = Number(localStorage.getItem(LIMIT_KEY)) || 1000; qx.widths = JSON.parse(localStorage.getItem(WIDTH_KEY) || "null"); } catch (_) { }
  const widths = () => qx.widths || Q.WIDTHS;

  /* ---------- גישה לקבצים: התוכנה למחשב (IPC) או הדפדפן (File System Access) ---------- */
  function electronAdapter(root, label) {
    const api = window.electronAPI.qualix;
    return { label, kind: "electron", list: rel => api.list(root, rel || ""), read: async rel => new Uint8Array(await api.read(root, rel)), write: (rel, bytes) => api.write(root, rel, bytes), mkdir: rel => api.mkdir(root, rel), remove: rel => api.remove(root, rel), exists: rel => api.exists(root, rel) };
  }
  function fsaAdapter(handle, label) {
    async function dirOf(rel, create) { let dir = handle; for (const part of String(rel || "").split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: !!create }); return dir; }
    const split = rel => { const parts = String(rel).split("/").filter(Boolean); return { dir: parts.slice(0, -1).join("/"), name: parts[parts.length - 1] }; };
    return {
      label, kind: "fsa",
      list: async rel => { const dir = await dirOf(rel, false); const out = []; for await (const [name, h] of dir.entries()) out.push({ name, kind: h.kind, size: 0 }); return out; },
      read: async rel => { const { dir, name } = split(rel); const fh = await (await dirOf(dir, false)).getFileHandle(name); return new Uint8Array(await (await fh.getFile()).arrayBuffer()); },
      write: async (rel, bytes) => { const { dir, name } = split(rel); const fh = await (await dirOf(dir, true)).getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(bytes); await w.close(); return true; },
      mkdir: async rel => { await dirOf(rel, true); return true; },
      remove: async rel => { const { dir, name } = split(rel); await (await dirOf(dir, false)).removeEntry(name, { recursive: true }); return true; },
      exists: async rel => { try { const { dir, name } = split(rel); const d = await dirOf(dir, false); try { await d.getDirectoryHandle(name); return true; } catch (_) { await d.getFileHandle(name); return true; } } catch (_) { return false; } }
    };
  }
  const join = (...parts) => parts.filter(p => p !== "" && p != null).join("/");

  /* איך נראית התיקייה שנבחרה: הכרטיס עצמו (יש בו ibphone), תיקיית ibphone, או גיבוי בודד */
  async function detectLayout(adapter) {
    const entries = await adapter.list("");
    const dir = n => entries.find(e => e.kind === "directory" && e.name.toLowerCase() === n.toLowerCase());
    if (dir("ibphone")) return { mode: "card", ibphoneRel: dir("ibphone").name, pbRel: dir("PB")?.name || "PB", canSave: true };
    if (entries.some(e => e.kind === "directory" && isBackupName(e.name))) return { mode: "ibphone", ibphoneRel: "", pbRel: null, canSave: true };
    if (entries.some(e => e.name === "ibphone_head.in" || e.name === "phonebook.ib")) return { mode: "single", ibphoneRel: null, pbRel: null, canSave: false };
    return null;
  }

  async function connect(adapter) {
    setBusy("קורא את הכרטיס…");
    try {
      const layout = await detectLayout(adapter);
      if (!layout) { A().toast("בתיקייה שנבחרה אין גיבוי של קיוליקס. בחרו את הכרטיס עצמו או את תיקיית ibphone.", "warning"); return false; }
      qx.adapter = adapter; qx.layout = layout; qx.open = null;
      await loadBackups(); render(); A().toast(`נמצאו ${qx.backups.length} גיבויים`); return true;
    } catch (error) { console.error(error); A().toast("לא הצלחנו לקרוא את התיקייה", "error"); return false; }
    finally { setBusy(""); }
  }
  async function detectCards(silent) {
    if (!window.electronAPI?.qualix) return;
    const cards = await window.electronAPI.qualix.listCards();
    if (!cards.length) { if (!silent) A().toast("לא זוהה כרטיס עם תיקיית ibphone. אפשר לבחור תיקייה ידנית.", "warning"); return; }
    await connect(electronAdapter(cards[0].root, cards[0].label));
  }
  async function chooseFolder() {
    if (window.electronAPI?.qualix) { const picked = await window.electronAPI.qualix.chooseFolder(); if (picked) await connect(electronAdapter(picked.root, picked.label)); return; }
    if (!window.showDirectoryPicker) return A().toast("הדפדפן הזה לא תומך בפתיחת תיקיות. השתמשו ב-Chrome או Edge, או בתוכנה למחשב.", "error");
    try { const handle = await window.showDirectoryPicker({ mode: "readwrite" }); await connect(fsaAdapter(handle, handle.name)); }
    catch (error) { if (error?.name !== "AbortError") { console.error(error); A().toast("לא הצלחנו לפתוח את התיקייה", "error"); } }
  }

  async function loadBackups() {
    const { ibphoneRel, mode } = qx.layout; const list = [];
    const folders = mode === "single" ? [""] : (await qx.adapter.list(ibphoneRel)).filter(e => e.kind === "directory" && isBackupName(e.name)).map(e => e.name).sort().reverse();
    for (const folder of folders) {
      const rel = join(ibphoneRel, folder); let head = null;
      try { head = Q.parseHead(await qx.adapter.read(join(rel, "ibphone_head.in"))); } catch (_) { }
      list.push({ folder: folder || "(התיקייה שנבחרה)", rel, head, categories: head ? head.categories : [] });
    }
    qx.backups = list;
  }
  function folderDate(folder) { const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(folder); return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : folder; }

  /* ---------- מעבר בין גרסאות: שינויים שלא נשמרו ---------- */
  async function confirmLeave() {
    if (!qx.open?.dirty.size) return true;
    const label = qx.open.isNew ? "הגרסה החדשה" : "הגרסה " + folderDate(qx.open.folder);
    const choice = await A().modal({ kicker: "שינויים שלא נשמרו", title: `לשמור את ${label}?`, html: `<p>ב${label} יש שינויים שעדיין לא נכתבו לכרטיס.</p>`, buttons: [{ id: "save", label: "שמירה כגרסה חדשה", primary: true }, { id: "discard", label: "המשך בלי לשמור" }, { id: "cancel", label: "ביטול" }], dismissible: false });
    if (choice === "save") return saveAsNew(true);
    return choice === "discard";
  }

  /* ---------- פתיחת גרסה ---------- */
  async function openBackup(folder) {
    const bk = qx.backups.find(b => b.folder === folder); if (!bk) return;
    if (qx.open?.folder === folder && !qx.open.isNew) { qx.view = "editor"; return render(); }
    if (!(await confirmLeave())) return;
    setBusy("קורא את הגיבוי…");
    try {
      const names = (await qx.adapter.list(bk.rel)).filter(e => e.kind === "file").map(e => e.name);
      const data = await Q.readBackup({ folder: bk.folder, listFiles: async () => names, readFile: n => qx.adapter.read(join(bk.rel, n)) });
      data.contacts = data.contacts || []; data.events = data.events || []; data.memos = data.memos || []; data.playlists = data.playlists || [];
      data.callog = data.callog || { entries: [] }; data.dictionaryWords = (data.dictionary?.words || []).filter((w, i, arr) => arr.indexOf(w) === i); data.dictAdd = []; data.dictRemove = [];
      await attachRingtones(data);
      qx.open = { folder: bk.folder, rel: bk.rel, data, dirty: new Set(), isNew: false };
      qx.view = "editor"; qx.tab = "contacts"; qx.memoIdx = 0; qx.plIdx = 0; qx.search = ""; render();
    } catch (error) { console.error(error); A().toast("הגיבוי לא נקרא: " + (error.message || error), "error"); }
    finally { setBusy(""); }
  }
  async function attachRingtones(data) {
    if (!qx.layout.pbRel) return;
    try {
      const files = (await qx.adapter.list(qx.layout.pbRel)).filter(e => e.kind === "file" && /_Ring\.ini$/i.test(e.name));
      const byId = new Map(); for (const f of files) { const id = Q.ringIdFromFileName(f.name); if (id) byId.set(id, f.name); }
      for (const c of data.contacts) { const name = byId.get(c.id); if (!name) continue; try { const ini = Q.parseRingIni(await qx.adapter.read(join(qx.layout.pbRel, name))); if (ini) { c.ringtonePath = ini.path; c.ringtoneSize = ini.fileSize; } } catch (_) { } }
    } catch (_) { }
  }
  const dirty = key => { if (qx.open) qx.open.dirty.add(key); };
  const contactName = number => { const digits = String(number || "").replace(/\D/g, "").slice(-9); if (!digits) return ""; const c = (qx.open?.data.contacts || []).find(c => Q.SLOT_FIELDS.some(f => String(c[f] || "").replace(/\D/g, "").endsWith(digits))); return c ? c.name : ""; };

  /* ---------- שמירה כגרסה חדשה ---------- */
  async function saveAsNew(skipConfirm = false) {
    if (!qx.open) return false;
    if (!qx.layout.canSave) { A().toast("כדי לשמור בחרו את הכרטיס עצמו או את תיקיית ibphone", "warning"); return false; }
    const d = qx.open.data;
    if (!skipConfirm) {
      const choice = await A().modal({ kicker: "שמירה", title: "לשמור כגרסה חדשה?", html: `<p>הגיבוי המקורי לא ישתנה. תיווצר תיקייה חדשה עם השעה הנוכחית, ובטלפון תוכלו לבחור אותה בשחזור.</p><p class="qx-note">הקטגוריות שייכתבו: ${Object.keys(CAT_HE).filter(k => hasCategory(d, k)).map(k => CAT_HE[k]).join(", ")}</p>${d.dictAdd.length || d.dictRemove.length ? `<div class="qx-warn">שינוי במילון חיזוי הטקסט נכתב בפורמט שפוענח חלקית. אחרי השחזור בדקו בטלפון שהמילון שלם.</div>` : ""}`, buttons: [{ id: "save", label: "שמירה", primary: true }, { id: "cancel", label: "ביטול" }] });
      if (choice !== "save") return false;
    }
    setBusy("כותב את הגיבוי…");
    try {
      let folder = Q.backupFolderName(new Date()); while (await qx.adapter.exists(join(qx.layout.ibphoneRel, folder))) folder = Q.backupFolderName(new Date(Date.now() + 1000));
      const udb = d.udb ? { phoneCache: d.udb.phoneCache, cardCache: (d.dictAdd.length || d.dictRemove.length) ? Q.updateUdbWords(d.udb.cardCache, { add: d.dictAdd, remove: d.dictRemove }) : d.udb.cardCache } : null;
      const files = Q.assembleBackup({ folder, cardLetter: "E", contacts: hasCategory(d, "phonebook") ? d.contacts : null, recordSize: d.recordSize || 1200, callog: hasCategory(d, "callog") ? d.callog : null, events: hasCategory(d, "schedule") ? d.events : null, memos: hasCategory(d, "memo") ? d.memos : null, playlists: hasCategory(d, "playlist") ? d.playlists : null, settings: d.settings || null, udb });
      const rel = join(qx.layout.ibphoneRel, folder); await qx.adapter.mkdir(rel);
      for (const f of files) await qx.adapter.write(join(rel, f.name), f.bytes);
      // צלצולים אישיים יושבים מחוץ לגיבוי, בתיקיית PB של הכרטיס
      let rings = 0;
      if (qx.layout.pbRel && hasCategory(d, "phonebook")) for (const c of d.contacts) {
        if (c.ringtone !== Q.RINGTONE_FILE || !c.ringtonePath || !c._ringDirty) continue;
        let size = c.ringtoneSize || 0; if (!size) { try { const rp = c.ringtonePath.replace(/^[A-Za-z]:\\/, "").replace(/\\/g, "/"); size = (await qx.adapter.read(rp)).length; } catch (_) { } }
        await qx.adapter.write(join(qx.layout.pbRel, Q.ringFileName(c.id)), Q.buildRingIni(c.ringtonePath, size)); rings++;
      }
      await loadBackups(); qx.open.dirty.clear(); qx.open.folder = folder; qx.open.rel = rel; qx.open.isNew = false; d.contacts.forEach(c => { c._ringDirty = false; });
      render();
      await A().modal({ kicker: "נשמר", title: `הגרסה ${folderDate(folder)} מוכנה`, html: `<p>בטלפון: <b>תפריט ← גיבוי ושחזור ← שחזור</b>, בחרו את הגיבוי לפי השעה <b dir="ltr">${esc(folder)}</b>, וסמנו אילו קטגוריות לשחזר.</p>${rings ? `<p>נכתבו ${rings} קובצי צלצול אישי לתיקיית PB.</p>` : ""}<p class="qx-note">ההגדרות הועתקו כמו שהן. אם זו הפעם הראשונה, מומלץ לשחזר קודם קטגוריה אחת ולבדוק.</p>`, buttons: [{ id: "ok", label: "סגירה", primary: true }] });
      return true;
    } catch (error) { console.error(error); A().toast("הכתיבה נכשלה: " + (error.message || error), "error"); return false; }
    finally { setBusy(""); }
  }
  function hasCategory(d, key) { return { phonebook: !!d.contacts, callog: !!d.callog?.entries, schedule: !!d.events, settings: !!d.settings, memo: !!d.memos, udb: !!d.udb, playlist: !!d.playlists }[key]; }

  /* ---------- גרסה חדשה / שכפול / מחיקה / השוואה ---------- */
  async function newVersion(baseFolder) {
    const lists = A().getLists();
    const versions = qx.backups.map(b => `<option value="${esc(b.folder)}" ${b.folder === baseFolder ? "selected" : ""}>${esc(folderDate(b.folder))}</option>`).join("");
    const html = `<p>הגרסה החדשה נבנית מגרסה קיימת, ואנשי הקשר יכולים להגיע ממקום אחר.</p>
      <label class="modal-field">בסיס לכל הקטגוריות<select id="qx-nv-base"><option value="">ריק (רק מה שאוסיף עכשיו)</option>${versions}</select></label>
      <label class="modal-field">אנשי קשר<select id="qx-nv-contacts"><option value="base">מהגרסה שנבחרה</option><option value="list">מרשימה באנק״ל</option><option value="file">מקובץ VCF / Excel / CSV</option><option value="empty">ריק</option></select></label>
      <label class="modal-field">רשימה<select id="qx-nv-list">${lists.map(l => `<option value="${esc(l.id)}">${esc(l.name)} (${l.contacts.length})</option>`).join("") || "<option value=''>אין רשימות</option>"}</select></label>`;
    if (!(await confirmLeave())) return;
    const choice = await A().modal({ kicker: "גרסה חדשה", title: "ממה לבנות אותה?", html, buttons: [{ id: "go", label: "המשך", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "go") return;
    const base = document.getElementById("qx-nv-base").value, src = document.getElementById("qx-nv-contacts").value, listId = document.getElementById("qx-nv-list").value;
    setBusy("בונה גרסה…");
    try {
      let data = { contacts: [], events: [], memos: [], playlists: [], callog: { entries: [] }, settings: null, udb: null, recordSize: 1200, dictionaryWords: [], dictAdd: [], dictRemove: [], groups: [] };
      if (base) { const bk = qx.backups.find(b => b.folder === base); const names = (await qx.adapter.list(bk.rel)).filter(e => e.kind === "file").map(e => e.name); const read = await Q.readBackup({ folder: bk.folder, listFiles: async () => names, readFile: n => qx.adapter.read(join(bk.rel, n)) }); Object.assign(data, read, { callog: read.callog || { entries: [] }, contacts: read.contacts || [], events: read.events || [], memos: read.memos || [], playlists: read.playlists || [], dictionaryWords: (read.dictionary?.words || []).filter((w, i, a) => a.indexOf(w) === i), dictAdd: [], dictRemove: [] }); await attachRingtones(data); }
      if (src === "empty") data.contacts = [];
      if (src === "list") { const list = lists.find(l => l.id === listId); if (!list) throw new Error("לא נבחרה רשימה"); data.contacts = list.contacts.map(fromAppContact); }
      if (src === "file") { setBusy(""); const picked = await pickFile(); if (!picked) return; setBusy("קורא קובץ…"); const contacts = await A().importFileToContacts(picked); if (!contacts) return; data.contacts = contacts.map(fromAppContact); }
      qx.open = { folder: null, rel: null, data, dirty: new Set(["phonebook"]), isNew: true }; qx.view = "editor"; qx.tab = "contacts"; qx.search = ""; render();
      A().toast("הגרסה החדשה פתוחה לעריכה. בסיום לחצו “שמירה כגרסה חדשה”.");
    } catch (error) { console.error(error); A().toast("לא הצלחנו לבנות את הגרסה: " + (error.message || error), "error"); }
    finally { setBusy(""); }
  }
  function pickFile() { return new Promise(resolve => { const input = document.createElement("input"); input.type = "file"; input.accept = ".vcf,.xlsx,.xls,.csv"; input.onchange = () => resolve(input.files[0] || null); input.oncancel = () => resolve(null); input.click(); }); }
  function fromAppContact(c) { const out = { id: 0, name: c.name || "", mobile: c.mobile || "", home: c.home || "", work: c.work || "", fax: c.fax || "", email: c.email || "", note: c.note || "", group: c.group || "", groupBit: 0, ringtone: c.ringtone ? Q.RINGTONE_FILE : 0, ringtonePath: c.ringtone || "", _dirty: true, _ringDirty: !!c.ringtone }; return out; }
  function toAppContact(c) { return { name: c.name, mobile: c.mobile, home: c.home, work: c.work, fax: c.fax, email: c.email, note: c.note, group: c.group || "", ringtone: c.ringtone === Q.RINGTONE_FILE ? (c.ringtonePath || "") : "" }; }
  async function versionMenu(folder) {
    const bk = qx.backups.find(b => b.folder === folder); if (!bk) return;
    const isCur = qx.open && !qx.open.isNew && qx.open.folder === folder;
    const choice = await A().modal({ kicker: "אפשרויות גרסה", title: folderDate(folder), html: `<p dir="ltr" style="text-align:right">${esc(folder)}</p><p class="qx-note">${bk.categories.map(k => CAT_HE[k]).join(" · ")}</p>`, buttons: [{ id: "open", label: isCur ? "המשך עריכה" : "פתיחה", primary: true }, { id: "new", label: "גרסה חדשה מכאן" }, { id: "compare", label: "השוואה לגרסה אחרת" }, ...(qx.layout.mode !== "single" ? [{ id: "delete", label: "מחיקה מהכרטיס" }] : []), { id: "cancel", label: "סגירה" }] });
    if (choice === "open") return openBackup(folder);
    if (choice === "new") return newVersion(folder);
    if (choice === "compare") return compareVersions(folder);
    if (choice === "delete") return deleteVersion(folder);
  }
  async function deleteVersion(folder) {
    const bk = qx.backups.find(b => b.folder === folder); if (!bk || qx.layout.mode === "single") return;
    if (!(await A().confirmBox("מחיקת גיבוי", `למחוק לצמיתות את הגיבוי ${folderDate(folder)} מהכרטיס? אי אפשר לשחזר מחיקה.`, "מחיקה"))) return;
    setBusy("מוחק…"); try { await qx.adapter.remove(bk.rel); if (qx.open?.folder === folder) qx.open = null; await loadBackups(); render(); A().toast("הגיבוי נמחק"); } catch (error) { A().toast("המחיקה נכשלה: " + (error.message || error), "error"); } finally { setBusy(""); }
  }
  async function compareVersions(folder) {
    const others = qx.backups.filter(b => b.folder !== folder); if (!others.length) return A().toast("אין גרסה נוספת להשוואה", "warning");
    const choice = await A().modal({ kicker: "השוואה", title: `${folderDate(folder)} מול…`, html: `<label class="modal-field">גרסה להשוואה<select id="qx-cmp">${others.map(b => `<option value="${esc(b.folder)}">${esc(folderDate(b.folder))}</option>`).join("")}</select></label>`, buttons: [{ id: "go", label: "השווה", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "go") return; const other = document.getElementById("qx-cmp").value;
    setBusy("משווה…");
    try {
      const load = async f => { const bk = qx.backups.find(b => b.folder === f); const names = (await qx.adapter.list(bk.rel)).filter(e => e.kind === "file").map(e => e.name); return Q.readBackup({ folder: f, listFiles: async () => names, readFile: n => qx.adapter.read(join(bk.rel, n)) }); };
      const a = await load(folder), b = await load(other);
      const key = c => [c.name, c.mobile, c.home, c.work, c.fax, c.email, c.note, c.group].join("|");
      const setA = new Map((a.contacts || []).map(c => [key(c), c])), setB = new Map((b.contacts || []).map(c => [key(c), c]));
      const onlyA = [...setA.keys()].filter(k => !setB.has(k)).map(k => setA.get(k)), onlyB = [...setB.keys()].filter(k => !setA.has(k)).map(k => setB.get(k));
      const row = (label, x, y) => `<tr><th>${label}</th><td>${x}</td><td>${y}</td></tr>`;
      const html = `<div class="modal-list"><table class="data-table"><thead><tr><th></th><th>${esc(folderDate(folder))}</th><th>${esc(folderDate(other))}</th></tr></thead><tbody>${row("אנשי קשר", (a.contacts || []).length, (b.contacts || []).length)}${row("שיחות", (a.callog?.entries || []).reduce((n, e) => n + e.calls.length, 0), (b.callog?.entries || []).reduce((n, e) => n + e.calls.length, 0))}${row("אירועים", (a.events || []).length, (b.events || []).length)}${row("פתקים", (a.memos || []).length, (b.memos || []).length)}${row("רשימות השמעה", (a.playlists || []).length, (b.playlists || []).length)}</tbody></table></div>
        <h3 style="margin:14px 0 6px">אנשי קשר שונים</h3><p class="qx-note">רק ב-${esc(folderDate(folder))}: ${onlyA.length} · רק ב-${esc(folderDate(other))}: ${onlyB.length}</p>
        <div class="modal-list">${[...onlyA.slice(0, 60).map(c => `<div class="modal-list-row"><span>רק בראשון</span><b>${esc(c.name)} ${esc(c.mobile || c.home || "")}</b></div>`), ...onlyB.slice(0, 60).map(c => `<div class="modal-list-row"><span>רק בשני</span><b>${esc(c.name)} ${esc(c.mobile || c.home || "")}</b></div>`)].join("") || "<div class='modal-list-row'><span>זהים</span><b>אין הבדלים באנשי הקשר</b></div>"}</div>`;
      await A().modal({ kicker: "השוואה", title: "מה השתנה בין הגרסאות", html, buttons: [{ id: "ok", label: "סגירה", primary: true }] });
    } catch (error) { A().toast("ההשוואה נכשלה: " + (error.message || error), "error"); } finally { setBusy(""); }
  }

  /* ---------- אנשי קשר ---------- */
  async function editContact(idx) {
    const d = qx.open.data; const c = idx >= 0 ? d.contacts[idx] : { id: 0, name: "", mobile: "", home: "", work: "", fax: "", email: "", note: "", group: "", groupBit: 0, ringtone: 0, ringtonePath: "" };
    const groups = [...new Set([...(d.groups || []), ...d.contacts.map(x => x.group).filter(Boolean)])];
    const field = (key, label, extra = "") => `<label class="modal-field">${label}<input id="qx-c-${key}" value="${esc(c[key] || "")}" ${extra}></label>`;
    const html = `<div class="qx-form">${field("name", "שם", 'class="full" maxlength="80"')}${field("mobile", "נייד", 'dir="ltr"')}${field("home", "בית", 'dir="ltr"')}${field("work", "עבודה", 'dir="ltr"')}${field("fax", "פקס", 'dir="ltr"')}${field("email", "מייל / כתובת", 'class="full" maxlength="40"')}
      <label class="modal-field full">הערה<textarea id="qx-c-note" rows="3" maxlength="163">${esc(c.note || "")}</textarea></label>
      <label class="modal-field">קבוצת מתקשרים<input id="qx-c-group" list="qx-groups" value="${esc(c.group || "")}" placeholder="ריק = בלי קבוצה"><datalist id="qx-groups">${groups.map(g => `<option value="${esc(g)}">`).join("")}</datalist></label>
      <label class="modal-field">צלצול אישי<select id="qx-c-ring"><option value="0" ${!c.ringtone ? "selected" : ""}>ברירת המחדל של הטלפון</option><option value="${Q.RINGTONE_FILE}" ${c.ringtone === Q.RINGTONE_FILE ? "selected" : ""}>קובץ מהכרטיס</option>${c.ringtone && c.ringtone !== Q.RINGTONE_FILE ? `<option value="${c.ringtone}" selected>צלצול מובנה (${c.ringtone})</option>` : ""}</select></label>
      <label class="modal-field full">קובץ הצלצול<div class="qx-row"><input id="qx-c-ringpath" value="${esc(c.ringtonePath || "")}" dir="ltr" placeholder="E:\\שיר.mp3" style="flex:1"><button type="button" class="btn btn-quiet btn-sm" data-qx="pick-ring">בחירה מהכרטיס</button></div></label></div>
      <p class="qx-note">הקבוצה חייבת להיות אחת מעד שמונה; קבוצה חדשה נכתבת לגיבוי ונבדקת בשחזור. צלצול אישי דורש שהכרטיס עצמו יהיה מחובר, כי הקובץ נשמר בתיקיית PB.</p>`;
    const choice = await A().modal({ kicker: idx >= 0 ? "עריכת איש קשר" : "איש קשר חדש", title: c.name || "איש קשר", html, buttons: [{ id: "save", label: "שמירה", primary: true }, ...(idx >= 0 ? [{ id: "delete", label: "מחיקה" }] : []), { id: "cancel", label: "ביטול" }], enterConfirms: false });
    if (choice === "delete") { if (await A().confirmBox("מחיקה", `למחוק את ${c.name}?`, "מחיקה")) { d.contacts.splice(idx, 1); dirty("phonebook"); render(); } return; }
    if (choice !== "save") return;
    const v = k => (document.getElementById("qx-c-" + k)?.value || "").trim();
    if (!v("name")) return A().toast("יש להכניס שם", "warning");
    const ring = Number(document.getElementById("qx-c-ring").value) || 0, ringPath = v("ringpath");
    const next = { name: v("name"), mobile: v("mobile"), home: v("home"), work: v("work"), fax: v("fax"), email: v("email"), note: v("note"), group: v("group"), ringtone: ring === Q.RINGTONE_FILE && !ringPath ? 0 : ring, ringtonePath: ring === Q.RINGTONE_FILE ? ringPath : "" };
    if (idx >= 0) { const changedRing = next.ringtone !== c.ringtone || next.ringtonePath !== (c.ringtonePath || ""); Object.assign(c, next, { _dirty: true, _ringDirty: c._ringDirty || changedRing }); }
    else d.contacts.push(Object.assign(next, { id: 0, groupBit: 0, _dirty: true, _ringDirty: next.ringtone === Q.RINGTONE_FILE }));
    dirty("phonebook"); render();
  }
  async function pickAudio(targetInputId) {
    if (qx.layout.mode !== "card") return A().toast("בחירת שיר מהכרטיס אפשרית רק כשנבחר הכרטיס עצמו", "warning");
    setBusy("סורק שירים בכרטיס…");
    const found = [];
    try {
      const walk = async (rel, depth) => { if (found.length > 3000 || depth > 3) return; let entries = []; try { entries = await qx.adapter.list(rel); } catch (_) { return; } for (const e of entries) { if (e.kind === "file" && AUDIO.test(e.name)) found.push({ rel: join(rel, e.name), size: e.size || 0 }); } for (const e of entries) if (e.kind === "directory" && !/^(ibphone|PB|System|@cstardata|\$RECYCLE\.BIN|System Volume Information|FOUND\.\d+)$/i.test(e.name)) await walk(join(rel, e.name), depth + 1); };
      await walk("", 0);
    } finally { setBusy(""); }
    if (!found.length) return A().toast("לא נמצאו קובצי שמע בכרטיס", "warning");
    const toPath = rel => "E:\\" + rel.replace(/\//g, "\\");
    const html = `<label class="search-field"><span>⌕</span><input id="qx-audio-q" type="search" placeholder="חיפוש שיר…"></label><div class="qx-picker" id="qx-audio-list">${found.map((f, i) => `<button type="button" data-qx-audio="${i}">${esc(toPath(f.rel))}</button>`).join("")}</div><p class="qx-note">${found.length} קבצים</p>`;
    const promise = A().modal({ kicker: "שיר מהכרטיס", title: "בחרו קובץ", html, buttons: [{ id: "cancel", label: "ביטול" }] });
    const list = document.getElementById("qx-audio-list");
    document.getElementById("qx-audio-q").addEventListener("input", e => { const q = e.target.value.toLowerCase(); list.querySelectorAll("button").forEach(b => b.classList.toggle("hidden", !b.textContent.toLowerCase().includes(q))); });
    list.addEventListener("click", e => { const b = e.target.closest("[data-qx-audio]"); if (!b) return; const f = found[Number(b.dataset.qxAudio)]; const input = document.getElementById(targetInputId); if (input) { input.value = toPath(f.rel); input.dataset.size = f.size || ""; } document.querySelector("[data-modal-choice='cancel']")?.click(); });
    await promise;
  }
  async function contactsToList() {
    const d = qx.open.data; if (!d.contacts.length) return A().toast("אין אנשי קשר", "warning");
    const choice = await A().modal({ kicker: "העברה לניהול אנשי קשר", title: "שם הרשימה החדשה", html: `<label class="modal-field">שם<input id="qx-list-name" value="${esc("קיוליקס " + (qx.open.folder ? folderDate(qx.open.folder) : "חדש"))}" maxlength="80"></label><p class="qx-note">הקבוצה והצלצול נשמרים ברשימה, ואפשר יהיה להחזיר אותם לגיבוי.</p>`, buttons: [{ id: "go", label: "יצירת רשימה", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "go") return;
    const list = A().createListWithContacts(document.getElementById("qx-list-name").value.trim() || "קיוליקס", d.contacts.map(toAppContact));
    A().toast(`נוצרה הרשימה “${list.name}” עם ${list.contacts.length} אנשי קשר`); A().openList(list.id);
  }
  async function contactsFromList() {
    const lists = A().getLists(); if (!lists.length) return A().toast("אין רשימות באנק״ל", "warning");
    const choice = await A().modal({ kicker: "אנשי קשר מרשימה", title: "מאיזו רשימה?", html: `<label class="modal-field">רשימה<select id="qx-from-list">${lists.map(l => `<option value="${esc(l.id)}">${esc(l.name)} (${l.contacts.length})</option>`).join("")}</select></label><label class="modal-field">איך<select id="qx-from-mode"><option value="replace">להחליף את כל אנשי הקשר בגיבוי</option><option value="add">להוסיף לאנשי הקשר הקיימים</option></select></label>`, buttons: [{ id: "go", label: "המשך", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "go") return;
    const list = lists.find(l => l.id === document.getElementById("qx-from-list").value), mode = document.getElementById("qx-from-mode").value; if (!list) return;
    const incoming = list.contacts.map(fromAppContact); const d = qx.open.data;
    if (mode === "replace") d.contacts = incoming; else d.contacts.push(...incoming);
    dirty("phonebook"); render(); A().toast(`${incoming.length} אנשי קשר נכנסו לגיבוי`);
  }
  async function contactsFromFile() {
    const file = await pickFile(); if (!file) return;
    const contacts = await A().importFileToContacts(file); if (!contacts || !contacts.length) return A().toast("לא נמצאו אנשי קשר בקובץ", "warning");
    const mode = await A().modal({ kicker: "ייבוא מקובץ", title: `${contacts.length} אנשי קשר נקראו`, html: "<p>איך להכניס אותם לגיבוי?</p>", buttons: [{ id: "add", label: "הוסף לקיימים", primary: true }, { id: "replace", label: "החלף הכל" }, { id: "cancel", label: "ביטול" }] });
    if (mode === "cancel") return; const d = qx.open.data; const incoming = contacts.map(fromAppContact);
    if (mode === "replace") d.contacts = incoming; else d.contacts.push(...incoming);
    dirty("phonebook"); render();
  }

  /* ---------- יומן שיחות ---------- */
  function flatCalls() { const rows = []; (qx.open.data.callog.entries || []).forEach((e, ei) => e.calls.forEach((call, ci) => rows.push({ ei, ci, e, call }))); return rows.sort((a, b) => b.call.time - a.call.time); }
  async function addCall() {
    const d = qx.open.data; const names = d.contacts.slice(0, 2000);
    const nowIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const html = `<div class="qx-form"><label class="modal-field full">מספר<input id="qx-call-num" list="qx-call-nums" dir="ltr" placeholder="0501234567"><datalist id="qx-call-nums">${names.flatMap(c => Q.SLOT_FIELDS.filter(f => c[f]).map(f => `<option value="${esc(c[f])}">${esc(c.name)}</option>`)).join("")}</datalist></label>
      <label class="modal-field">סוג<select id="qx-call-type">${Object.entries(Q.CALL_TYPE_HE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label class="modal-field">זמן<input id="qx-call-time" type="datetime-local" value="${nowIso}" step="1"></label>
      <label class="modal-field">משך בשניות<input id="qx-call-dur" type="number" min="0" value="60"></label></div><p class="qx-note">שיחה שלא נענתה או נדחתה נרשמת עם משך 0. בכל מספר נשמרות עד עשר השיחות האחרונות מאותו סוג.</p>`;
    const choice = await A().modal({ kicker: "שיחה חדשה", title: "הוספת שיחה ליומן", html, buttons: [{ id: "add", label: "הוספה", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "add") return;
    const number = document.getElementById("qx-call-num").value.trim(), type = document.getElementById("qx-call-type").value, time = Q.isoToPhoneTime(document.getElementById("qx-call-time").value), duration = Math.max(0, Number(document.getElementById("qx-call-dur").value) || 0);
    if (!number) return A().toast("יש להכניס מספר", "warning");
    const dur = ["missed", "rejected"].includes(type) ? 0 : duration;
    let entry = d.callog.entries.find(e => e.number === number && e.type === type);
    if (!entry) { entry = { number, type, typeCode: Number(Object.keys(Q.CALL_TYPES).find(k => Q.CALL_TYPES[k] === type)), calls: [], extra: 0 }; d.callog.entries.push(entry); }
    entry.calls.push({ time, duration: dur }); entry.calls.sort((a, b) => a.time - b.time); if (entry.calls.length > 10) entry.calls = entry.calls.slice(-10); entry._dirty = true;
    dirty("callog"); render();
  }
  function deleteCall(ei, ci) { const d = qx.open.data; const e = d.callog.entries[ei]; if (!e) return; e.calls.splice(ci, 1); e._dirty = true; if (!e.calls.length) d.callog.entries.splice(ei, 1); dirty("callog"); render(); }

  /* ---------- פתקים ---------- */
  function wrapForPhone(text) {
    const table = widths(), lines = [];
    for (const raw of String(text || "").split("\n")) {
      const para = raw.replace(/\s+$/, ""); // רווחים בסוף שורה לא תופסים מקום על המסך, והטלפון לא שובר בגללם
      let line = "", w = 0, lastSpace = -1;
      for (const ch of para) { const cw = Q.textWidth(ch, table); if (w + cw > Q.LINE_UNITS && line) { if (lastSpace > 0) { lines.push({ t: line.slice(0, lastSpace), wrap: true }); line = line.slice(lastSpace + 1); w = Q.textWidth(line, table); lastSpace = -1; } else { lines.push({ t: line, wrap: true }); line = ""; w = 0; } } line += ch; w += cw; if (ch === " ") lastSpace = line.length - 1; }
      lines.push({ t: line, wrap: false });
    }
    return lines;
  }
  function memoCounter() { const m = qx.open?.data.memos[qx.memoIdx]; const el = document.getElementById("qx-memo-counter"); if (!m || !el) return; const len = m.text.length; el.textContent = `${len} / ${qx.memoLimit} תווים`; el.classList.toggle("over", len > qx.memoLimit); const prev = document.getElementById("qx-memo-preview"); if (prev) prev.innerHTML = wrapForPhone(m.text).map(l => `<div class="${l.wrap ? "qx-wrap" : ""}">${esc(l.t) || "&nbsp;"}</div>`).join(""); }
  function newMemo() { const d = qx.open.data; d.memos.unshift({ fileName: Q.memoFileName(new Date()), text: "", created: new Date().toISOString().slice(0, 19), _dirty: true }); qx.memoIdx = 0; dirty("memo"); render(); setTimeout(() => document.getElementById("qx-memo-text")?.focus(), 50); }
  async function deleteMemo() { const d = qx.open.data; const m = d.memos[qx.memoIdx]; if (!m) return; if (!(await A().confirmBox("מחיקת פתק", "למחוק את הפתק?", "מחיקה"))) return; d.memos.splice(qx.memoIdx, 1); qx.memoIdx = Math.max(0, qx.memoIdx - 1); dirty("memo"); render(); }
  function centerMemo(all) { const m = qx.open?.data.memos[qx.memoIdx]; const ta = document.getElementById("qx-memo-text"); if (!m || !ta) return; if (all) m.text = Q.centerText(m.text, widths()); else { const pos = ta.selectionStart; const before = m.text.lastIndexOf("\n", pos - 1) + 1; let after = m.text.indexOf("\n", pos); if (after < 0) after = m.text.length; m.text = m.text.slice(0, before) + Q.centerLine(m.text.slice(before, after), widths()) + m.text.slice(after); } m._dirty = true; dirty("memo"); ta.value = m.text; memoCounter(); }
  async function calibrate() {
    const choice = await A().modal({ kicker: "כיול רוחב", title: "פתק כיול מהטלפון", html: `<p>בטלפון כתבו פתק שבו כל שורה היא אות אחת שחוזרת עד שהשורה מתמלאה (למשל שורה של ש, שורה של ו). הדביקו כאן את הפתק, או בחרו אותו מהרשימה.</p><label class="modal-field">תוכן פתק הכיול<textarea id="qx-cal" rows="6"></textarea></label><label class="modal-field">או פתק קיים<select id="qx-cal-pick"><option value="">—</option>${(qx.open?.data.memos || []).map((m, i) => `<option value="${i}">${esc(m.text.slice(0, 40))}</option>`).join("")}</select></label>`, buttons: [{ id: "go", label: "כיול", primary: true }, { id: "reset", label: "חזרה לברירת המחדל" }, { id: "cancel", label: "ביטול" }] });
    if (choice === "reset") { qx.widths = null; localStorage.removeItem(WIDTH_KEY); return A().toast("טבלת הרוחב חזרה לברירת המחדל"); }
    if (choice !== "go") return;
    const pick = document.getElementById("qx-cal-pick").value; const text = pick !== "" ? qx.open.data.memos[Number(pick)].text : document.getElementById("qx-cal").value;
    qx.widths = Q.calibrateFromMemo(text, widths()); localStorage.setItem(WIDTH_KEY, JSON.stringify(qx.widths)); memoCounter(); A().toast("טבלת הרוחב עודכנה");
  }

  /* ---------- לוח שנה ----------
     אירוע חוזר נכתב לטלפון כסדרה של אירועים נפרדים (כך גם המשתמש עצמו רשם סדרות בטלפון),
     ולכן אינו תלוי בשדה החזרה הפנימי של הטלפון, שמשמעותו עדיין לא אומתה. */
  const localIso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const REPEATS = [["none", "בלי חזרה"], ["daily", "כל יום"], ["weekly", "כל שבוע"], ["biweekly", "כל שבועיים"], ["monthly", "כל חודש"], ["yearly", "כל שנה"]];
  function occurrences(startIso, repeat, untilIso, cap = 400) {
    const out = []; const [y, m, d] = startIso.split("-").map(Number); const until = untilIso || startIso;
    for (let n = 0; n < cap; n++) {
      let dt; if (repeat === "daily") dt = new Date(y, m - 1, d + n); else if (repeat === "weekly") dt = new Date(y, m - 1, d + 7 * n); else if (repeat === "biweekly") dt = new Date(y, m - 1, d + 14 * n);
      else if (repeat === "monthly") { const last = new Date(y, m - 1 + n + 1, 0).getDate(); dt = new Date(y, m - 1 + n, Math.min(d, last)); } else if (repeat === "yearly") { const last = new Date(y + n, m, 0).getDate(); dt = new Date(y + n, m - 1, Math.min(d, last)); } else dt = new Date(y, m - 1, d);
      const iso = localIso(dt); if (iso > until) break; out.push(iso); if (repeat === "none") break;
    }
    return out;
  }
  async function editEvent(idx, presetDate) {
    const d = qx.open.data; const ev = idx >= 0 ? d.events[idx] : { title: "", date: presetDate || localIso(new Date()), time: "09:00", reminder: true };
    const inAYear = localIso(new Date(Date.now() + 365 * 86400000));
    const html = `<div class="qx-form"><label class="modal-field full">כותרת<input id="qx-ev-title" value="${esc(ev.title)}" maxlength="82"></label><label class="modal-field">תאריך<input id="qx-ev-date" type="date" value="${esc(ev.date)}"></label><label class="modal-field">שעה<input id="qx-ev-time" type="time" value="${esc(ev.time)}"></label><label class="check-line full"><input id="qx-ev-rem" type="checkbox" ${ev.reminder ? "checked" : ""}> תזכורת פעילה</label>
      ${idx < 0 ? `<label class="modal-field">חזרה<select id="qx-ev-repeat">${REPEATS.map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label><label class="modal-field">עד תאריך (לחזרה)<input id="qx-ev-until" type="date" value="${inAYear}"></label><p class="qx-note full">אירוע חוזר נרשם בטלפון כאירועים נפרדים, אחד לכל מועד, עד התאריך שבחרתם (לכל היותר 400).</p>` : `<p class="qx-note full">${ev.seriesId ? "האירוע הזה הוא חלק מסדרה חוזרת. אפשר למחוק את כל הסדרה." : ""}</p>`}</div>`;
    const buttons = [{ id: "save", label: "שמירה", primary: true }]; if (idx >= 0) { buttons.push({ id: "delete", label: "מחיקה" }); if (ev.seriesId) buttons.push({ id: "delete-series", label: "מחיקת כל הסדרה" }); } buttons.push({ id: "cancel", label: "ביטול" });
    const choice = await A().modal({ kicker: idx >= 0 ? "עריכת אירוע" : "אירוע חדש", title: ev.title || "אירוע", html, buttons });
    if (choice === "delete") { d.events.splice(idx, 1); dirty("schedule"); render(); return; }
    if (choice === "delete-series") { const n = d.events.filter(e => e.seriesId === ev.seriesId).length; if (await A().confirmBox("מחיקת סדרה", `למחוק ${n} אירועים של "${ev.title}"?`, "מחיקה")) { d.events = d.events.filter(e => e.seriesId !== ev.seriesId); dirty("schedule"); render(); } return; }
    if (choice !== "save") return;
    const title = document.getElementById("qx-ev-title").value.trim(), date = document.getElementById("qx-ev-date").value, time = document.getElementById("qx-ev-time").value || "00:00", reminder = document.getElementById("qx-ev-rem").checked;
    if (!title || !date) return A().toast("צריך כותרת ותאריך", "warning");
    if (idx >= 0) { Object.assign(ev, { title, date, time, reminder, _dirty: true }); }
    else {
      const repeat = document.getElementById("qx-ev-repeat")?.value || "none", until = document.getElementById("qx-ev-until")?.value || date;
      const dates = occurrences(date, repeat, until); if (!dates.length) return A().toast("תאריך הסיום קודם לתאריך ההתחלה", "warning");
      let nextId = d.events.reduce((m, e) => Math.max(m, e.reminderId || 0), 100); const seriesId = dates.length > 1 ? "s" + Date.now() : "";
      for (const iso of dates) d.events.push({ title, date: iso, time, reminder, reminderId: reminder ? ++nextId : 0, seriesId, _dirty: true });
      if (dates.length > 1) A().toast(`נוספו ${dates.length} אירועים`);
      qx.calMonth = date.slice(0, 7);
    }
    dirty("schedule"); render();
  }
  function shiftMonth(delta) { const [y, m] = (qx.calMonth || localIso(new Date()).slice(0, 7)).split("-").map(Number); const dt = new Date(y, m - 1 + delta, 1); qx.calMonth = localIso(dt).slice(0, 7); render(); }

  /* ---------- רשימות השמעה ---------- */
  async function newPlaylist() { const choice = await A().modal({ kicker: "רשימת השמעה", title: "שם הרשימה", html: `<label class="modal-field">שם<input id="qx-pl-name" maxlength="40" placeholder="לדוגמה: שבת"></label>`, buttons: [{ id: "go", label: "יצירה", primary: true }, { id: "cancel", label: "ביטול" }] }); if (choice !== "go") return; const name = document.getElementById("qx-pl-name").value.trim().replace(/[\\/:*?"<>|]/g, "-"); if (!name) return; const d = qx.open.data; d.playlists.push({ name: name + ".lst", entries: [], _dirty: true }); qx.plIdx = d.playlists.length - 1; dirty("playlist"); render(); }
  async function deletePlaylist() { const d = qx.open.data; const p = d.playlists[qx.plIdx]; if (!p) return; if (!(await A().confirmBox("מחיקת רשימה", `למחוק את ${p.name.replace(/\.lst$/i, "")}?`, "מחיקה"))) return; d.playlists.splice(qx.plIdx, 1); qx.plIdx = 0; dirty("playlist"); render(); }
  async function addSong() {
    const p = qx.open.data.playlists[qx.plIdx]; if (!p) return;
    const html = `<label class="modal-field">נתיב הקובץ בטלפון<div class="qx-row"><input id="qx-song-path" dir="ltr" placeholder="E:\\שיר.mp3" style="flex:1"><button type="button" class="btn btn-quiet btn-sm" data-qx="pick-song">בחירה מהכרטיס</button></div></label><p class="qx-note">E: הוא כרטיס הזיכרון, D: הזיכרון הפנימי של הטלפון.</p>`;
    const choice = await A().modal({ kicker: p.name.replace(/\.lst$/i, ""), title: "הוספת שיר", html, buttons: [{ id: "add", label: "הוספה", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "add") return; const input = document.getElementById("qx-song-path"); const path = input.value.trim(); if (!path) return;
    p.entries.push({ path, meta: 0, fileSize: Number(input.dataset.size) || 0 }); p._dirty = true; dirty("playlist"); render();
  }
  function moveSong(i, dir) { const p = qx.open.data.playlists[qx.plIdx]; const j = i + dir; if (!p || j < 0 || j >= p.entries.length) return; [p.entries[i], p.entries[j]] = [p.entries[j], p.entries[i]]; p._dirty = true; dirty("playlist"); render(); }
  function removeSong(i) { const p = qx.open.data.playlists[qx.plIdx]; if (!p) return; p.entries.splice(i, 1); p._dirty = true; dirty("playlist"); render(); }

  /* ---------- חיזוי טקסט ----------
     קובץ המילון הוא 4096 בתים ורובו כותרת, ולכן יש מקום לכמה עשרות מילים בלבד. */
  const wordCost = w => 16 + w.length * 2;
  function udbFreeBytes() { const d = qx.open.data; const cache = d.udb?.cardCache; let used = 0; if (cache && cache.length >= 0x828) used = new DataView(cache.buffer, cache.byteOffset, cache.byteLength).getUint32(0x824, true); const pendingAdd = d.dictAdd.reduce((n, w) => n + wordCost(w), 0), pendingRemove = d.dictRemove.reduce((n, w) => n + wordCost(w), 0); return 4096 - 4 - 0x838 - used - pendingAdd + pendingRemove; }
  function pushWord(w) { const d = qx.open.data; if (d.dictionaryWords.includes(w)) return false; if (udbFreeBytes() < wordCost(w)) return null; d.dictionaryWords.push(w); d.dictRemove = d.dictRemove.filter(x => x !== w); if (!d.dictAdd.includes(w)) d.dictAdd.push(w); return true; }
  function addWord() { const input = document.getElementById("qx-word"); const w = (input?.value || "").trim().slice(0, 60); if (!w) return; const r = pushWord(w); if (r === false) return A().toast("המילה כבר קיימת", "warning"); if (r === null) return A().toast("אין מקום במילון של הטלפון למילה נוספת", "warning"); dirty("udb"); render(); }
  function pickAnyFile(accept) { return new Promise(resolve => { const input = document.createElement("input"); input.type = "file"; input.accept = accept; input.onchange = () => resolve(input.files[0] || null); input.oncancel = () => resolve(null); input.click(); }); }
  async function importWords() {
    const file = await pickAnyFile(".xlsx,.xls,.csv,.txt"); if (!file) return;
    setBusy("קורא מילים…");
    try {
      let text = "";
      if (/\.(xlsx|xls)$/i.test(file.name)) { await A().ensureXlsx(); const wb = window.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", raw: false }); for (const name of wb.SheetNames) text += window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false }).flat().join("\n") + "\n"; }
      else { const buf = await file.arrayBuffer(); text = new TextDecoder("utf-8").decode(buf); if (/�/.test(text)) text = new TextDecoder("windows-1255").decode(buf); }
      const words = [...new Set(text.split(/[\s,;|"'()\[\]{}.!?:]+/).map(w => w.trim()).filter(w => w.length >= 2 && w.length <= 60 && /[א-תA-Za-z]/.test(w)))];
      const d = qx.open.data; const fresh = words.filter(w => !d.dictionaryWords.includes(w));
      setBusy("");
      if (!fresh.length) return A().toast(words.length ? "כל המילים בקובץ כבר במילון" : "לא נמצאו מילים בקובץ", "warning");
      const room = Math.floor(udbFreeBytes() / 26);
      const ok = await A().confirmBox("ייבוא מילים לחיזוי", `נמצאו ${fresh.length} מילים חדשות (${words.length} בקובץ). במילון של הטלפון יש מקום לעוד כ-${room} מילים. להוסיף עד שהמקום ייגמר?`, "הוספה");
      if (!ok) return;
      let added = 0; for (const w of fresh) { if (pushWord(w) === true) added++; else if (pushWord(w) === null) break; }
      dirty("udb"); render(); A().toast(added < fresh.length ? `נוספו ${added} מילים; המקום במילון נגמר` : `נוספו ${added} מילים`);
    } catch (error) { console.error(error); A().toast("לא הצלחנו לקרוא את הקובץ", "error"); } finally { setBusy(""); }
  }
  function removeWord(w) { const d = qx.open.data; d.dictionaryWords = d.dictionaryWords.filter(x => x !== w); if (d.dictAdd.includes(w)) d.dictAdd = d.dictAdd.filter(x => x !== w); else d.dictRemove.push(w); dirty("udb"); render(); }

  /* ---------- ציור ---------- */
  function setBusy(text) { qx.busy = text; const el = document.getElementById("qx-busy"); if (el) { el.textContent = text; el.classList.toggle("hidden", !text); } }
  function render() {
    const root = document.getElementById("qualix-root"); if (!root) return;
    const navCount = document.getElementById("nav-qualix-count"); if (navCount) navCount.textContent = qx.backups.length || "";
    const editing = qx.open && qx.view === "editor";
    root.innerHTML = sourceBar() + (editing ? openView() : (qx.adapter ? versionsView() : introView())) + `<div id="qx-busy" class="qx-warn ${qx.busy ? "" : "hidden"}" style="position:fixed;bottom:18px;right:50%;transform:translateX(50%);z-index:60">${esc(qx.busy)}</div>`;
    if (!editing && document.getElementById("app-shell")?.dataset.activePage === "qualix") { const kicker = document.getElementById("page-kicker"), title = document.getElementById("page-title"); if (kicker && title) { kicker.textContent = "הטלפון הכשר"; title.textContent = "גיבוי קיוליקס"; } }
    renderSubnav(); qx.rendered = true; memoCounter();
  }
  const DIRTY_KEY = { contacts: "phonebook", calls: "callog", memos: "memo", calendar: "schedule", playlists: "playlist", dictionary: "udb", settings: "settings" };
  function tabCounts(d) { return { contacts: d.contacts.length, calls: d.callog.entries.reduce((n, e) => n + e.calls.length, 0), memos: d.memos.length, calendar: d.events.length, playlists: d.playlists.length, dictionary: d.dictionaryWords.length, settings: d.settings ? 1 : 0 }; }
  /* הקטגוריות של הגרסה הפתוחה יושבות בתפריט הצד, מתחת לכותרת "גיבוי קיוליקס"; בלי גרסה פתוחה הן מוסתרות. */
  function renderSubnav() {
    const nav = document.getElementById("qualix-subnav"); if (!nav) return;
    const onPage = document.getElementById("app-shell")?.dataset.activePage === "qualix";
    if (!qx.open) { nav.classList.add("hidden"); nav.innerHTML = ""; return; }
    const counts = tabCounts(qx.open.data);
    const editing = onPage && qx.view === "editor";
    nav.innerHTML = TABS.map(([k, label, icon]) => `<button class="nav-sub-item ${editing && qx.tab === k ? "active" : ""} ${qx.open.dirty.has(DIRTY_KEY[k]) ? "dirty" : ""}" data-qx="tab" data-tab="${k}"><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span><span class="nav-count">${counts[k]}</span></button>`).join("");
    nav.classList.remove("hidden");
    if (editing) { const kicker = document.getElementById("page-kicker"), title = document.getElementById("page-title"); const tab = TABS.find(t => t[0] === qx.tab); if (kicker && title && tab) { kicker.textContent = "גיבוי קיוליקס · " + (qx.open.isNew ? "גרסה חדשה" : folderDate(qx.open.folder)); title.textContent = tab[1]; } }
  }
  function sourceBar() {
    const on = !!qx.adapter;
    return `<div class="qx-source ${on ? "on" : ""}"><i class="qx-dot"></i><div><strong>${on ? esc(qx.adapter.label) : "לא נבחר מקור"}</strong><br><span>${on ? ({ card: "כרטיס זיכרון מלא: גיבויים, צלצולים ושירים", ibphone: "תיקיית ibphone בלבד (בלי צלצולים אישיים)", single: "גיבוי בודד — קריאה בלבד" })[qx.layout.mode] : "חברו את הכרטיס או בחרו תיקייה"}</span></div><div class="spacer"></div>
      ${window.electronAPI?.qualix ? `<button class="btn btn-quiet btn-sm" data-qx="detect">זיהוי כרטיס</button>` : ""}<button class="btn btn-quiet btn-sm" data-qx="choose">בחירת תיקייה</button>${on ? `<button class="btn btn-quiet btn-sm" data-qx="refresh">רענון</button>` : ""}${qx.open ? `<button class="btn btn-secondary btn-sm" data-qx="back">← כל הגרסאות</button>` : ""}</div>`;
  }
  function introView() {
    return `<div class="qx-intro"><article class="qx-card"><div class="tool-icon">☏</div><h3>הטלפון הכשר, במחשב</h3><p>אנק״ל קורא את הגיבוי של קיוליקס מכרטיס הזיכרון: אנשי קשר עם קבוצות וצלצולים, יומן שיחות, פתקים, לוח שנה, רשימות השמעה וחיזוי טקסט. עורכים במחשב ושומרים גרסה חדשה שהטלפון משחזר.</p><ol class="qx-steps"><li>בטלפון: גיבוי ושחזור ← גיבוי (כל הקטגוריות).</li><li>הוציאו את הכרטיס וחברו למחשב.</li><li>${window.electronAPI?.qualix ? "לחצו “זיהוי כרטיס”." : "לחצו “בחירת תיקייה” ובחרו את הכרטיס."}</li></ol><div class="qx-row">${window.electronAPI?.qualix ? `<button class="btn btn-primary" data-qx="detect">זיהוי כרטיס</button>` : ""}<button class="btn ${window.electronAPI?.qualix ? "btn-quiet" : "btn-primary"}" data-qx="choose">בחירת תיקייה</button></div></article>
      <article class="qx-card"><div class="tool-icon">✓</div><h3>בטוח לגיבוי המקורי</h3><p>כל שמירה יוצרת תיקייה חדשה לפי השעה. הגיבוי שהטלפון עשה לא נדרס, ובטלפון בוחרים בדיוק אילו קטגוריות לשחזר.</p><p class="qx-note">בפעם הראשונה כדאי לשחזר קטגוריה אחת, לבדוק, ורק אז את השאר.</p></article></div>`;
  }
  function versionsView() {
    if (!qx.backups.length) return `<div class="empty-box"><div class="empty-icon">☏</div><h3>אין גיבויים בתיקייה</h3><p>עשו גיבוי בטלפון (גיבוי ושחזור ← גיבוי) ונסו שוב.</p><button class="btn btn-primary" data-qx="new-version">גרסה חדשה מרשימה או מקובץ</button></div>`;
    // כרטיס גרסה כמו כרטיס רשימה: לחיצה על הכרטיס פותחת, ⋮ לשאר הפעולות, ו-✓/✕ לכל קטגוריה
    const cur = qx.open && !qx.open.isNew ? qx.open.folder : null;
    const cats = has => `<ul class="qx-cats">${Object.keys(CAT_HE).map(k => `<li class="${has(k) ? "on" : "off"}"><i>${has(k) ? "✓" : "✕"}</i>${CAT_HE[k]}</li>`).join("")}</ul>`;
    const cards = qx.backups.map(b => { const isCur = cur === b.folder; return `<article class="qx-version ${isCur ? "current" : ""}"><button class="qx-open" data-qx="open" data-folder="${esc(b.folder)}" aria-label="פתיחת ${esc(folderDate(b.folder))}"></button><button class="icon-btn qx-menu" data-qx="version-menu" data-folder="${esc(b.folder)}" aria-label="אפשרויות">⋮</button><h3>${esc(folderDate(b.folder))}</h3><div class="qx-when" dir="ltr">${esc(b.folder)}</div>${isCur ? `<div class="qx-state">${qx.open.dirty.size ? "● פתוחה, עם שינויים שלא נשמרו" : "● פתוחה לעריכה"}</div>` : ""}${cats(k => b.categories.includes(k))}</article>`; }).join("");
    const unsavedNew = qx.open?.isNew ? `<article class="qx-version current"><button class="qx-open" data-qx="resume" aria-label="המשך עריכה"></button><h3>גרסה חדשה</h3><div class="qx-state">● ${qx.open.dirty.size ? "עדיין לא נשמרה" : "ריקה"}</div>${cats(k => hasCategory(qx.open.data, k))}</article>` : "";
    return `<div class="page-intro"><div><h2>הגרסאות בכרטיס</h2><p>כל גיבוי שהטלפון עשה, וכל גרסה ששמרתם מכאן. לחיצה על גרסה פותחת אותה, והקטגוריות שלה מופיעות בתפריט הצד.</p></div><div class="intro-actions"><button class="btn btn-primary" data-qx="new-version">＋ גרסה חדשה</button></div></div><div class="qx-versions">${unsavedNew}${cards}</div>`;
  }
  function openView() {
    const o = qx.open;
    const body = { contacts: contactsTab, calls: callsTab, memos: memosTab, calendar: calendarTab, playlists: playlistsTab, dictionary: dictionaryTab, settings: settingsTab }[qx.tab]();
    const tab = TABS.find(t => t[0] === qx.tab) || TABS[0];
    const head = `<div class="qx-head"><div><h2>${tab[2]} ${tab[1]}</h2><div class="qx-sub">${o.isNew ? "גרסה חדשה — עדיין לא נשמרה. בסיום העריכה לחצו שמירה." : `גרסה ${esc(folderDate(o.folder))} · ${esc(o.folder)}`}</div></div><div class="spacer"></div><span class="qx-note">הקטגוריות בתפריט הצד</span></div>`;
    const save = `<div class="qx-save"><button class="btn btn-primary" data-qx="save" ${qx.layout.canSave ? "" : "disabled"}>💾 שמירה כגרסה חדשה</button>${o.dirty.size ? `<span class="qx-dirty">יש שינויים שלא נשמרו</span>` : `<span class="qx-note">אין שינויים</span>`}${qx.layout.canSave ? "" : `<span class="qx-note">נבחר גיבוי בודד — כדי לשמור בחרו את הכרטיס או את תיקיית ibphone</span>`}</div>`;
    return head + body + save;
  }
  /* אנשי הקשר מוצגים באותם כרטיסים צבעוניים כמו במסך אנשי הקשר הרגיל — אותו גוון לכל שם, אותן שורות. */
  const FIELD_HE = { mobile: "נייד", home: "בית", work: "עבודה", fax: "פקס" };
  function filteredQxContacts() {
    const d = qx.open.data, q = qx.search.trim().toLowerCase(), qDigits = q.replace(/\D/g, "");
    return d.contacts.map((c, i) => ({ c, i })).filter(({ c }) => !q || [c.name, c.email, c.note, c.group].some(v => String(v || "").toLowerCase().includes(q)) || (qDigits && Q.SLOT_FIELDS.some(f => String(c[f] || "").replace(/\D/g, "").includes(qDigits))));
  }
  function contactsListHtml() {
    const rows = filteredQxContacts(); const d = qx.open.data;
    const cards = rows.slice(0, 1500).map(({ c, i }) => {
      const name = c.name || "ללא שם";
      const phones = Q.SLOT_FIELDS.filter(f => c[f]).map(f => `<div class="contact-line ${f}"><b>${FIELD_HE[f]}</b><span dir="ltr">${esc(c[f])}</span></div>`).join("");
      const ring = c.ringtone === Q.RINGTONE_FILE ? "♪ " + ((c.ringtonePath || "").split("\\").pop() || "קובץ מהכרטיס") : c.ringtone ? "♪ צלצול מובנה " + c.ringtone : "";
      return `<article class="contact-card" style="--tint:${A().avatarHue(name)}" data-qx="edit-contact" data-i="${i}" role="button" tabindex="0">`
        + `<div class="contact-head"><span class="contact-avatar">${esc(A().initialOf(name))}</span><h3>${esc(name)}</h3></div>` + phones
        + (c.email ? `<div class="contact-line email-line"><b>מייל</b><span dir="auto">${esc(c.email)}</span></div>` : "")
        + (c.note ? `<div class="contact-line note-line"><b>הערה</b><span class="contact-note">${esc(c.note)}</span></div>` : "")
        + (c.group || ring ? `<div class="contact-line note-line"><b>קיוליקס</b><span class="contact-note">${esc([c.group, ring].filter(Boolean).join(" · "))}</span></div>` : "")
        + `<div class="card-actions"><button class="icon-btn" aria-label="עריכה">✎</button></div></article>`;
    }).join("");
    return `<p class="qx-note" style="margin:0 0 10px">${rows.length} מתוך ${d.contacts.length}${rows.length > 1500 ? " · מוצגים 1500 הראשונים, השתמשו בחיפוש" : ""}</p><div class="contact-grid">${cards || `<div class="empty-box"><div class="empty-icon">◫</div><h3>אין אנשי קשר</h3></div>`}</div>`;
  }
  function contactsTab() {
    const d = qx.open.data; const groups = [...new Set(d.contacts.map(c => c.group).filter(Boolean))];
    return `<div class="qx-toolbar"><label class="search-field"><span>⌕</span><input id="qx-search" type="search" value="${esc(qx.search)}" placeholder="חיפוש בשם, טלפון, מייל או הערה…"></label><button class="btn btn-secondary btn-sm" data-qx="add-contact">＋ איש קשר</button><button class="btn btn-quiet btn-sm" data-qx="contacts-to-list">⇄ העבר לניהול אנשי קשר</button><button class="btn btn-quiet btn-sm" data-qx="contacts-from-list">⇐ מרשימה באנק״ל</button><button class="btn btn-quiet btn-sm" data-qx="contacts-from-file">⇐ מקובץ VCF/Excel</button><span class="qx-note">קבוצות: ${groups.map(esc).join(", ") || "אין"}</span></div><div id="qx-contacts-list">${contactsListHtml()}</div>`;
  }
  function callsTab() {
    const rows = flatCalls();
    const fmt = s => Q.phoneTimeToIso(s).replace("T", " ").slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})/, "$3.$2.$1");
    return `<div class="qx-toolbar"><button class="btn btn-secondary btn-sm" data-qx="add-call">＋ שיחה</button><span class="qx-note">${rows.length} שיחות ב-${qx.open.data.callog.entries.length} קבוצות (הטלפון שומר עד 100 קבוצות ועד 10 שיחות בכל אחת)</span></div>
      <div class="qx-table-wrap"><table class="qx-table"><thead><tr><th>סוג</th><th>מספר</th><th>שם</th><th>זמן</th><th>משך</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td><span class="qx-type ${r.e.type}">${Q.CALL_TYPE_HE[r.e.type] || r.e.type}</span></td><td class="num">${esc(r.e.number)}</td><td>${esc(contactName(r.e.number))}</td><td class="num">${fmt(r.call.time)}</td><td class="num">${r.call.duration ? Math.floor(r.call.duration / 60) + ":" + String(r.call.duration % 60).padStart(2, "0") : "—"}</td><td class="act"><button class="icon-btn" data-qx="delete-call" data-ei="${r.ei}" data-ci="${r.ci}" aria-label="מחיקה">✕</button></td></tr>`).join("")}</tbody></table></div>`;
  }
  function memosTab() {
    const d = qx.open.data; const m = d.memos[qx.memoIdx];
    const list = d.memos.map((x, i) => `<button class="${i === qx.memoIdx ? "active" : ""}" data-qx="memo" data-i="${i}"><strong>${esc(x.text.split("\n").find(Boolean) || "(פתק ריק)")}</strong><span>${esc((x.created || "").replace("T", " ").slice(0, 16))} · ${x.text.length} תווים</span></button>`).join("");
    const editor = m ? `<div class="qx-editor"><div class="qx-row"><button class="btn btn-quiet btn-sm" data-qx="center-line">מרכז שורה</button><button class="btn btn-quiet btn-sm" data-qx="center-all">מרכז הכל</button><button class="btn btn-quiet btn-sm" data-qx="calibrate">כיול רוחב</button><div class="spacer"></div><label class="modal-field qx-inline">מגבלת הטלפון<select id="qx-memo-limit"><option value="1000" ${qx.memoLimit === 1000 ? "selected" : ""}>1000 תווים</option><option value="3000" ${qx.memoLimit === 3000 ? "selected" : ""}>3000 תווים</option></select></label><button class="btn btn-danger btn-sm" data-qx="delete-memo">מחיקה</button></div><textarea id="qx-memo-text" dir="auto">${esc(m.text)}</textarea><div id="qx-memo-counter" class="qx-counter"></div><div class="qx-note">כך זה ייראה על מסך הטלפון (הערכה לפי רוחב האותיות; שורות שנשברו מסומנות בחום):</div><div id="qx-memo-preview" class="qx-phone"></div></div>` : `<div class="empty-box"><div class="empty-icon">✎</div><h3>אין פתקים</h3><p>צרו פתק חדש.</p></div>`;
    return `<div class="qx-toolbar"><button class="btn btn-secondary btn-sm" data-qx="new-memo">＋ פתק</button><span class="qx-note">${d.memos.length} פתקים · קבצי טקסט פשוטים בתיקיית Memo</span></div><div class="qx-split"><div class="qx-list">${list}</div>${editor}</div>`;
  }
  function calendarTab() {
    const d = qx.open.data; if (!qx.calMonth) qx.calMonth = localIso(new Date()).slice(0, 7);
    const [y, m] = qx.calMonth.split("-").map(Number); const first = new Date(y, m - 1, 1), daysInMonth = new Date(y, m, 0).getDate(), startDow = first.getDay();
    const byDate = {}; d.events.forEach((e, i) => { (byDate[e.date] = byDate[e.date] || []).push({ e, i }); });
    const monthName = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(first), todayKey = localIso(new Date());
    let cells = ""; for (let k = 0; k < startDow; k++) cells += `<div class="qx-day empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`; const evs = (byDate[key] || []).sort((a, b) => a.e.time.localeCompare(b.e.time));
      cells += `<div class="qx-day ${key === todayKey ? "today" : ""}" data-qx="day-add" data-date="${key}" title="הוספת אירוע ב-${key.split("-").reverse().join(".")}"><span class="qx-daynum">${day}</span>${evs.map(({ e, i }) => `<button class="qx-ev ${e.reminder ? "rem" : ""}" data-qx="edit-event" data-i="${i}" title="${esc(e.time + " " + e.title)}">${esc(e.time)} ${esc(e.title)}</button>`).join("")}</div>`;
    }
    const monthEvents = d.events.map((e, i) => ({ e, i })).filter(x => x.e.date.startsWith(qx.calMonth)).sort((a, b) => (a.e.date + a.e.time).localeCompare(b.e.date + b.e.time));
    const list = qx.calView === "list" ? `<div class="qx-table-wrap" style="margin-top:12px"><table class="qx-table"><thead><tr><th>תאריך</th><th>שעה</th><th>כותרת</th><th>תזכורת</th><th></th></tr></thead><tbody>${d.events.map((e, i) => ({ e, i })).sort((a, b) => (b.e.date + b.e.time).localeCompare(a.e.date + a.e.time)).map(({ e, i }) => `<tr data-qx="edit-event" data-i="${i}" style="cursor:pointer"><td class="num">${esc(e.date.split("-").reverse().join("."))}</td><td class="num">${esc(e.time)}</td><td>${esc(e.title)}</td><td>${e.reminder ? "🔔" : ""}</td><td class="act"><button class="icon-btn" aria-label="עריכה">✎</button></td></tr>`).join("")}</tbody></table></div>` : "";
    return `<div class="qx-toolbar"><button class="btn btn-secondary btn-sm" data-qx="add-event">＋ אירוע</button><button class="btn btn-quiet btn-sm" data-qx="cal-prev">‹ חודש קודם</button><button class="btn btn-quiet btn-sm" data-qx="cal-today">היום</button><button class="btn btn-quiet btn-sm" data-qx="cal-next">חודש הבא ›</button><strong style="font-size:15px">${esc(monthName)}</strong><span class="qx-note">${monthEvents.length} אירועים החודש · ${d.events.length} בסך הכל</span><div class="spacer"></div><button class="btn btn-quiet btn-sm" data-qx="cal-toggle">${qx.calView === "list" ? "הסתר רשימה" : "הצג גם כרשימה"}</button></div>
      <div class="qx-cal-head">${["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"].map(n => `<span>${n}</span>`).join("")}</div><div class="qx-cal">${cells}</div><p class="qx-note" style="margin:8px 0 0">לחיצה על יום מוסיפה אירוע באותו תאריך. לחיצה על אירוע פותחת אותו לעריכה.</p>${list}`;
  }
  function playlistsTab() {
    const d = qx.open.data; const p = d.playlists[qx.plIdx];
    const picks = d.playlists.map((x, i) => `<button class="${i === qx.plIdx ? "active" : ""}" data-qx="playlist" data-i="${i}">♪ ${esc(x.name.replace(/\.lst$/i, ""))} <small>(${x.entries.length})</small></button>`).join("");
    const body = p ? `<div class="qx-toolbar"><button class="btn btn-secondary btn-sm" data-qx="add-song">＋ שיר</button><button class="btn btn-danger btn-sm" data-qx="delete-playlist">מחיקת הרשימה</button><span class="qx-note">${p.entries.length} שירים</span></div><div class="qx-table-wrap"><table class="qx-table"><thead><tr><th>#</th><th>קובץ</th><th>גודל</th><th></th></tr></thead><tbody>${p.entries.map((e, i) => `<tr><td>${i + 1}</td><td class="num" style="white-space:normal;direction:ltr">${esc(e.path)}</td><td class="num">${e.fileSize ? (e.fileSize / 1048576).toFixed(1) + " MB" : ""}</td><td class="act"><button class="icon-btn" data-qx="song-up" data-i="${i}" aria-label="למעלה">↑</button><button class="icon-btn" data-qx="song-down" data-i="${i}" aria-label="למטה">↓</button><button class="icon-btn" data-qx="song-remove" data-i="${i}" aria-label="הסרה">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-box"><div class="empty-icon">♪</div><h3>אין רשימות השמעה</h3></div>`;
    return `<div class="qx-pl">${picks}<button data-qx="new-playlist">＋ רשימה חדשה</button></div>${body}`;
  }
  function dictionaryTab() {
    const d = qx.open.data;
    return `<div class="qx-warn">ניסיוני: המבנה של קובץ חיזוי הטקסט פוענח, אבל ערך הביקורת שלו רק בחלקו. אחרי שחזור של “חיזוי טקסט” מגרסה שנערכה כאן, בדקו בטלפון שהמילים נשמרו.</div>
      <div class="qx-toolbar" style="margin-top:12px"><input id="qx-word" class="qinline" placeholder="מילה חדשה לחיזוי" style="max-width:260px"><button class="btn btn-secondary btn-sm" data-qx="add-word">＋ הוספה</button><button class="btn btn-quiet btn-sm" data-qx="import-words">⇐ מאקסל / מקובץ טקסט</button><span class="qx-note">${d.dictionaryWords.length} מילים${d.dictAdd.length ? ` · ${d.dictAdd.length} חדשות` : ""}${d.dictRemove.length ? ` · ${d.dictRemove.length} להסרה` : ""} · מקום לעוד כ-${Math.max(0, Math.floor(udbFreeBytes() / 26))} מילים</span></div>
      <div class="qx-words">${d.dictionaryWords.map(w => `<span class="qx-word">${esc(w)}<button data-qx="remove-word" data-w="${esc(w)}" aria-label="הסרה">✕</button></span>`).join("") || "<span class='qx-note'>המילון ריק</span>"}</div>`;
  }
  function settingsTab() { const d = qx.open.data; return `<div class="qx-panel"><h3 style="margin:0 0 8px">הגדרות הטלפון</h3><p class="qx-note">${d.settings ? `קובץ ההגדרות (${(d.settings.length / 1024).toFixed(0)} KB) הוא צילום של זיכרון המערכת ואי אפשר לערוך אותו בבטחה. הוא נשמר בגרסה החדשה כמו שהוא, ובטלפון אפשר לבחור אם לשחזר אותו.` : "בגרסה הזו אין קובץ הגדרות."}</p></div>`; }

  /* ---------- אירועים ---------- */
  document.addEventListener("click", async event => {
    const el = event.target.closest("[data-qx]"); if (!el || !document.getElementById("qualix-root")) return;
    const act = el.dataset.qx, i = Number(el.dataset.i);
    try {
      switch (act) {
        case "detect": return detectCards(false);
        case "choose": return chooseFolder();
        case "refresh": if (qx.adapter) { setBusy("מרענן…"); await loadBackups(); setBusy(""); render(); } return;
        case "back": qx.view = "versions"; return render();
        case "resume": qx.view = "editor"; return render();
        case "open": return openBackup(el.dataset.folder);
        case "version-menu": return versionMenu(el.dataset.folder);
        case "new-version": return newVersion(el.dataset.folder || "");
        case "delete-version": return deleteVersion(el.dataset.folder);
        case "compare": return compareVersions(el.dataset.folder);
        case "tab": qx.tab = el.dataset.tab; qx.view = "editor"; if (document.getElementById("app-shell")?.dataset.activePage !== "qualix") { qx.keepView = true; return A().setPage("qualix"); } return render();
        case "save": return saveAsNew();
        case "add-contact": return editContact(-1);
        case "edit-contact": return editContact(i);
        case "pick-ring": return pickAudio("qx-c-ringpath");
        case "pick-song": return pickAudio("qx-song-path");
        case "contacts-to-list": return contactsToList();
        case "contacts-from-list": return contactsFromList();
        case "contacts-from-file": return contactsFromFile();
        case "add-call": return addCall();
        case "delete-call": return deleteCall(Number(el.dataset.ei), Number(el.dataset.ci));
        case "memo": qx.memoIdx = i; return render();
        case "new-memo": return newMemo();
        case "delete-memo": return deleteMemo();
        case "center-line": return centerMemo(false);
        case "center-all": return centerMemo(true);
        case "calibrate": return calibrate();
        case "add-event": return editEvent(-1);
        case "day-add": return editEvent(-1, el.dataset.date);
        case "edit-event": return editEvent(i);
        case "cal-prev": return shiftMonth(-1);
        case "cal-next": return shiftMonth(1);
        case "cal-today": qx.calMonth = localIso(new Date()).slice(0, 7); return render();
        case "cal-toggle": qx.calView = qx.calView === "list" ? "month" : "list"; return render();
        case "import-words": return importWords();
        case "playlist": qx.plIdx = i; return render();
        case "new-playlist": return newPlaylist();
        case "delete-playlist": return deletePlaylist();
        case "add-song": return addSong();
        case "song-up": return moveSong(i, -1);
        case "song-down": return moveSong(i, 1);
        case "song-remove": return removeSong(i);
        case "add-word": return addWord();
        case "remove-word": return removeWord(el.dataset.w);
      }
    } catch (error) { console.error(error); setBusy(""); A().toast("משהו השתבש: " + (error.message || error), "error"); }
  });
  document.addEventListener("input", event => {
    if (event.target.id === "qx-search") { qx.search = event.target.value; const list = document.getElementById("qx-contacts-list"); if (list) list.innerHTML = contactsListHtml(); }
    if (event.target.id === "qx-memo-text") { const m = qx.open?.data.memos[qx.memoIdx]; if (m) { m.text = event.target.value; m._dirty = true; dirty("memo"); memoCounter(); const save = document.querySelector(".qx-save .qx-note"); if (save) { save.outerHTML = `<span class="qx-dirty">יש שינויים שלא נשמרו</span>`; renderSubnav(); } } }
  });
  document.addEventListener("change", event => { if (event.target.id === "qx-memo-limit") { qx.memoLimit = Number(event.target.value) || 1000; localStorage.setItem(LIMIT_KEY, String(qx.memoLimit)); memoCounter(); } });
  document.addEventListener("keydown", event => { if (event.key === "Enter" && event.target.id === "qx-word") { event.preventDefault(); addWord(); } });
  window.addEventListener("beforeunload", event => { if (qx.open?.dirty.size) { event.preventDefault(); event.returnValue = ""; } });

  // connect מאפשר לבדיקות דפדפן להזרים מתאם בזיכרון במקום כרטיס אמיתי
  // לחיצה על "גיבוי קיוליקס" בתפריט מציגה את הגרסאות (כמו "הרשימות שלי"); מעבר מקטגוריה בתפריט שומר על העורך.
  window.ANKAL_QUALIX_UI = { show: () => { if (!qx.keepView) qx.view = "versions"; qx.keepView = false; render(); if (!qx.adapter && window.electronAPI?.qualix) detectCards(true); }, state: qx, connect, render };
})();
