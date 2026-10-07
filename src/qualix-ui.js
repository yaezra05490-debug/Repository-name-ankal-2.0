/* גיבוי קיוליקס — הממשק. קורא תיקיית ibphone מכרטיס הזיכרון (או מתיקייה שנבחרה), נותן לערוך כל קטגוריה,
   ושומר גרסה חדשה שהטלפון יודע לשחזר. הפורמט עצמו חי ב-qualix.js; החלונות, ההודעות והרשימות מגיעים
   מ-app.js דרך window.ANKAL_APP. כל הלחיצות כאן עוברות ב-data-qx, בנפרד ממפת הפעולות של האפליקציה. */
(function () {
  "use strict";
  const Q = window.ANKAL_QUALIX;
  const A = () => window.ANKAL_APP;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* הכיול נשמר כהפרשים בלבד מעל טבלת ברירת המחדל (מפתח v2), כדי שתיקון בטבלה יגיע גם למי שכייל.
     המפתח הישן החזיק עותק מלא של הטבלה הישנה (הנוסחה המוטה) ודרס את התיקון — הוא נמחק. */
  const LIMIT_KEY = "ankal.qualix.memoLimit", WIDTH_KEY = "ankal.qualix.widths.v2", OLD_WIDTH_KEY = "ankal.qualix.widths", FILL_KEY = "ankal.qualix.memoFill";
  /* מה שהמשתמש גילה בטלפון (אוקטובר 2026): בשחזור, אירוע ביומן שכבר קיים בדיוק כזה לא מתווסף שוב — אבל
     פתק מזוהה לפי שם הקובץ בלבד, ולכן פתק שנערך כאן ושמו לא השתנה לא מתעדכן בטלפון. */
  const MEMO_RESTORE_NOTE = "בשחזור, הטלפון מזהה פתק לפי שם הקובץ ולא לפי התוכן: פתק שערכתם כאן לא יתעדכן בטלפון כל עוד הפתק הישן קיים בו. לפני השחזור מחקו בטלפון את הפתקים שערכתם (או את כל הפתקים), ורק אז שחזרו את “הפתקים שלי”. לשינוי שנכנס מיד, בלי שחזור, השתמשו ב“ניהול פתקים” שבתפריט הצד.";
  const CAT_HE = { phonebook: "אנשי קשר", callog: "יומן שיחות", schedule: "לוח שנה", settings: "הגדרות", memo: "הפתקים שלי", udb: "חיזוי טקסט", playlist: "רשימות השמעה" };
  const TABS = [["contacts", "אנשי קשר", "◫"], ["calls", "יומן שיחות", "☎"], ["memos", "הפתקים שלי", "✎"], ["calendar", "לוח שנה", "▦"], ["playlists", "רשימות השמעה", "♪"], ["dictionary", "חיזוי טקסט", "⌨"], ["settings", "הגדרות", "⚙"]];
  const isBackupName = n => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(n);
  const AUDIO = /\.(mp3|wav|amr|mid|midi|aac|m4a|wma)$/i;

  /* view: "versions" = רשימת הגרסאות (כמו "הרשימות שלי"), "editor" = הקטגוריות של הגרסה הפתוחה (כמו "אנשי קשר") */
  /* direct: הפתקים של תיקיית Memo בכרטיס ("ניהול פתקים", בלי גרסה). cloud: הגרסאות ששמורות בשרת (דרייב). */
  const qx = { adapter: null, layout: null, backups: [], open: null, view: "versions", tab: "contacts", busy: "", search: "", memoLimit: 1000, widths: null, memoFill: "space", memoIdx: 0, plIdx: 0, rendered: false, keepView: false, direct: null, contactView: "list", groupSel: null, selected: new Set(), cloud: { loaded: false, versions: [], uploading: "", error: "" } };
  try { qx.memoLimit = Number(localStorage.getItem(LIMIT_KEY)) || 1000; qx.widths = JSON.parse(localStorage.getItem(WIDTH_KEY) || "null"); qx.memoFill = localStorage.getItem(FILL_KEY) || "space"; localStorage.removeItem(OLD_WIDTH_KEY); } catch (_) { }
  const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n ? n + " B" : "";
  const widths = () => qx.widths ? Object.assign({}, Q.WIDTHS, qx.widths) : Q.WIDTHS;

  /* ---------- גישה לקבצים: התוכנה למחשב (IPC) או הדפדפן (File System Access) ---------- */
  function electronAdapter(root, label) {
    const api = window.electronAPI.qualix;
    return { label, kind: "electron", list: rel => api.list(root, rel || ""), read: async rel => new Uint8Array(await api.read(root, rel)), write: (rel, bytes) => api.write(root, rel, bytes), mkdir: rel => api.mkdir(root, rel), remove: rel => api.remove(root, rel), exists: rel => api.exists(root, rel), utimes: api.utimes ? (rel, ms) => api.utimes(root, rel, ms) : null };
  }
  function fsaAdapter(handle, label) {
    async function dirOf(rel, create) { let dir = handle; for (const part of String(rel || "").split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: !!create }); return dir; }
    const split = rel => { const parts = String(rel).split("/").filter(Boolean); return { dir: parts.slice(0, -1).join("/"), name: parts[parts.length - 1] }; };
    return {
      label, kind: "fsa",
      list: async rel => { const dir = await dirOf(rel, false); const out = []; for await (const [name, h] of dir.entries()) { let size = 0, mtime = 0; if (h.kind === "file") { try { const f = await h.getFile(); size = f.size; mtime = f.lastModified; } catch (_) { } } out.push({ name, kind: h.kind, size, mtime }); } return out; },
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
      qx.adapter = adapter; qx.layout = layout; qx.open = null; qx.direct = null; qx.cardSounds = null; versionCache.clear(); qx.cloud = { loaded: false, versions: [], uploading: "", error: "" };
      await loadBackups(); render(); A().toast(`נמצאו ${qx.backups.length} גיבויים`);
      syncCloud(); // ברקע: מה כבר בשרת, והעלאה של מה שחסר
      return true;
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
  /* שם לגרסה: הטלפון מכיר רק את שם התיקייה (תאריך ושעה), ולכן השם נשמר בדפדפן הזה לפי שם התיקייה
     (לא בתוך תיקיית הגיבוי — לא מסתכנים בקובץ זר שהטלפון לא מצפה לו). */
  const NAMES_KEY = "ankal.qualix.versionNames";
  function versionNames() { try { return JSON.parse(localStorage.getItem(NAMES_KEY) || "{}"); } catch (_) { return {}; } }
  function versionName(folder) { return versionNames()[folder] || ""; }
  function setVersionName(folder, name) { const all = versionNames(); if (name) all[folder] = name; else delete all[folder]; try { localStorage.setItem(NAMES_KEY, JSON.stringify(all)); } catch (_) { } }
  function versionLabel(folder) { const n = versionName(folder); return n ? `${n} · ${folderDate(folder)}` : folderDate(folder); }
  async function renameVersion(folder) {
    const choice = await A().modal({ kicker: "שם לגרסה", title: folderDate(folder), html: `<label class="modal-field">שם (ריק = בלי שם)<input id="qx-version-name" maxlength="60" value="${esc(versionName(folder))}" placeholder="לדוגמה: לפני הניקוי הגדול"></label><p class="qx-note">השם נשמר במחשב הזה; בטלפון הגרסה מזוהה לפי התאריך והשעה.</p>`, buttons: [{ id: "save", label: "שמירה", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "save") return; setVersionName(folder, (document.getElementById("qx-version-name")?.value || "").trim()); render();
  }

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
      const entries = (await qx.adapter.list(bk.rel)).filter(e => e.kind === "file"); const names = entries.map(e => e.name);
      const data = await Q.readBackup({ folder: bk.folder, listFiles: async () => names, readFile: n => qx.adapter.read(join(bk.rel, n)) });
      data.contacts = data.contacts || []; data.events = data.events || []; data.memos = data.memos || []; data.playlists = data.playlists || [];
      data.callog = data.callog || { entries: [] }; data.dictionaryWords = (data.dictionary?.words || []).filter((w, i, arr) => arr.indexOf(w) === i); data.dictAdd = []; data.dictRemove = [];
      await attachRingtones(data); await attachMemoTimes(data, new Map(entries.map(e => [e.name, e.mtime || 0])));
      qx.open = { folder: bk.folder, rel: bk.rel, data, dirty: new Set(), isNew: false };
      if (data.errors?.length) A().toast(`חלק מהגיבוי לא נקרא ונפתח בלעדיו: ${data.errors.map(e => `${e.file} (${e.error})`).join(", ")}`, "warning");
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
  /* הטלפון מציג את הפתקים לפי זמן העדכון האחרון, מהחדש לישן. העתקי הגיבוי מאבדים את הזמן הזה,
     ולכן כשהכרטיס מחובר קוראים אותו מתיקיית Memo המקורית; אחרת לפי זמן היצירה שבשם הקובץ. */
  async function attachMemoTimes(data, folderTimes) {
    if (!data.memos) return;
    /* זמני הקבצים בתיקיית הגיבוי עצמה מועדפים כשהם מבחינים בין הפתקים (גרסה שנשמרה מכאן עם סדר מפורש);
       כשכולם זהים (הטלפון העתיק את כולם באותן שתי שניות) נופלים לזמני תיקיית Memo של הכרטיס, ואז לשם הקובץ. */
    const distinct = folderTimes ? new Set([...folderTimes.values()].filter(Boolean)).size : 0;
    const times = new Map();
    if (qx.layout.mode === "card") { try { const rootEntries = await qx.adapter.list(""); const memoDir = rootEntries.find(e => e.kind === "directory" && e.name.toLowerCase() === "memo"); if (memoDir) for (const f of await qx.adapter.list(memoDir.name)) if (f.mtime) times.set(f.name, f.mtime); } catch (_) { } }
    for (const m of data.memos) { const t = (distinct > 1 && folderTimes.get(m.fileName)) || times.get(m.fileName); m.modified = t ? new Date(t).toISOString().slice(0, 19) : (m.created || ""); }
    data.memos.sort((a, b) => String(b.modified || "").localeCompare(String(a.modified || "")));
  }
  const dirty = key => { if (qx.open) qx.open.dirty.add(key); };
  const contactName = number => { const digits = String(number || "").replace(/\D/g, "").slice(-9); if (!digits) return ""; const c = (qx.open?.data.contacts || []).find(c => Q.SLOT_FIELDS.some(f => String(c[f] || "").replace(/\D/g, "").endsWith(digits))); return c ? c.name : ""; };

  /* ---------- שמירה כגרסה חדשה ---------- */
  async function saveAsNew(skipConfirm = false) {
    if (!qx.open) return false;
    if (!qx.layout.canSave) { A().toast("כדי לשמור בחרו את הכרטיס עצמו או את תיקיית ibphone", "warning"); return false; }
    const d = qx.open.data;
    if (!skipConfirm) {
      const choice = await A().modal({ kicker: "שמירה", title: "לשמור כגרסה חדשה?", html: `<p>הגיבוי המקורי לא ישתנה. תיווצר תיקייה חדשה עם השעה הנוכחית, ובטלפון תוכלו לבחור אותה בשחזור.</p><label class="modal-field">שם לגרסה (לא חובה)<input id="qx-save-name" maxlength="60" placeholder="לדוגמה: אחרי ניקוי הכפולים"></label><p class="qx-note">הקטגוריות שייכתבו: ${Object.keys(CAT_HE).filter(k => hasCategory(d, k)).map(k => CAT_HE[k]).join(", ")}</p>${d.dictAdd.length || d.dictRemove.length ? `<div class="qx-warn">שינוי במילון חיזוי הטקסט נכתב בפורמט שפוענח חלקית. אחרי השחזור בדקו בטלפון שהמילון שלם.</div>` : ""}`, buttons: [{ id: "save", label: "שמירה", primary: true }, { id: "cancel", label: "ביטול" }] });
      if (choice !== "save") return false;
      qx.pendingName = (document.getElementById("qx-save-name")?.value || "").trim();
    }
    setBusy("כותב את הגיבוי…");
    try {
      let folder = Q.backupFolderName(new Date()); while (await qx.adapter.exists(join(qx.layout.ibphoneRel, folder))) folder = Q.backupFolderName(new Date(Date.now() + 1000));
      const udb = d.udb ? { phoneCache: d.udb.phoneCache, cardCache: (d.dictAdd.length || d.dictRemove.length) ? Q.updateUdbWords(d.udb.cardCache, { add: d.dictAdd, remove: d.dictRemove }) : d.udb.cardCache } : null;
      // הפתקים נכתבים מהתחתון לעליון: בשחזור הטלפון מעתיק אותם לפי הסדר, והאחרון שהועתק הוא החדש ביותר ומוצג ראשון
      const files = Q.assembleBackup({ folder, cardLetter: "E", contacts: hasCategory(d, "phonebook") ? d.contacts : null, recordSize: d.recordSize || 1200, callog: hasCategory(d, "callog") ? d.callog : null, events: hasCategory(d, "schedule") ? d.events : null, memos: hasCategory(d, "memo") ? d.memos.slice().reverse() : null, playlists: hasCategory(d, "playlist") ? d.playlists : null, settings: d.settings || null, udb });
      const rel = join(qx.layout.ibphoneRel, folder); await qx.adapter.mkdir(rel);
      for (const f of files) await qx.adapter.write(join(rel, f.name), f.bytes);
      // בתוכנה למחשב גם זמני הקבצים בתיקיית הגיבוי מקבלים את הסדר (העליון החדש ביותר), למקרה שהטלפון שומר אותם בשחזור
      if (hasCategory(d, "memo") && qx.adapter.utimes) { const base = Date.now(); for (let k = 0; k < d.memos.length; k++) await qx.adapter.utimes(join(rel, d.memos[k].fileName), base - k * 2000); }
      // צלצולים אישיים יושבים מחוץ לגיבוי, בתיקיית PB של הכרטיס
      let rings = 0;
      if (qx.layout.pbRel && hasCategory(d, "phonebook")) for (const c of d.contacts) {
        if (c.ringtone !== Q.RINGTONE_FILE || !c.ringtonePath || !c._ringDirty) continue;
        let size = c.ringtoneSize || 0; if (!size) { try { const rp = c.ringtonePath.replace(/^[A-Za-z]:\\/, "").replace(/\\/g, "/"); size = (await qx.adapter.read(rp)).length; } catch (_) { } }
        await qx.adapter.write(join(qx.layout.pbRel, Q.ringFileName(c.id)), Q.buildRingIni(c.ringtonePath, size)); rings++;
      }
      const memosChanged = qx.open.dirty.has("memo") && hasCategory(d, "memo");
      if (qx.pendingName) { setVersionName(folder, qx.pendingName); qx.pendingName = ""; }
      await loadBackups(); qx.open.dirty.clear(); qx.open.folder = folder; qx.open.rel = rel; qx.open.isNew = false; d.contacts.forEach(c => { c._ringDirty = false; });
      render();
      syncCloud(); // הגרסה החדשה עולה לשרת ברקע, כמו כל גיבוי שבכרטיס
      await A().modal({ kicker: "נשמר", title: `הגרסה ${folderDate(folder)} מוכנה`, html: `<p>בטלפון: <b>תפריט ← גיבוי ושחזור ← שחזור</b>, בחרו את הגיבוי לפי השעה <b dir="ltr">${esc(folder)}</b>, וסמנו אילו קטגוריות לשחזר.</p>${rings ? `<p>נכתבו ${rings} קובצי צלצול אישי לתיקיית PB.</p>` : ""}${memosChanged ? `<div class="qx-warn"><b>שיניתם פתקים:</b> ${esc(MEMO_RESTORE_NOTE)}</div>` : ""}<p class="qx-note">ההגדרות הועתקו כמו שהן. אם זו הפעם הראשונה, מומלץ לשחזר קודם קטגוריה אחת ולבדוק.</p>`, buttons: [{ id: "ok", label: "סגירה", primary: true }] });
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
    const onCloud = qx.cloud.versions.some(v => v.folder === folder);
    const choice = await A().modal({ kicker: "אפשרויות גרסה", title: versionLabel(folder), html: `<p dir="ltr" style="text-align:right">${esc(folder)}</p><p class="qx-note">${bk.categories.map(k => CAT_HE[k]).join(" · ")}</p><p class="qx-note">${onCloud ? "☁ שמורה גם בשרת" : cloudUser() ? "לא שמורה בשרת" : "נשמרת רק בכרטיס (בלי כניסה עם Google)"}</p>`, buttons: [{ id: "open", label: isCur ? "המשך עריכה" : "פתיחה", primary: true }, { id: "rename", label: versionName(folder) ? "שינוי השם" : "שם לגרסה" }, { id: "new", label: "גרסה חדשה מכאן" }, { id: "compare", label: "השוואה לגרסה אחרת" }, ...(cloudUser() && isBackupName(folder) ? [{ id: "upload", label: onCloud ? "העלאה מחדש לשרת" : "העלאה לשרת" }] : []), ...(qx.layout.mode !== "single" ? [{ id: "delete", label: "מחיקה מהכרטיס" }] : []), { id: "cancel", label: "סגירה" }] });
    if (choice === "open") return openBackup(folder);
    if (choice === "rename") return renameVersion(folder);
    if (choice === "upload") return uploadVersion(folder);
    if (choice === "new") return newVersion(folder);
    if (choice === "compare") return compareVersions(folder);
    if (choice === "delete") return deleteVersion(folder);
  }
  async function deleteVersion(folder) {
    const bk = qx.backups.find(b => b.folder === folder); if (!bk || qx.layout.mode === "single") return;
    const onCloud = qx.cloud.versions.some(v => v.folder === folder);
    if (!(await A().confirmBox("מחיקת גיבוי", `למחוק לצמיתות את הגיבוי ${folderDate(folder)} מהכרטיס? אי אפשר לשחזר מחיקה.${onCloud ? " העותק שבשרת נשאר." : " הגיבוי הזה לא שמור בשרת."}`, "מחיקה"))) return;
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
      <label class="modal-field">צלצול אישי<select id="qx-c-ring"><option value="0" ${!c.ringtone ? "selected" : ""}>ברירת המחדל של הטלפון</option><option value="${Q.RINGTONE_FILE}" ${c.ringtone === Q.RINGTONE_FILE ? "selected" : ""}>שיר או קובץ מהכרטיס</option><option value="builtin" ${c.ringtone && c.ringtone !== Q.RINGTONE_FILE ? "selected" : ""}>צלצול מובנה של הטלפון</option></select></label>
      <label class="modal-field" id="qx-c-ringcode-row">קוד הצלצול המובנה<input id="qx-c-ringcode" type="number" min="1" max="65535" value="${c.ringtone && c.ringtone !== Q.RINGTONE_FILE ? c.ringtone : 201}"><small class="qx-note">הטלפון שומר צלצול מובנה כמספר; שמות הצלצולים עדיין לא ממופים.</small></label>
      <label class="modal-field full" id="qx-c-ringpath-row">קובץ הצלצול<div class="qx-row"><input id="qx-c-ringpath" value="${esc(c.ringtonePath || "")}" dir="ltr" placeholder="E:\\שיר.mp3" style="flex:1"><button type="button" class="btn btn-quiet btn-sm" data-qx="pick-ring">עיון בכרטיס והשמעה</button></div><small class="qx-note">דורש שהכרטיס עצמו יהיה מחובר, כי הנתיב נשמר בתיקיית PB.</small></label></div>
      <p class="qx-note">הקבוצה חייבת להיות אחת מעד שמונה; קבוצה חדשה נכתבת לגיבוי ונבדקת בשחזור.</p>`;
    const promise = A().modal({ kicker: idx >= 0 ? "עריכת איש קשר" : "איש קשר חדש", title: c.name || "איש קשר", html, buttons: [{ id: "save", label: "שמירה", primary: true }, ...(idx >= 0 ? [{ id: "delete", label: "מחיקה" }] : []), { id: "cancel", label: "ביטול" }], enterConfirms: false });
    // מציגים רק את מה שרלוונטי לבחירת הצלצול
    const ringSelect = document.getElementById("qx-c-ring"), syncRing = () => { document.getElementById("qx-c-ringcode-row")?.classList.toggle("hidden", ringSelect.value !== "builtin"); document.getElementById("qx-c-ringpath-row")?.classList.toggle("hidden", ringSelect.value !== String(Q.RINGTONE_FILE)); };
    ringSelect?.addEventListener("change", syncRing); syncRing();
    const choice = await promise;
    if (choice === "delete") { if (await A().confirmBox("מחיקה", `למחוק את ${c.name}?`, "מחיקה")) { d.contacts.splice(idx, 1); dirty("phonebook"); render(); } return; }
    if (choice !== "save") return;
    const v = k => (document.getElementById("qx-c-" + k)?.value || "").trim();
    if (!v("name")) return A().toast("יש להכניס שם", "warning");
    const ringSel = document.getElementById("qx-c-ring").value, ringPath = v("ringpath");
    const ring = ringSel === "builtin" ? (Math.max(1, Math.min(65535, Number(v("ringcode")) || 201))) : (Number(ringSel) || 0);
    const next = { name: v("name"), mobile: v("mobile"), home: v("home"), work: v("work"), fax: v("fax"), email: v("email"), note: v("note"), group: v("group"), ringtone: ring === Q.RINGTONE_FILE && !ringPath ? 0 : ring, ringtonePath: ring === Q.RINGTONE_FILE ? ringPath : "" };
    // קבוצה שהשתנתה מאפסת את הביט: אחרת הביט הישן היה נודד עם איש הקשר לקבוצה החדשה ומתנגש עם הקבוצה הישנה
    if (idx >= 0) { const changedRing = next.ringtone !== c.ringtone || next.ringtonePath !== (c.ringtonePath || ""); Object.assign(c, next, { _dirty: true, _ringDirty: c._ringDirty || changedRing }, next.group !== (c.group || "") ? { groupBit: 0 } : {}); }
    else d.contacts.push(Object.assign(next, { id: 0, groupBit: 0, _dirty: true, _ringDirty: next.ringtone === Q.RINGTONE_FILE }));
    dirty("phonebook"); render();
  }
  /* דפדפן תיקיות לכרטיס: תיקיות ושירים כמו בסייר, עם השמעה מקדימה לפני הבחירה */
  const SKIP_DIRS = /^(ibphone|PB|System|@cstardata|\$RECYCLE\.BIN|System Volume Information|FOUND\.\d+|DRM_LRO|DRM_BRO|Filearray|SysTumbNailRes)$/i;
  const BROWSE_KEY = "ankal.qualix.browseDir";
  let previewUrl = null;
  async function pickAudio(targetInputId) {
    if (qx.layout.mode !== "card") return A().toast("בחירת שיר מהכרטיס אפשרית רק כשנבחר הכרטיס עצמו", "warning");
    let rel = ""; try { rel = localStorage.getItem(BROWSE_KEY) || ""; } catch (_) { }
    const toPath = r => "E:\\" + r.replace(/\//g, "\\");
    const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n ? n + " B" : "";
    const promise = A().modal({ kicker: "שיר מהכרטיס", title: "בחרו קובץ", html: `<div id="qx-browse"></div><audio id="qx-preview" controls style="width:100%;margin-top:10px" class="hidden"></audio>`, buttons: [{ id: "cancel", label: "סגירה" }] });
    const box = document.getElementById("qx-browse"), player = document.getElementById("qx-preview");
    async function show(dir) {
      rel = dir; try { localStorage.setItem(BROWSE_KEY, rel); } catch (_) { }
      box.innerHTML = `<p class="qx-note">טוען…</p>`;
      let entries = []; try { entries = await qx.adapter.list(rel); } catch (_) { entries = []; }
      const dirs = entries.filter(e => e.kind === "directory" && !(rel === "" && SKIP_DIRS.test(e.name))).sort((a, b) => a.name.localeCompare(b.name, "he"));
      const files = entries.filter(e => e.kind === "file" && AUDIO.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, "he"));
      const crumbs = rel ? rel.split("/") : [];
      box.innerHTML = `<div class="qx-crumbs"><button type="button" class="btn btn-quiet btn-sm" data-browse-dir="">E:\\ (הכרטיס)</button>${crumbs.map((c, i) => `<span>›</span><button type="button" class="btn btn-quiet btn-sm" data-browse-dir="${esc(crumbs.slice(0, i + 1).join("/"))}">${esc(c)}</button>`).join("")}</div>
        <div class="qx-picker">${rel ? `<button type="button" class="qx-entry" data-browse-dir="${esc(crumbs.slice(0, -1).join("/"))}"><i>⬆</i>תיקייה למעלה</button>` : ""}${dirs.map(d => `<button type="button" class="qx-entry" data-browse-dir="${esc(join(rel, d.name))}"><i>📁</i>${esc(d.name)}</button>`).join("")}${files.map(f => `<div class="qx-entry file"><i>♪</i><span class="qx-entry-name">${esc(f.name)}</span><small>${fmtSize(f.size)}</small><button type="button" class="btn btn-quiet btn-sm" data-browse-play="${esc(join(rel, f.name))}">▶ השמעה</button><button type="button" class="btn btn-secondary btn-sm" data-browse-pick="${esc(join(rel, f.name))}" data-size="${f.size || 0}">בחירה</button></div>`).join("")}${!dirs.length && !files.length ? `<p class="qx-note" style="padding:12px">אין כאן תיקיות או קובצי שמע</p>` : ""}</div>`;
    }
    box.addEventListener("click", async e => {
      const dirBtn = e.target.closest("[data-browse-dir]"); if (dirBtn) return show(dirBtn.dataset.browseDir);
      const play = e.target.closest("[data-browse-play]");
      if (play) {
        try { play.textContent = "טוען…"; const bytes = await qx.adapter.read(play.dataset.browsePlay); if (previewUrl) URL.revokeObjectURL(previewUrl); const ext = play.dataset.browsePlay.split(".").pop().toLowerCase(); previewUrl = URL.createObjectURL(new Blob([bytes], { type: ext === "wav" ? "audio/wav" : ext === "amr" ? "audio/amr" : "audio/mpeg" })); player.src = previewUrl; player.classList.remove("hidden"); await player.play().catch(() => { }); } catch (_) { A().toast("לא הצלחנו להשמיע את הקובץ", "warning"); } finally { play.textContent = "▶ השמעה"; }
        return;
      }
      const pick = e.target.closest("[data-browse-pick]");
      if (pick) { const input = document.getElementById(targetInputId); if (input) { input.value = toPath(pick.dataset.browsePick); input.dataset.size = pick.dataset.size || ""; } document.querySelector("[data-modal-choice='cancel']")?.click(); }
    });
    await show(rel);
    await promise;
    try { player.pause(); } catch (_) { } if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
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
  /* נקרא מהאפליקציה בסוף הניהול החכם: הרשימה הנקייה חוזרת לגרסה הפתוחה */
  async function importList(list) {
    if (!qx.open) return A().toast("אין גרסת גיבוי פתוחה", "warning");
    const mode = await A().modal({ kicker: "חזרה לגיבוי", title: `להכניס את “${list.name}” לגרסה הפתוחה?`, html: `<p>${list.contacts.length} אנשי קשר מהרשימה ייכנסו לגרסת הגיבוי ${qx.open.isNew ? "החדשה" : folderDate(qx.open.folder)}.</p>`, buttons: [{ id: "replace", label: "להחליף את כל אנשי הקשר בגיבוי", primary: true }, { id: "add", label: "להוסיף לקיימים" }, { id: "cancel", label: "ביטול" }] });
    if (mode === "cancel") return;
    const d = qx.open.data; const incoming = list.contacts.map(fromAppContact);
    if (mode === "replace") d.contacts = incoming; else d.contacts.push(...incoming);
    dirty("phonebook"); qx.view = "editor"; qx.tab = "contacts"; qx.keepView = true; A().setPage("qualix");
    A().toast(`${incoming.length} אנשי קשר נכנסו לגיבוי. לחצו “שמירה כגרסה חדשה” כדי לכתוב לכרטיס.`);
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
      <label class="modal-field">סוג<select id="qx-call-type">${["outgoing", "incoming", "missed", "rejected"].map(k => `<option value="${k}">${Q.CALL_TYPE_HE[k]}</option>`).join("")}</select></label>
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
  // השבירה עצמה חיה בספרייה (Q.wrapLines), כדי שהמירכוז והתצוגה ישברו באותן נקודות בדיוק
  function wrapForPhone(text) { return Q.wrapLines(text, widths()); }
  /* הפתקים של הגרסה הפתוחה, או — ב"ניהול פתקים" — הפתקים של תיקיית Memo בכרטיס. אותו עורך לשניהם. */
  function memoStore() {
    if (qx.view === "memos-direct" && qx.direct) return { memos: qx.direct.memos, direct: true, get idx() { return qx.direct.idx; }, set idx(v) { qx.direct.idx = v; }, mark: () => { qx.direct.dirty = true; } };
    const d = qx.open?.data; return { memos: d ? d.memos : [], direct: false, get idx() { return qx.memoIdx; }, set idx(v) { qx.memoIdx = v; }, mark: () => dirty("memo") };
  }
  function markUnsaved() { const el = document.getElementById("qx-save-state"); if (el) { el.className = "qx-dirty"; el.textContent = "יש שינויים שלא נשמרו"; } renderSubnav(); }
  /* הטלפון מצייר כל תו ברוחב קבוע מהטבלה, לא לפי הפונט של הדפדפן. כדי שמסגרת שמרובעת בטלפון תהיה מרובעת
     גם כאן, כל תו מקבל תיבה ברוחב שלו. רצפים של ספרות/לטינית נשארים משמאל לימין בתוך שורה עברית. */
  function phoneLineHtml(text, pxPerUnit) {
    const table = widths(); const runs = []; let cur = null;
    const dirOf = ch => /[A-Za-z0-9]/.test(ch) ? "ltr" : /[֐-׿]/.test(ch) ? "rtl" : "";
    for (const ch of text) {
      const d = dirOf(ch);
      if (!cur) { cur = { dir: d, chars: [] }; runs.push(cur); }
      else if (d && cur.dir === "") cur.dir = d;                       // רצף שהתחיל בסימנים ניטרליים מקבל את הכיוון של האות הראשונה
      else if (d && cur.dir !== d) { cur = { dir: d, chars: [] }; runs.push(cur); }
      cur.chars.push(ch);
    }
    return runs.map(r => `<span class="qx-run" dir="${r.dir || "rtl"}">${r.chars.map(ch => `<i style="width:${(Q.textWidth(ch, table) * pxPerUnit).toFixed(2)}px">${ch === " " ? "" : esc(ch)}</i>`).join("")}</span>`).join("");
  }
  function memoCounter() {
    const st = memoStore(); const m = st.memos[st.idx]; const el = document.getElementById("qx-memo-counter"); if (!m || !el) return;
    const len = m.text.length; el.textContent = `${len} / ${qx.memoLimit} תווים`; el.classList.toggle("over", len > qx.memoLimit);
    const prev = document.getElementById("qx-memo-preview"); if (!prev) return;
    // רוחב המסך נגזר מהאות ש של הדפדפן: תיבה של 71 יחידות = רוחב הגליף, וכך הטקסט נראה רגיל והפרופורציות של הטלפון נשמרות
    const pxPerUnit = glyphUnit(prev);
    prev.style.width = Math.round(Q.LINE_UNITS * pxPerUnit + 24 + 16) + "px";
    prev.innerHTML = wrapForPhone(m.text).map(l => `<div class="${l.wrap ? "qx-wrap" : ""}">${l.t ? phoneLineHtml(l.t, pxPerUnit) : "&nbsp;"}</div>`).join("");
  }
  let glyphCache = { font: "", unit: 0 };
  function glyphUnit(el) {
    const font = getComputedStyle(el).font || "15px Assistant";
    if (glyphCache.font === font && glyphCache.unit) return glyphCache.unit;
    let unit = 0.2; try { const ctx = document.createElement("canvas").getContext("2d"); ctx.font = font; const w = ctx.measureText("ש").width; if (w > 3) unit = (w + 1) / (widths()["ש"] || 71); } catch (_) { }
    glyphCache = { font, unit }; return unit;
  }
  function newMemo() { const st = memoStore(); const now = new Date(); const iso = localIso(now) + "T" + now.toTimeString().slice(0, 8); st.memos.unshift({ fileName: Q.memoFileName(now), text: "", created: iso, modified: iso, _dirty: true, _new: true }); st.idx = 0; st.mark(); render(); setTimeout(() => document.getElementById("qx-memo-text")?.focus(), 50); }
  async function deleteMemo() { const st = memoStore(); const m = st.memos[st.idx]; if (!m) return; if (!(await A().confirmBox("מחיקת פתק", st.direct ? "למחוק את הפתק מהכרטיס? המחיקה מתבצעת בלחיצה על “שמירה לטלפון”." : "למחוק את הפתק?", "מחיקה"))) return; st.memos.splice(st.idx, 1); if (st.direct && !m._new) qx.direct.removed.push(m.fileName); st.idx = Math.max(0, st.idx - 1); st.mark(); render(); }
  /* מירכוז כל הפתק או השורה שבה הסמן. שורה שרחבה ממסך הטלפון נשברת קודם לשורות מאוזנות (Q.centerText),
     ולכן שורה אחת יכולה להפוך לכמה. תו המילוי נבחר בבורר שליד הכפתורים ונשמר להבא. */
  /* פעולת עיצוב על הפתק: כל הפתק או השורה שבה הסמן, עם היסטוריה ל"בטל את הפעולה האחרונה" (Ctrl+Z של
     הדפדפן לא מכיר שינויים שנעשו בקוד). */
  function editMemoText(all, fn) {
    const st = memoStore(); const m = st.memos[st.idx]; const ta = document.getElementById("qx-memo-text"); if (!m || !ta) return;
    (m._history = m._history || []).push(m.text); if (m._history.length > 30) m._history.shift();
    if (all) m.text = fn(m.text);
    else { const pos = ta.selectionStart; const before = m.text.lastIndexOf("\n", pos - 1) + 1; let after = m.text.indexOf("\n", pos); if (after < 0) after = m.text.length; m.text = m.text.slice(0, before) + fn(m.text.slice(before, after)) + m.text.slice(after); }
    m._dirty = true; st.mark(); ta.value = m.text; memoCounter(); markUnsaved(); document.querySelector('[data-qx="memo-undo"]')?.removeAttribute("disabled");
  }
  function centerMemo(all) { editMemoText(all, text => Q.centerText(text, widths(), { fill: "space" })); }
  function uncenterMemo(all) { editMemoText(all, text => Q.uncenterText(text)); }
  function undoMemo() { const st = memoStore(); const m = st.memos[st.idx]; const ta = document.getElementById("qx-memo-text"); if (!m || !ta || !m._history?.length) return; m.text = m._history.pop(); m._dirty = true; st.mark(); ta.value = m.text; memoCounter(); markUnsaved(); if (!m._history.length) document.querySelector('[data-qx="memo-undo"]')?.setAttribute("disabled", ""); }
  /* סדר הפתקים: ▲/▼ מזיזים ברשימה; הסדר נכתב בשמירה. */
  function moveMemo(i, delta) { const st = memoStore(); const j = i + delta; if (i < 0 || j < 0 || j >= st.memos.length) return; [st.memos[i], st.memos[j]] = [st.memos[j], st.memos[i]]; if (st.idx === i) st.idx = j; else if (st.idx === j) st.idx = i; if (st.direct) qx.direct.orderDirty = true; st.mark(); render(); markUnsaved(); }
  /* גרירה ברשימה: הפתק שנגרר נכנס לפני או אחרי הפתק שעליו שוחרר (לפי חצי השורה). הפתק שהיה נבחר נשאר נבחר. */
  function reorderMemo(from, to, after) {
    const st = memoStore(); if (from === to || from < 0 || to < 0 || from >= st.memos.length || to >= st.memos.length) return;
    const selected = st.memos[st.idx]; const [item] = st.memos.splice(from, 1);
    let insertAt = to + (after ? 1 : 0); if (from < insertAt) insertAt--;
    st.memos.splice(insertAt, 0, item); st.idx = Math.max(0, st.memos.indexOf(selected));
    if (st.direct) qx.direct.orderDirty = true; st.mark(); render(); markUnsaved();
  }
  /* "נקודה וטאב": השורה מתחילה בנקודה, טאב ואז המשפט — סעיף ברשימה, כמו שהמשתמש כותב בטלפון.
     לחיצה חוזרת על שורה שכבר מעוצבת כך מסירה; "לכל השורות" מוסיף למה שחסר, או מסיר מכולן אם כולן כבר מעוצבות. */
  const BULLET = ".\t";
  const bulletBare = line => line.replace(/^\s+/, ""), bulletHas = line => bulletBare(line).startsWith(BULLET);
  const bulletAdd = line => bulletBare(line) ? BULLET + bulletBare(line) : line, bulletRemove = line => bulletHas(line) ? bulletBare(line).slice(BULLET.length) : line;
  function bulletMemo(all) {
    if (all) editMemoText(true, text => { const lines = text.split("\n"); const filled = lines.filter(l => bulletBare(l)); const allOn = filled.length && filled.every(bulletHas); return lines.map(l => allOn ? bulletRemove(l) : (bulletHas(l) ? l : bulletAdd(l))).join("\n"); });
    else editMemoText(false, line => bulletHas(line) ? bulletRemove(line) : bulletAdd(line));
  }
  function unbulletMemo() { editMemoText(true, text => text.split("\n").map(bulletRemove).join("\n")); }
  async function calibrate() {
    const choice = await A().modal({ kicker: "כיול רוחב", title: "פתק כיול מהטלפון", html: `<p>בטלפון כתבו פתק שבו כל שורה היא אות אחת שחוזרת עד שהשורה מתמלאה (למשל שורה של ש, שורה של ו). הדביקו כאן את הפתק, או בחרו אותו מהרשימה.</p><label class="modal-field">תוכן פתק הכיול<textarea id="qx-cal" rows="6"></textarea></label><label class="modal-field">או פתק קיים<select id="qx-cal-pick"><option value="">—</option>${memoStore().memos.map((m, i) => `<option value="${i}">${esc(m.text.slice(0, 40))}</option>`).join("")}</select></label>`, buttons: [{ id: "go", label: "כיול", primary: true }, { id: "reset", label: "חזרה לברירת המחדל" }, { id: "cancel", label: "ביטול" }] });
    if (choice === "reset") { qx.widths = null; localStorage.removeItem(WIDTH_KEY); return A().toast("טבלת הרוחב חזרה לברירת המחדל"); }
    if (choice !== "go") return;
    const pick = document.getElementById("qx-cal-pick").value; const text = pick !== "" ? memoStore().memos[Number(pick)].text : document.getElementById("qx-cal").value;
    const full = Q.calibrateFromMemo(text, widths()), over = {}; for (const ch of Object.keys(full)) if (full[ch] !== Q.WIDTHS[ch]) over[ch] = full[ch];
    qx.widths = Object.keys(over).length ? over : null; if (qx.widths) localStorage.setItem(WIDTH_KEY, JSON.stringify(qx.widths)); else localStorage.removeItem(WIDTH_KEY);
    memoCounter(); A().toast(qx.widths ? `טבלת הרוחב עודכנה (${Object.keys(qx.widths).length} תווים כוילו)` : "לא נמצאו שורות כיול בפתק");
  }

  /* ---------- לוח שנה ----------
     אירוע חוזר נכתב לטלפון כסדרה של אירועים נפרדים (כך גם המשתמש עצמו רשם סדרות בטלפון),
     ולכן אינו תלוי בשדה החזרה הפנימי של הטלפון, שמשמעותו עדיין לא אומתה. */
  const localIso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  /* תאריך עברי: הלוח העברי של הדפדפן (ICU), והמספרים באותיות */
  const HEB_FMT = (() => { try { return new Intl.DateTimeFormat("he-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric" }); } catch (_) { return null; } })();
  function gematria(n) {
    n = Number(n) || 0; if (n <= 0) return String(n); if (n >= 1000) n %= 1000;
    const H = [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"], [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"], [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]];
    let s = "", rest = n; if (rest % 100 === 15) { s = "טו"; rest -= 15; } else if (rest % 100 === 16) { s = "טז"; rest -= 16; }
    let pre = ""; for (const [v, l] of H) while (rest >= v) { pre += l; rest -= v; }
    s = pre + s; return s.length === 1 ? s + "׳" : s.slice(0, -1) + "״" + s.slice(-1);
  }
  function hebParts(dt) { if (!HEB_FMT) return null; try { const p = {}; for (const part of HEB_FMT.formatToParts(dt)) p[part.type] = part.value; return { day: parseInt(p.day, 10), month: String(p.month || "").replace(/^ב/, ""), year: parseInt(p.year, 10) }; } catch (_) { return null; } }
  const hebDay = dt => { const p = hebParts(dt); return p ? `${gematria(p.day)} ${p.month}` : ""; };
  const hebRange = (a, b) => { const pa = hebParts(a), pb = hebParts(b); if (!pa || !pb) return ""; return (pa.month === pb.month ? pa.month : `${pa.month}–${pb.month}`) + " " + (pa.year === pb.year ? gematria(pa.year) : `${gematria(pa.year)}–${gematria(pb.year)}`); };
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

  /* ---------- ניהול פתקים ישיר: תיקיית Memo של הכרטיס ----------
     הטלפון קורא את הפתקים מהתיקייה הזו עצמה, ולכן מה שנכתב כאן מופיע בטלפון מיד כשמחזירים את הכרטיס —
     בלי גיבוי, בלי שחזור, ובלי הבעיה של פתק שנערך ושמו לא השתנה. */
  async function openDirectMemos() {
    if (!qx.adapter || qx.layout.mode !== "card") return A().toast("ניהול פתקים עובד רק כשנבחר הכרטיס עצמו (שיש בו תיקיית Memo)", "warning");
    if (!qx.direct) {
      setBusy("קורא את הפתקים מהכרטיס…");
      try {
        const rootEntries = await qx.adapter.list("");
        let rel = rootEntries.find(e => e.kind === "directory" && e.name.toLowerCase() === "memo")?.name;
        if (!rel) { rel = "Memo"; await qx.adapter.mkdir(rel); }
        const files = (await qx.adapter.list(rel)).filter(e => e.kind === "file" && /\.txt$/i.test(e.name));
        const memos = [];
        for (const f of files) { try { const bytes = await qx.adapter.read(join(rel, f.name)); memos.push({ fileName: f.name, bytes, text: Q.parseMemo(bytes), created: Q.memoDateFromName(f.name), modified: f.mtime ? new Date(f.mtime).toISOString().slice(0, 19) : Q.memoDateFromName(f.name) }); } catch (_) { } }
        memos.sort((a, b) => String(b.modified || "").localeCompare(String(a.modified || "")));
        qx.direct = { rel, memos, idx: 0, dirty: false, removed: [], orderDirty: false };
      } catch (error) { console.error(error); A().toast("לא הצלחנו לקרוא את תיקיית הפתקים", "error"); return; }
      finally { setBusy(""); }
    }
    qx.view = "memos-direct";
    // "ניהול פתקים" הוא עמוד משלו בתפריט הראשי; מכל מקום אחר עוברים אליו, ו-setPage("memos") חוזר לכאן דרך showMemos
    if (document.getElementById("app-shell")?.dataset.activePage !== "memos") return A().setPage("memos");
    render();
  }
  /* פריט "ניהול פתקים" בתפריט הראשי: בלי כרטיס מציג את מסך החיבור (ובתוכנה מנסה לזהות כרטיס לבד). */
  async function showMemos() {
    if (!qx.adapter && window.electronAPI?.qualix) await detectCards(true);
    if (!qx.adapter || qx.layout.mode !== "card") { qx.view = "versions"; render(); if (qx.adapter) A().toast("ניהול פתקים עובד רק כשנבחר הכרטיס עצמו (שיש בו תיקיית Memo)", "warning"); return; }
    return openDirectMemos();
  }
  /* הסדר בטלפון = זמן השינוי של הקבצים, החדש למעלה. העליון ברשימה מקבל את הזמן החדש ביותר וכל פתק מתחתיו
     שתי שניות פחות (FAT שומר זמן ברזולוציה של 2 שניות). בלי שליטה בזמני הקבצים (באתר, בלי התוכנה) כותבים
     מחדש מהתחתון לעליון בהפרש של שתי שניות — איטי, ולכן רק כשהסדר באמת שונה. */
  async function applyMemoOrder(rel, memos) {
    const n = memos.length, base = Date.now();
    if (qx.adapter.utimes) { for (let k = 0; k < n; k++) { const ms = base - k * 2000; await qx.adapter.utimes(join(rel, memos[k].fileName), ms); memos[k].modified = new Date(ms).toISOString().slice(0, 19); } return; }
    for (let k = n - 1; k >= 0; k--) { const m = memos[k]; setBusy(`מסדר את הפתקים לפי הסדר שבחרתם… ${n - k}/${n}`); await qx.adapter.write(join(rel, m.fileName), m.bytes || Q.buildMemo(m.text)); m.modified = new Date().toISOString().slice(0, 19); if (k > 0) await new Promise(r => setTimeout(r, 2100)); }
  }
  async function saveDirectMemos() {
    const d = qx.direct; if (!d) return;
    const changed = d.memos.filter(m => m._dirty), removed = d.removed.slice();
    if (!changed.length && !removed.length && !d.orderDirty) return A().toast("אין שינויים לשמירה");
    setBusy("כותב את הפתקים לכרטיס…");
    try {
      for (const name of removed) { try { await qx.adapter.remove(join(d.rel, name)); } catch (_) { } }
      for (const m of changed) { const bytes = Q.buildMemo(m.text); await qx.adapter.write(join(d.rel, m.fileName), bytes); m.bytes = bytes; m._dirty = false; m._new = false; m.modified = new Date().toISOString().slice(0, 19); }
      // עם שליטה בזמני הקבצים הסדר נכתב בכל שמירה (זול); בלעדיה רק כשהוזז פתק, ופתק שנערך עולה למעלה כמו בטלפון
      if (d.orderDirty || (changed.length && qx.adapter.utimes)) await applyMemoOrder(d.rel, d.memos);
      d.orderDirty = false; d.removed = []; d.dirty = false;
      d.memos.sort((a, b) => String(b.modified || "").localeCompare(String(a.modified || "")));
      render(); A().toast(`נשמר לכרטיס: ${changed.length} פתקים${removed.length ? `, נמחקו ${removed.length}` : ""}. החזירו את הכרטיס לטלפון — בלי שחזור.`);
    } catch (error) { console.error(error); A().toast("הכתיבה לכרטיס נכשלה: " + (error.message || error), "error"); }
    finally { setBusy(""); }
  }
  function directView() {
    const d = qx.direct;
    const head = `<div class="qx-head"><div><h2>✎ ניהול פתקים</h2><div class="qx-sub">תיקיית Memo בכרטיס · ${d.memos.length} פתקים</div></div><div class="spacer"></div><button class="btn btn-quiet btn-sm" data-qx="direct-reload">↻ קריאה מחדש מהכרטיס</button><button class="btn btn-quiet btn-sm" data-qx="to-versions">← גיבוי קיוליקס</button></div>`;
    const info = `<div class="qx-help"><b>איך זה עובד:</b> הפתקים שבטלפון הם קבצי טקסט בתיקיית Memo של הכרטיס. מה שעורכים כאן נכתב ישירות לשם, ולכן אחרי “שמירה לטלפון” והחזרת הכרטיס הפתקים מעודכנים מיד — בלי גיבוי ובלי שחזור. אם אותו פתק נערך גם בטלפון, הכתיבה האחרונה קובעת.</div>`;
    const save = `<div class="qx-save"><button class="btn btn-primary" data-qx="direct-save">💾 שמירה לטלפון</button><span id="qx-save-state" class="${d.dirty ? "qx-dirty" : "qx-note"}">${d.dirty ? "יש שינויים שלא נשמרו" : "אין שינויים"}</span></div>`;
    return head + info + memosTab() + save;
  }

  /* ---------- הגיבויים בשרת ----------
     כל גיבוי שבכרטיס מועלה לדרייב של המשתמש דרך השרת, כך שהוא שמור גם אם הכרטיס נפגע או אובד. ההעלאה
     רצה ברקע אחרי חיבור הכרטיס, קובץ-קובץ ודחוס ב-gzip (ספר טלפונים הוא בעיקר אפסים). דורש כניסה עם Google. */
  const cloudUser = () => (A().currentUser ? A().currentUser() : null);
  function toBase64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function fromBase64(text) { const s = atob(text); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  async function gzipBytes(bytes) { if (typeof CompressionStream === "undefined") return null; return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()); }
  async function gunzipBytes(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()); }
  const renderIfVersions = () => { if (qx.view === "versions") render(); else renderSubnav(); };
  async function loadCloud() {
    if (!cloudUser()) { qx.cloud.loaded = false; qx.cloud.versions = []; return; }
    try { const data = await A().api("qualixList"); qx.cloud.versions = data.versions || []; qx.cloud.loaded = true; qx.cloud.error = ""; }
    catch (error) { qx.cloud.error = error.message || String(error); qx.cloud.loaded = true; }
  }
  async function syncCloud(force) {
    if (!qx.adapter || qx.layout.mode === "single" || !cloudUser()) { renderIfVersions(); return; }
    await loadCloud(); renderIfVersions();
    if (!qx.cloud.error || force) await uploadPending(false);
  }
  /* מה עולה לבד: רק הגיבוי המלא האחרון (הכי הרבה קטגוריות, ובשוויון — החדש ביותר). כל השאר רק כשהמשתמש
     מבקש — "העלה את כל השאר" בשורת השרת, או "העלאה לשרת" בתפריט של גרסה. */
  function pendingUploads() { const have = new Set(qx.cloud.versions.map(v => v.folder)); return qx.backups.filter(b => isBackupName(b.folder) && !have.has(b.folder)); }
  function latestFull(list) { return list.slice().sort((a, b) => (b.categories.length - a.categories.length) || b.folder.localeCompare(a.folder))[0] || null; }
  async function uploadPending(explicit) {
    if (qx.cloud.uploading || !cloudUser()) return;
    const pending = pendingUploads();
    if (!pending.length) { if (explicit) A().toast("כל הגיבויים שבכרטיס כבר בשרת"); return; }
    /* לבד עולה רק הגיבוי המלא האחרון מבין כל הגיבויים בכרטיס. אם הוא כבר בשרת — לא מעלים את הבא בתור
       (כך עלה גיבוי ישן נוסף בכל סנכרון); השאר רק בלחיצה. */
    const newestFull = latestFull(qx.backups.filter(b => isBackupName(b.folder)));
    if (!explicit && (!newestFull || !pending.some(b => b.folder === newestFull.folder))) return;
    const todo = explicit ? pending : [newestFull];
    A().toast(explicit ? `מעלה ${todo.length} גיבויים לשרת ברקע — אפשר להמשיך לעבוד` : `מעלה לשרת את הגיבוי המלא האחרון (${folderDate(todo[0].folder)}) ברקע — אפשר להמשיך לעבוד`);
    for (const bk of todo) { if (!(await uploadVersion(bk.folder, true))) break; }
    if (!qx.cloud.error) A().toast(explicit ? "כל הגיבויים שבכרטיס שמורים עכשיו גם בשרת" : `הגיבוי ${folderDate(todo[0].folder)} שמור בשרת`);
  }
  async function uploadVersion(folder, quiet) {
    const bk = qx.backups.find(b => b.folder === folder); if (!bk || !cloudUser()) return false;
    if (qx.cloud.uploading) { A().toast("העלאה אחרת עדיין רצה", "warning"); return false; }
    qx.cloud.uploading = folderDate(folder); qx.cloud.error = ""; renderIfVersions();
    try {
      const files = (await qx.adapter.list(bk.rel)).filter(e => e.kind === "file");
      const existing = new Map((qx.cloud.versions.find(v => v.folder === folder)?.files || []).map(f => [f.name, f.size]));
      let n = 0;
      for (const f of files) {
        n++; qx.cloud.uploading = `${folderDate(folder)} · ${n}/${files.length}`; setBusy(`מעלה לשרת: ${qx.cloud.uploading}`);
        if (existing.get(f.name) === f.size) continue; // כבר בשרת, באותו גודל
        const bytes = await qx.adapter.read(join(bk.rel, f.name));
        const packed = await gzipBytes(bytes); const data = toBase64(packed || bytes);
        if (data.length > 5500000) throw new Error(`הקובץ ${f.name} גדול מדי להעלאה`);
        await A().api("qualixPut", { folder, name: f.name, data, gzip: !!packed });
      }
      qx.cloud.versions = [{ folder, files: files.map(f => ({ name: f.name, size: f.size })), updatedAt: new Date().toISOString() }, ...qx.cloud.versions.filter(v => v.folder !== folder)];
      if (!quiet) A().toast(`הגיבוי ${folderDate(folder)} שמור בשרת`);
      return true;
    } catch (error) { console.error(error); qx.cloud.error = error.message || String(error); A().toast("ההעלאה לשרת נכשלה: " + qx.cloud.error, "error"); return false; }
    finally { qx.cloud.uploading = ""; setBusy(""); renderIfVersions(); }
  }
  async function downloadVersion(folder) {
    const v = qx.cloud.versions.find(x => x.folder === folder); if (!v) return;
    if (!qx.layout?.canSave) return A().toast("כדי להוריד לכרטיס בחרו את הכרטיס עצמו או את תיקיית ibphone", "warning");
    const rel = join(qx.layout.ibphoneRel, folder);
    if (await qx.adapter.exists(rel) && !(await A().confirmBox("הגיבוי כבר בכרטיס", `התיקייה ${folderDate(folder)} כבר קיימת בכרטיס. להחליף את הקבצים שבה בעותק מהשרת?`, "החלפה"))) return;
    setBusy(`מוריד מהשרת: ${folderDate(folder)}…`);
    try {
      await qx.adapter.mkdir(rel); let n = 0;
      for (const f of v.files) { n++; setBusy(`מוריד מהשרת: ${folderDate(folder)} · ${n}/${v.files.length}`); const got = await A().api("qualixGet", { folder, name: f.name }); let bytes = fromBase64(got.data); if (got.gzip) bytes = await gunzipBytes(bytes); await qx.adapter.write(join(rel, f.name), bytes); }
      await loadBackups(); render(); A().toast(`הגיבוי ${folderDate(folder)} ירד לכרטיס. בטלפון: גיבוי ושחזור ← שחזור.`);
    } catch (error) { console.error(error); A().toast("ההורדה מהשרת נכשלה: " + (error.message || error), "error"); }
    finally { setBusy(""); }
  }
  async function cloudMenu(folder) {
    const v = qx.cloud.versions.find(x => x.folder === folder); if (!v) return;
    const onCard = qx.backups.some(b => b.folder === folder), total = v.files.reduce((n, f) => n + (f.size || 0), 0);
    const choice = await A().modal({ kicker: "גיבוי בשרת", title: folderDate(folder), html: `<p dir="ltr" style="text-align:right">${esc(folder)}</p><p class="qx-note">${v.files.length} קבצים · ${fmtSize(total)}${onCard ? " · נמצא גם בכרטיס" : " · רק בשרת"}</p>`, buttons: [...(onCard ? [] : [{ id: "download", label: "הורדה לכרטיס", primary: true }]), { id: "delete", label: "מחיקה מהשרת" }, { id: "cancel", label: "סגירה" }] });
    if (choice === "download") return downloadVersion(folder);
    if (choice !== "delete") return;
    if (!(await A().confirmBox("מחיקה מהשרת", `למחוק את הגיבוי ${folderDate(folder)} מהשרת?${onCard ? " העותק שבכרטיס נשאר." : " זה העותק היחיד שלו!"}`, "מחיקה"))) return;
    setBusy("מוחק מהשרת…");
    try { await A().api("qualixDelete", { folder }); qx.cloud.versions = qx.cloud.versions.filter(x => x.folder !== folder); render(); A().toast("הגיבוי נמחק מהשרת"); }
    catch (error) { A().toast("המחיקה נכשלה: " + (error.message || error), "error"); }
    finally { setBusy(""); }
  }
  function cloudBarHtml() {
    const user = cloudUser();
    if (!user) return `<div class="qx-cloud off"><i>☁</i><div><strong>הגיבויים נשמרים כרגע רק בכרטיס.</strong><span>כניסה עם Google שומרת כל גיבוי גם בשרת, כך שהוא לא הולך לאיבוד אם הכרטיס נפגע או אובד.</span></div><div class="spacer"></div><button class="btn btn-secondary btn-sm" data-qx="cloud-login">כניסה עם Google</button></div>`;
    const pending = pendingUploads().length;
    const state = qx.cloud.uploading ? `מעלה לשרת: ${esc(qx.cloud.uploading)}` : qx.cloud.error ? `ההעלאה נכשלה: ${esc(qx.cloud.error)}` : !qx.cloud.loaded ? "בודק מה כבר בשרת…" : pending ? `${pending} גיבויים מהכרטיס לא בשרת. לבד עולה רק הגיבוי המלא האחרון; את השאר מעלים לפי בחירה (כאן או בתפריט ⋮ של הגרסה)` : "כל הגיבויים שבכרטיס שמורים גם בשרת";
    return `<div class="qx-cloud on"><i>☁</i><div><strong>השרת · ${esc(user.email)}</strong><span>${state}</span></div><div class="spacer"></div>${pending && !qx.cloud.uploading && qx.cloud.loaded ? `<button class="btn btn-secondary btn-sm" data-qx="cloud-upload-all">העלה את כל השאר (${pending})</button>` : ""}<button class="btn btn-quiet btn-sm" data-qx="cloud-refresh">רענון</button></div>`;
  }

  /* ---------- ייבוא קטגוריה מגרסה אחרת ----------
     בראש כל קטגוריה: אילו גיבויים אחרים בכרטיס מכילים אותה (לפי ibphone_head.in), תצוגה מקדימה של הנתונים
     שלהם, וייבוא לגרסה הפתוחה — החלפה או הוספה (בלי כפולים). גרסה נקראת פעם אחת ונשמרת בזיכרון. */
  const IMPORT_CATS = {
    phonebook: { label: "אנשי קשר", pick: d => d.contacts || [] }, callog: { label: "שיחות", pick: d => d.callog?.entries || [] },
    memo: { label: "פתקים", pick: d => d.memos || [] }, schedule: { label: "אירועים", pick: d => d.events || [] },
    playlist: { label: "רשימות השמעה", pick: d => d.playlists || [] }, udb: { label: "מילים לחיזוי", pick: d => (d.dictionary?.words || []).filter((w, i, a) => a.indexOf(w) === i) }
  };
  const versionCache = new Map();
  async function loadVersionData(folder) {
    if (versionCache.has(folder)) return versionCache.get(folder);
    const bk = qx.backups.find(b => b.folder === folder); if (!bk) throw new Error("הגרסה לא נמצאה בכרטיס");
    const names = (await qx.adapter.list(bk.rel)).filter(e => e.kind === "file").map(e => e.name);
    const data = await Q.readBackup({ folder: bk.folder, listFiles: async () => names, readFile: n => qx.adapter.read(join(bk.rel, n)) });
    versionCache.set(folder, data); return data;
  }
  function importSources(cat) { return qx.backups.filter(b => isBackupName(b.folder) && b.folder !== qx.open?.folder && b.categories.includes(cat)); }
  function importBarHtml(cat, currentCount) {
    if (!qx.open || !qx.layout || qx.layout.mode === "single") return "";
    const sources = importSources(cat); if (!sources.length) return "";
    const meta = IMPORT_CATS[cat];
    return `<div class="qx-import-bar"><i>⇩</i><span>${currentCount ? `להביא ${meta.label} מגרסה אחרת?` : `<b>בגרסה הזו אין ${meta.label}.</b> אפשר להביא מגרסה אחרת שיש בה:`}</span><select id="qx-import-src-${cat}">${sources.map(b => `<option value="${esc(b.folder)}">${esc(folderDate(b.folder))}</option>`).join("")}</select><button class="btn btn-quiet btn-sm" data-qx="import-preview" data-cat="${cat}">תצוגה מקדימה</button><button class="btn btn-secondary btn-sm" data-qx="import-apply" data-cat="${cat}">ייבוא לגרסה הזו</button></div>`;
  }
  function importPreviewRows(cat, items) {
    const row = (a, b) => `<div class="modal-list-row"><span>${esc(a)}</span><b dir="auto">${esc(b)}</b></div>`;
    if (cat === "phonebook") return items.map(c => row(c.name || "ללא שם", [c.mobile, c.home, c.work].filter(Boolean).join(" · ") + (c.group ? " · " + c.group : "")));
    if (cat === "callog") return items.map(e => row((Q.CALL_TYPE_HE[e.type] || e.type) + ` (${e.calls.length})`, e.number));
    // פתק מוצג במלואו (לא רק השורה הראשונה) — זו המטרה של התצוגה המקדימה
    if (cat === "memo") return items.map(m => `<div class="modal-list-row qx-memo-preview"><span>${esc(m.created ? m.created.slice(0, 10).split("-").reverse().join(".") : "")}<br><small>${m.text.length} תווים</small></span><b dir="auto" style="white-space:pre-wrap;font-weight:500">${esc(m.text) || "(ריק)"}</b></div>`);
    if (cat === "schedule") return items.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(e => row(e.date.split("-").reverse().join(".") + " " + e.time, e.title));
    if (cat === "playlist") return items.map(p => row(p.entries.length + " שירים", p.name.replace(/\.lst$/i, "")));
    if (cat === "udb") return [row("מילים", items.join(", "))];
    return [];
  }
  async function importPreview(cat) {
    const folder = document.getElementById(`qx-import-src-${cat}`)?.value; if (!folder) return;
    setBusy("קורא את הגרסה…");
    try {
      const data = await loadVersionData(folder); const items = IMPORT_CATS[cat].pick(data); setBusy("");
      const rows = importPreviewRows(cat, items.slice(0, 80));
      const choice = await A().modal({ kicker: `${IMPORT_CATS[cat].label} בגרסה ${folderDate(folder)}`, title: `${items.length} ${IMPORT_CATS[cat].label}`, html: `<div class="modal-list">${rows.join("") || `<div class="modal-list-row"><span>ריק</span><b>אין נתונים</b></div>`}</div>${items.length > 80 ? `<p class="qx-note">מוצגים 80 הראשונים מתוך ${items.length}.</p>` : ""}`, buttons: [{ id: "import", label: "ייבוא לגרסה הפתוחה", primary: true }, { id: "close", label: "סגירה" }] });
      if (choice === "import") await importApply(cat, folder);
    } catch (error) { A().toast("לא הצלחנו לקרוא את הגרסה: " + (error.message || error), "error"); } finally { setBusy(""); }
  }
  async function importApply(cat, folder) {
    folder = folder || document.getElementById(`qx-import-src-${cat}`)?.value; if (!folder || !qx.open) return;
    const d = qx.open.data, meta = IMPORT_CATS[cat], current = meta.pick(d).length;
    const mode = current ? await A().modal({ kicker: "ייבוא מגרסה", title: `${meta.label} מהגרסה ${folderDate(folder)}`, html: `<p>בגרסה הפתוחה יש כבר ${current} ${meta.label}. איך להכניס את הנתונים?</p><p class="qx-note">בהוספה, פריט שכבר קיים (אותו שם קובץ / אותו אירוע / אותו מספר) לא נכנס פעמיים.</p>`, buttons: [{ id: "add", label: "להוסיף לקיימים", primary: true }, { id: "replace", label: "להחליף את הקיימים" }, { id: "cancel", label: "ביטול" }] }) : "replace";
    if (mode === "cancel") return;
    setBusy("מייבא…");
    try {
      const items = meta.pick(await loadVersionData(folder)); let n = 0;
      if (cat === "phonebook") { const incoming = items.map(c => Object.assign({}, c, { _raw: undefined, _dirty: true })); if (mode === "replace") d.contacts = incoming; else d.contacts.push(...incoming); n = incoming.length; }
      if (cat === "schedule") { const key = e => e.date + "|" + e.time + "|" + e.title; const have = new Set(mode === "replace" ? [] : d.events.map(key)); const incoming = items.filter(e => !have.has(key(e))).map(e => Object.assign({}, e, { _raw: undefined, _dirty: true })); if (mode === "replace") d.events = incoming; else d.events.push(...incoming); n = incoming.length; }
      if (cat === "memo") { const have = new Set(mode === "replace" ? [] : d.memos.map(m => m.fileName)); const incoming = items.filter(m => !have.has(m.fileName)).map(m => Object.assign({}, m, { _dirty: true })); if (mode === "replace") d.memos = incoming; else d.memos.unshift(...incoming); n = incoming.length; }
      if (cat === "callog") { const incoming = items.map(e => Object.assign({}, e, { _raw: undefined, _dirty: true })); if (mode === "replace") d.callog.entries = incoming; else for (const e of incoming) { const cur = d.callog.entries.find(x => x.number === e.number && x.type === e.type); if (cur) { cur.calls = cur.calls.concat(e.calls).sort((a, b) => a.time - b.time).slice(-10); cur._dirty = true; } else d.callog.entries.push(e); } n = incoming.length; }
      if (cat === "playlist") { const incoming = items.map(p => Object.assign({}, p, { _dirty: true })); if (mode === "replace") d.playlists = incoming; else for (const p of incoming) { const k = d.playlists.findIndex(x => x.name === p.name); if (k >= 0) d.playlists[k] = p; else d.playlists.push(p); } n = incoming.length; }
      if (cat === "udb") { for (const w of items) if (pushWord(w) === true) n++; }
      if (n) dirty(cat);
      render(); A().toast(n ? `יובאו ${n} ${meta.label} מהגרסה ${folderDate(folder)}. לחצו “שמירה כגרסה חדשה” כדי לכתוב לכרטיס.` : `אין ${meta.label} חדשים לייבא — הכול כבר קיים בגרסה`);
    } catch (error) { A().toast("הייבוא נכשל: " + (error.message || error), "error"); } finally { setBusy(""); }
  }

  /* ---------- ציור ---------- */
  function setBusy(text) { qx.busy = text; const el = document.getElementById("qx-busy"); if (el) { el.textContent = text; el.classList.toggle("hidden", !text); } }
  function render() {
    const root = document.getElementById("qualix-root"); if (!root) return;
    const navCount = document.getElementById("nav-qualix-count"); if (navCount) navCount.textContent = qx.backups.length || "";
    const memoCount = document.getElementById("nav-memos-count"); if (memoCount) memoCount.textContent = qx.direct ? qx.direct.memos.length + (qx.direct.dirty ? " ●" : "") : "";
    const editing = qx.open && qx.view === "editor", direct = qx.view === "memos-direct" && !!qx.direct;
    // שורת המקור (כרטיס, בחירת תיקייה) שייכת לעמוד הגרסאות בלבד; בתוך קטגוריה היא רק רעש
    root.innerHTML = (editing || direct ? "" : sourceBar()) + (direct ? directView() : editing ? openView() : (qx.adapter ? versionsView() : introView())) + `<div id="qx-busy" class="qx-warn ${qx.busy ? "" : "hidden"}" style="position:fixed;bottom:18px;right:50%;transform:translateX(50%);z-index:60">${esc(qx.busy)}</div>`;
    if (!editing && !direct && document.getElementById("app-shell")?.dataset.activePage === "qualix") { const kicker = document.getElementById("page-kicker"), title = document.getElementById("page-title"); if (kicker && title) { kicker.textContent = "הטלפון הכשר"; title.textContent = "גיבוי קיוליקס"; } }
    renderSubnav(); qx.rendered = true; memoCounter();
  }
  const DIRTY_KEY = { contacts: "phonebook", calls: "callog", memos: "memo", calendar: "schedule", playlists: "playlist", dictionary: "udb", settings: "settings" };
  function tabCounts(d) { return { contacts: d.contacts.length, calls: d.callog.entries.reduce((n, e) => n + e.calls.length, 0), memos: d.memos.length, calendar: d.events.length, playlists: d.playlists.length, dictionary: d.dictionaryWords.length, settings: d.settings ? 1 : 0 }; }
  /* הקטגוריות של הגרסה הפתוחה יושבות בתפריט הצד, מתחת לכותרת "גיבוי קיוליקס"; בלי גרסה פתוחה הן מוסתרות. */
  /* "ניהול פתקים" (תיקיית Memo של הכרטיס) מופיע ברגע שנבחר כרטיס, גם בלי גרסה פתוחה; מתחתיו הקטגוריות של הגרסה. */
  function renderSubnav() {
    const nav = document.getElementById("qualix-subnav"); if (!nav) return;
    const page = document.getElementById("app-shell")?.dataset.activePage, onPage = page === "qualix";
    // הקטגוריות מוצגות רק באזור הגיבוי (גיבוי קיוליקס / ניהול פתקים) — בשאר העמודים הן רק מעמיסות על התפריט
    if (!qx.open || (page !== "qualix" && page !== "memos")) { nav.classList.add("hidden"); nav.innerHTML = ""; return; }
    const counts = tabCounts(qx.open.data), editing = onPage && qx.view === "editor";
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
    const bar = qx.layout.mode === "single" ? "" : cloudBarHtml();
    const cloudBy = new Map(qx.cloud.versions.map(v => [v.folder, v])), onCard = new Set(qx.backups.map(b => b.folder));
    const cloudOnly = qx.cloud.versions.filter(v => !onCard.has(v.folder));
    if (!qx.backups.length && !cloudOnly.length) return bar + `<div class="empty-box"><div class="empty-icon">☏</div><h3>אין גיבויים בתיקייה</h3><p>עשו גיבוי בטלפון (גיבוי ושחזור ← גיבוי) ונסו שוב.</p><button class="btn btn-primary" data-qx="new-version">גרסה חדשה מרשימה או מקובץ</button></div>`;
    // כרטיס גרסה כמו כרטיס רשימה: לחיצה על הכרטיס פותחת, ⋮ לשאר הפעולות, ו-✓/✕ לכל קטגוריה
    const cur = qx.open && !qx.open.isNew ? qx.open.folder : null;
    const cats = has => `<ul class="qx-cats">${Object.keys(CAT_HE).map(k => `<li class="${has(k) ? "on" : "off"}"><i>${has(k) ? "✓" : "✕"}</i>${CAT_HE[k]}</li>`).join("")}</ul>`;
    // מאיפה הגרסה — הכרטיס, השרת או שניהם — כדי שיהיה ברור מה שמור איפה
    const where = (card, cloud) => `<div class="qx-where">${card ? `<span class="qx-badge card">▮ בכרטיס</span>` : ""}${cloud ? `<span class="qx-badge cloud">☁ בשרת</span>` : cloudUser() && qx.cloud.loaded ? `<span class="qx-badge off">לא בשרת</span>` : ""}</div>`;
    const cards = qx.backups.map(b => { const isCur = cur === b.folder; return `<article class="qx-version ${isCur ? "current" : ""}"><button class="qx-open" data-qx="open" data-folder="${esc(b.folder)}" aria-label="פתיחת ${esc(folderDate(b.folder))}"></button><button class="icon-btn qx-menu" data-qx="version-menu" data-folder="${esc(b.folder)}" aria-label="אפשרויות">⋮</button>${versionName(b.folder) ? `<h3 class="qx-vname">${esc(versionName(b.folder))}</h3><div class="qx-when">${esc(folderDate(b.folder))}</div>` : `<h3>${esc(folderDate(b.folder))}</h3>`}<div class="qx-when" dir="ltr">${esc(b.folder)}</div>${where(true, cloudBy.has(b.folder))}${isCur ? `<div class="qx-state">${qx.open.dirty.size ? "● פתוחה, עם שינויים שלא נשמרו" : "● פתוחה לעריכה"}</div>` : ""}${cats(k => b.categories.includes(k))}</article>`; }).join("");
    const remote = cloudOnly.map(v => `<article class="qx-version cloud-only"><button class="icon-btn qx-menu" data-qx="cloud-menu" data-folder="${esc(v.folder)}" aria-label="אפשרויות">⋮</button><h3>${esc(folderDate(v.folder))}</h3><div class="qx-when" dir="ltr">${esc(v.folder)}</div>${where(false, true)}<p class="qx-note" style="margin:0">${v.files.length} קבצים · ${fmtSize(v.files.reduce((n, f) => n + (f.size || 0), 0))} · רק בשרת</p><div class="qx-row"><button class="btn btn-secondary btn-sm" data-qx="cloud-download" data-folder="${esc(v.folder)}">⇩ הורדה לכרטיס</button></div></article>`).join("");
    const unsavedNew = qx.open?.isNew ? `<article class="qx-version current"><button class="qx-open" data-qx="resume" aria-label="המשך עריכה"></button><h3>גרסה חדשה</h3><div class="qx-state">● ${qx.open.dirty.size ? "עדיין לא נשמרה" : "ריקה"}</div>${cats(k => hasCategory(qx.open.data, k))}</article>` : "";
    return bar + `<div class="page-intro"><div><h2>הגרסאות</h2><p>כל גיבוי שהטלפון עשה, כל גרסה ששמרתם מכאן, וכל גיבוי ששמור בשרת. לחיצה על גרסה פותחת אותה, והקטגוריות שלה מופיעות בתפריט הצד.</p></div><div class="intro-actions"><button class="btn btn-primary" data-qx="new-version">＋ גרסה חדשה</button></div></div><div class="qx-versions">${unsavedNew}${cards}${remote}</div>`;
  }
  function openView() {
    const o = qx.open;
    const body = { contacts: contactsTab, calls: callsTab, memos: memosTab, calendar: calendarTab, playlists: playlistsTab, dictionary: dictionaryTab, settings: settingsTab }[qx.tab]();
    const tab = TABS.find(t => t[0] === qx.tab) || TABS[0];
    const head = `<div class="qx-head"><div><h2>${tab[2]} ${tab[1]}</h2><div class="qx-sub">${o.isNew ? "גרסה חדשה — עדיין לא נשמרה. בסיום העריכה לחצו שמירה." : `גרסה ${esc(versionLabel(o.folder))} · ${esc(o.folder)}`}</div></div><div class="spacer"></div><span class="qx-note">הקטגוריות בתפריט הצד</span></div>`;
    const save = `<div class="qx-save"><button class="btn btn-primary" data-qx="save" ${qx.layout.canSave ? "" : "disabled"}>💾 שמירה כגרסה חדשה</button><span id="qx-save-state" class="${o.dirty.size ? "qx-dirty" : "qx-note"}">${o.dirty.size ? "יש שינויים שלא נשמרו" : "אין שינויים"}</span>${qx.layout.canSave ? "" : `<span class="qx-note">נבחר גיבוי בודד — כדי לשמור בחרו את הכרטיס או את תיקיית ibphone</span>`}</div>`;
    return head + body + save;
  }
  /* אנשי הקשר מוצגים באותם כרטיסים צבעוניים כמו במסך אנשי הקשר הרגיל — אותו גוון לכל שם, אותן שורות. */
  const FIELD_HE = { mobile: "נייד", home: "בית", work: "עבודה", fax: "פקס" };
  function filteredQxContacts() {
    const d = qx.open.data, q = qx.search.trim().toLowerCase(), qDigits = q.replace(/\D/g, "");
    return d.contacts.map((c, i) => ({ c, i })).filter(({ c }) => !q || [c.name, c.email, c.note, c.group].some(v => String(v || "").toLowerCase().includes(q)) || (qDigits && Q.SLOT_FIELDS.some(f => String(c[f] || "").replace(/\D/g, "").includes(qDigits))));
  }
  /* כרטיס איש קשר. selectable: עם תיבת סימון וגרירה (תצוגת הקבוצות). */
  function contactCardHtml(c, i, selectable) {
    const name = c.name || "ללא שם";
    const phones = Q.SLOT_FIELDS.filter(f => c[f]).map(f => `<div class="contact-line ${f}"><b>${FIELD_HE[f]}</b><span dir="ltr">${esc(c[f])}</span></div>`).join("");
    const ring = c.ringtone === Q.RINGTONE_FILE ? "♪ " + ((c.ringtonePath || "").split("\\").pop() || "קובץ מהכרטיס") : c.ringtone ? "♪ צלצול מובנה " + c.ringtone : "";
    return `<article class="contact-card ${selectable && qx.selected.has(i) ? "selected" : ""}" style="--tint:${A().avatarHue(name)}" data-qx="edit-contact" data-i="${i}" role="button" tabindex="0" ${selectable ? `draggable="true" data-drag-i="${i}"` : ""}>`
      + (selectable ? `<input type="checkbox" class="contact-select" data-qx-select="${i}" ${qx.selected.has(i) ? "checked" : ""} aria-label="סימון ${esc(name)}">` : "")
      + `<div class="contact-head"><span class="contact-avatar">${esc(A().initialOf(name))}</span><h3>${esc(name)}</h3></div>` + phones
      + (c.email ? `<div class="contact-line email-line"><b>מייל</b><span dir="auto">${esc(c.email)}</span></div>` : "")
      + (c.note ? `<div class="contact-line note-line"><b>הערה</b><span class="contact-note">${esc(c.note)}</span></div>` : "")
      + (c.group || ring ? `<div class="contact-line note-line"><b>קיוליקס</b><span class="contact-note">${esc([c.group, ring].filter(Boolean).join(" · "))}</span></div>` : "")
      + `<div class="card-actions"><button class="icon-btn" aria-label="עריכה">✎</button></div></article>`;
  }
  function contactsListHtml() {
    const rows = filteredQxContacts(); const d = qx.open.data;
    const cards = rows.slice(0, 1500).map(({ c, i }) => contactCardHtml(c, i, false)).join("");
    return `<p class="qx-note" style="margin:0 0 10px">${rows.length} מתוך ${d.contacts.length}${rows.length > 1500 ? " · מוצגים 1500 הראשונים, השתמשו בחיפוש" : ""}</p><div class="contact-grid">${cards || `<div class="empty-box"><div class="empty-icon">◫</div><h3>אין אנשי קשר</h3></div>`}</div>`;
  }
  /* המשתמש שאל "איך זה עובד": שלוש הדרכים לערוך את אנשי הקשר של הגיבוי, והמסלול דרך אנק״ל וחזרה. */
  function contactsGuide() {
    return `<details class="qx-help" open><summary>איך עובדים על אנשי הקשר של הגיבוי?</summary><ol>
      <li><b>כאן, ישירות</b> — לחיצה על כרטיס פותחת אותו לעריכה: שם, מספרים, מייל, הערה, קבוצת מתקשרים וצלצול אישי. “＋ איש קשר” מוסיף חדש.</li>
      <li><b>דרך אנק״ל, לניקוי</b> — “העבר לניהול אנשי קשר” יוצר רשימה רגילה עם כל אנשי הקשר (כולל קבוצה וצלצול). שם מריצים ניהול חכם: סימונים, כפולים, מספרים. בסוף הבדיקה יש כפתור “החזרת הרשימה לגיבוי”, או כאן “⇐ מרשימה באנק״ל”.</li>
      <li><b>מקובץ</b> — “⇐ מקובץ VCF/Excel” מוסיף לאנשי הקשר שבגרסה או מחליף את כולם.</li></ol>
      <p class="qx-note">שום דבר לא נכתב לכרטיס עד “שמירה כגרסה חדשה”. אחר כך, בטלפון: גיבוי ושחזור ← שחזור ← הגרסה החדשה ← לסמן “אנשי קשר”.</p></details>`;
  }
  function contactsTab() {
    const d = qx.open.data; const groups = allGroups(d); const grouped = qx.contactView === "groups";
    return contactsGuide() + importBarHtml("phonebook", d.contacts.length) + `<div class="qx-toolbar"><label class="search-field"><span>⌕</span><input id="qx-search" type="search" value="${esc(qx.search)}" placeholder="חיפוש בשם, טלפון, מייל או הערה…"></label><button class="btn ${grouped ? "btn-secondary" : "btn-quiet"} btn-sm" data-qx="contacts-view" data-view="${grouped ? "list" : "groups"}">${grouped ? "☰ תצוגת רשימה" : "⊞ לפי קבוצות"}</button><button class="btn btn-secondary btn-sm" data-qx="add-contact">＋ איש קשר</button><button class="btn btn-quiet btn-sm" data-qx="contacts-to-list">⇄ העבר לניהול אנשי קשר</button><button class="btn btn-quiet btn-sm" data-qx="contacts-from-list">⇐ מרשימה באנק״ל</button><button class="btn btn-quiet btn-sm" data-qx="contacts-from-file">⇐ מקובץ VCF/Excel</button>${grouped ? "" : `<span class="qx-note">קבוצות: ${groups.map(esc).join(", ") || "אין"}</span>`}</div><div id="qx-contacts-list">${contactsBodyHtml()}</div>`;
  }
  function contactsBodyHtml() { return qx.contactView === "groups" ? groupsViewHtml() : contactsListHtml(); }

  /* ---------- תצוגה לפי קבוצות ----------
     מימין לשוניות הקבוצות (וגם "בלי קבוצה"), משמאל כרטיסי אנשי הקשר של הקבוצה שנבחרה. כרטיס נגרר
     ללשונית אחרת כדי לעבור קבוצה; כרטיסים מסומנים נגררים יחד, או עוברים דרך "העבר מסומנים".
     הטלפון מאפשר עד 8 קבוצות (ביט לכל קבוצה), ולכן המעבר נבדק מראש. */
  const GROUP_MAX = 8;
  function allGroups(d) { return [...new Set([...(d.groups || []), ...d.contacts.map(c => c.group).filter(Boolean)])]; }
  function groupsViewHtml() {
    const d = qx.open.data; const groups = allGroups(d);
    if (qx.groupSel == null || (qx.groupSel && !groups.includes(qx.groupSel))) qx.groupSel = groups[0] || "";
    const counts = {}; for (const c of d.contacts) counts[c.group || ""] = (counts[c.group || ""] || 0) + 1;
    const tab = (name, label) => `<button class="qx-group-tab ${qx.groupSel === name ? "active" : ""}" data-qx="group-pick" data-group="${esc(name)}" data-drop-group="${esc(name)}"><b>${esc(label)}</b><span>${counts[name] || 0}</span></button>`;
    const tabs = groups.map(g => tab(g, g)).join("") + tab("", "בלי קבוצה") + `<button class="qx-group-tab new" data-qx="group-new">＋ קבוצה חדשה</button>`;
    const rows = filteredQxContacts().filter(({ c }) => (c.group || "") === qx.groupSel);
    const total = counts[qx.groupSel] || 0; // המונה בלשונית סופר את כולם; הרשימה כאן מסוננת גם לפי תיבת החיפוש
    const cards = rows.slice(0, 1500).map(({ c, i }) => contactCardHtml(c, i, true)).join("") || (total && rows.length !== total ? `<div class="empty-box"><div class="empty-icon">⌕</div><h3>בקבוצה יש ${total} אנשי קשר, אבל אף אחד לא מתאים לחיפוש</h3><p>נקו את תיבת החיפוש כדי לראות את כולם.</p></div>` : "");
    const sel = [...qx.selected].filter(i => d.contacts[i]).length;
    const moveTo = `<select id="qx-move-to">${groups.filter(g => g !== qx.groupSel).map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("")}${qx.groupSel ? `<option value="">בלי קבוצה</option>` : ""}</select>`;
    return `<div class="qx-groups"><aside class="qx-group-tabs">${tabs}<p class="qx-note">גררו כרטיס ללשונית של קבוצה אחרת (כרטיסים מסומנים נגררים יחד). הטלפון מאפשר עד ${GROUP_MAX} קבוצות.</p></aside>
      <div class="qx-group-main"><div class="qx-toolbar"><strong>${esc(qx.groupSel || "בלי קבוצה")}</strong><span class="qx-note">${rows.length !== total ? `${rows.length} מתוך ${total} אנשי קשר (מסונן לפי החיפוש “${esc(qx.search.trim())}”)` : `${total} אנשי קשר`}${sel ? ` · ${sel} מסומנים` : ""}</span>${rows.length !== total ? `<button class="btn btn-quiet btn-sm" data-qx="clear-search">נקה חיפוש</button>` : ""}<div class="spacer"></div><button class="btn btn-quiet btn-sm" data-qx="group-select-all">סמן הכל</button><button class="btn btn-quiet btn-sm" data-qx="group-clear">נקה סימון</button><label class="modal-field qx-inline">העבר מסומנים ל${moveTo}</label><button class="btn btn-secondary btn-sm" data-qx="group-move-selected" ${sel ? "" : "disabled"}>העבר</button>${qx.groupSel ? `<button class="btn btn-quiet btn-sm" data-qx="group-rename">✎ שינוי שם הקבוצה</button>` : ""}</div>
      <div class="contact-grid">${cards || `<div class="empty-box"><div class="empty-icon">◫</div><h3>אין אנשי קשר בקבוצה</h3><p>גררו לכאן כרטיסים מקבוצה אחרת, או סמנו והעבירו.</p></div>`}</div></div></div>`;
  }
  function moveContacts(indexes, group) {
    const d = qx.open?.data; if (!d) return;
    const target = String(group || ""), ids = new Set(indexes.map(Number));
    const after = new Set(d.contacts.map((c, i) => ids.has(i) ? target : (c.group || "")).filter(Boolean));
    if (after.size > GROUP_MAX) return A().toast(`הטלפון מאפשר עד ${GROUP_MAX} קבוצות — רוקנו קבוצה לפני שמוסיפים חדשה`, "warning");
    let n = 0;
    for (const i of ids) { const c = d.contacts[i]; if (!c || (c.group || "") === target) continue; c.group = target; c.groupBit = 0; c._dirty = true; n++; }
    if (!n) return;
    qx.selected = new Set(); dirty("phonebook"); render();
    A().toast(target ? `${n} אנשי קשר עברו לקבוצה “${target}”` : `${n} אנשי קשר הוסרו מהקבוצה`);
  }
  async function newGroup() {
    const d = qx.open.data; if (allGroups(d).length >= GROUP_MAX) return A().toast(`הטלפון מאפשר עד ${GROUP_MAX} קבוצות`, "warning");
    const choice = await A().modal({ kicker: "קבוצת מתקשרים", title: "שם הקבוצה החדשה", html: `<label class="modal-field">שם<input id="qx-group-name" maxlength="40" placeholder="לדוגמה: עבודה"></label><p class="qx-note">הקבוצה נכתבת לטלפון רק כשיש בה לפחות איש קשר אחד.</p>`, buttons: [{ id: "go", label: "יצירה", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "go") return; const name = (document.getElementById("qx-group-name")?.value || "").trim(); if (!name) return;
    if (!allGroups(d).includes(name)) (d.groups = d.groups || []).push(name);
    qx.groupSel = name; qx.contactView = "groups"; render();
  }
  async function renameGroup() {
    const d = qx.open.data; const old = qx.groupSel; if (!old) return;
    const choice = await A().modal({ kicker: "קבוצת מתקשרים", title: `שינוי השם “${old}”`, html: `<label class="modal-field">שם חדש<input id="qx-group-name" maxlength="40" value="${esc(old)}"></label>`, buttons: [{ id: "go", label: "שמירה", primary: true }, { id: "cancel", label: "ביטול" }] });
    if (choice !== "go") return; const name = (document.getElementById("qx-group-name")?.value || "").trim(); if (!name || name === old) return;
    for (const c of d.contacts) if (c.group === old) { c.group = name; c._dirty = true; }
    d.groups = (d.groups || []).map(g => g === old ? name : g);
    qx.groupSel = name; dirty("phonebook"); render();
  }
  /* יומן השיחות כמו בטלפון: רשימה צרה, סמל לכל סוג, שם (או מספר), שעה, ומסננים כמו הלשוניות בטלפון */
  const CALL_ICON = { incoming: "↙", outgoing: "↗", missed: "✕", rejected: "⊘" };
  /* כמו בטלפון: שורה אחת לכל איש קשר (לפי השם, או המספר כשאין שם) עם הסמל של השיחה האחרונה;
     לחיצה פותחת את כל השיחות שלו לפי הסדר; לחיצה על שיחה מציגה את הפרטים. */
  const dur = s => s ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : "";
  const simLabel = e => e.extra === 2 ? "סים 2" : "סים 1";
  function callGroups(rows) { const groups = new Map(); for (const r of rows) { const name = contactName(r.e.number); const key = name || r.e.number; if (!groups.has(key)) groups.set(key, { key, name, number: r.e.number, calls: [] }); groups.get(key).calls.push(r); } return [...groups.values()]; }
  function callsTab() {
    const rows = flatCalls(); const filter = qx.callFilter || "all";
    const counts = { all: rows.length }; for (const r of rows) counts[r.e.type] = (counts[r.e.type] || 0) + 1;
    const shown = filter === "all" ? rows : rows.filter(r => r.e.type === filter);
    const todayIso = localIso(new Date()), yIso = localIso(new Date(Date.now() - 86400000));
    const dayLabel = iso => iso === todayIso ? "היום" : iso === yIso ? "אתמול" : iso.split("-").reverse().join(".");
    const chips = [["all", "הכל"], ["missed", "לא נענו"], ["outgoing", "יוצאות"], ["incoming", "נכנסות"], ["rejected", "נדחו"]].map(([k, v]) => `<button class="qx-filter ${filter === k ? "active" : ""} ${k}" data-qx="call-filter" data-filter="${k}">${k !== "all" ? CALL_ICON[k] + " " : ""}${v} <span class="qx-n">${counts[k] || 0}</span></button>`).join("");
    const groups = callGroups(shown); let body = "";
    if (qx.callContact) {
      const g = groups.find(x => x.key === qx.callContact);
      if (!g) { qx.callContact = null; return callsTab(); }
      let lastDay = "";
      for (const r of g.calls) {
        const iso = Q.phoneTimeToIso(r.call.time); const day = iso.slice(0, 10), hm = iso.slice(11, 16);
        if (day !== lastDay) { body += `<div class="qx-call-day">${dayLabel(day)}</div>`; lastDay = day; }
        body += `<div class="qx-call qx-call-item ${r.e.type}" data-qx="call-info" data-ei="${r.ei}" data-ci="${r.ci}" role="button"><i class="qx-call-ico">${CALL_ICON[r.e.type] || "•"}</i><div class="qx-call-main"><b>${Q.CALL_TYPE_HE[r.e.type] || r.e.type}${r.call.duration ? " · " + dur(r.call.duration) : ""}</b><small dir="ltr">${esc(r.e.number)}</small></div><span class="qx-call-time">${hm}</span><button class="icon-btn" data-qx="delete-call" data-ei="${r.ei}" data-ci="${r.ci}" aria-label="מחיקה">✕</button></div>`;
      }
      body = `<div class="qx-call-head"><button class="btn btn-quiet btn-sm" data-qx="call-back">→ חזרה</button><div><b>${esc(g.name || g.number)}</b><small dir="ltr">${g.name ? esc(g.number) : ""}</small></div><span class="qx-note">${g.calls.length} שיחות</span></div>` + body;
    } else {
      for (const g of groups) {
        const last = g.calls[0]; const iso = Q.phoneTimeToIso(last.call.time); const day = iso.slice(0, 10), hm = iso.slice(11, 16);
        body += `<div class="qx-call ${last.e.type}" data-qx="call-group" data-key="${esc(g.key)}" role="button"><i class="qx-call-ico" title="${Q.CALL_TYPE_HE[last.e.type] || ""}">${CALL_ICON[last.e.type] || "•"}</i><div class="qx-call-main"><b>${esc(g.name || g.number)}${g.calls.length > 1 ? ` <span class="qx-call-count">(${g.calls.length})</span>` : ""}</b><small dir="ltr">${g.name ? esc(g.number) + " · " : ""}${Q.CALL_TYPE_HE[last.e.type] || ""}${last.call.duration ? " · " + dur(last.call.duration) : ""}</small></div><span class="qx-call-time">${day === todayIso ? hm : dayLabel(day)}</span><button class="icon-btn" data-qx="delete-group" data-key="${esc(g.key)}" aria-label="מחיקת כל השיחות">✕</button></div>`;
      }
    }
    return importBarHtml("callog", rows.length) + `<div class="qx-toolbar"><button class="btn btn-secondary btn-sm" data-qx="add-call">＋ שיחה</button><span class="qx-note">הטלפון שומר עד 100 מספרים ועד 10 שיחות לכל מספר</span></div>
      <div class="qx-phone-panel"><div class="qx-filters">${chips}</div><div class="qx-calls">${body || `<p class="qx-note" style="padding:20px;text-align:center">אין שיחות</p>`}</div></div>`;
  }
  async function callInfo(ei, ci) {
    const e = qx.open.data.callog.entries[ei], call = e && e.calls[ci]; if (!call) return;
    const iso = Q.phoneTimeToIso(call.time); const name = contactName(e.number);
    const row = (k, v) => `<div class="modal-list-row"><span>${k}</span><b dir="auto">${esc(v)}</b></div>`;
    const choice = await A().modal({ kicker: "פרטי שיחה", title: name || e.number, html: `<div class="modal-list">${row("שם", name || "לא באנשי הקשר")}${row("מספר", e.number)}${row("תאריך", iso.slice(0, 10).split("-").reverse().join("."))}${row("שעה", iso.slice(11, 19))}${row("משך", call.duration ? dur(call.duration) + " (" + call.duration + " שניות)" : "לא נענתה")}${row("סוג", Q.CALL_TYPE_HE[e.type] || e.type)}${row("סים", simLabel(e))}</div>`, buttons: [{ id: "delete", label: "מחיקת השיחה" }, { id: "ok", label: "סגירה", primary: true }] });
    if (choice === "delete") deleteCall(ei, ci);
  }
  async function deleteGroup(key) {
    const groups = callGroups(flatCalls()); const g = groups.find(x => x.key === key); if (!g) return;
    if (!(await A().confirmBox("מחיקת שיחות", `למחוק את כל ${g.calls.length} השיחות של ${g.name || g.number}?`, "מחיקה"))) return;
    const d = qx.open.data; for (const r of g.calls) { r.e.calls = r.e.calls.filter(c => c !== r.call); r.e._dirty = true; }
    d.callog.entries = d.callog.entries.filter(e => e.calls.length); dirty("callog"); render();
  }
  /* עורך הפתקים משותף ללשונית "הפתקים שלי" של הגרסה ול"ניהול פתקים" של הכרטיס — ההבדל רק במקור ובשמירה. */
  function memosTab() {
    const st = memoStore(); const m = st.memos[st.idx];
    const when = x => { const t = x.modified || x.created || ""; const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t); return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : ""; };
    // הסדר ברשימה הוא הסדר בטלפון: העליון מוצג ראשון. ▲/▼ מזיזים, והסדר נכתב בשמירה דרך זמני הקבצים.
    const list = st.memos.map((x, i) => `<div class="qx-memo-row ${i === st.idx ? "active" : ""}" draggable="true" data-memo-drag="${i}" data-memo-drop="${i}" title="גררו כדי לשנות את הסדר"><button class="qx-memo-pick" data-qx="memo" data-i="${i}"><strong>${esc(x.text.split("\n").map(l => l.trim()).find(Boolean) || "(פתק ריק)")}</strong><span>${esc(when(x))} · ${x.text.length} תווים${x._dirty ? " · לא נשמר" : ""}</span></button><span class="qx-memo-move"><button class="icon-btn" data-qx="memo-up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="למעלה">▲</button><button class="icon-btn" data-qx="memo-down" data-i="${i}" ${i === st.memos.length - 1 ? "disabled" : ""} aria-label="למטה">▼</button></span></div>`).join("");
    const align = `<div class="qx-align"><div class="qx-align-head"><strong>יישור למרכז מסך הטלפון</strong><span class="qx-note">שורה שארוכה מהמסך נשברת קודם לכמה שורות מאוזנות (כמו שהטלפון היה שובר), ואז כל שורה ממורכזת ברווחים. מירכוז חוזר לא מצטבר.</span></div>
      <div class="qx-row"><button class="btn btn-secondary btn-sm" data-qx="center-line">מרכז את השורה הנוכחית</button><button class="btn btn-secondary btn-sm" data-qx="center-all">מרכז את כל הפתק</button><button class="btn btn-quiet btn-sm" data-qx="uncenter-line">בטל מירכוז לשורה</button><button class="btn btn-quiet btn-sm" data-qx="uncenter-all">בטל מירכוז לכל הפתק</button><button class="btn btn-quiet btn-sm" data-qx="calibrate">כיול רוחב${qx.widths ? ` (פעיל: ${Object.keys(qx.widths).length} תווים)` : ""}</button></div>
      <div class="qx-align-head"><strong>נקודה וטאב</strong><span class="qx-note">השורה מתחילה בנקודה, טאב ואז המשפט — כמו סעיף ברשימה. לחיצה נוספת על אותה שורה מסירה.</span></div>
      <div class="qx-row"><button class="btn btn-secondary btn-sm" data-qx="bullet-line">נקודה וטאב לשורה הנוכחית</button><button class="btn btn-secondary btn-sm" data-qx="bullet-all">לכל השורות בפתק</button><button class="btn btn-quiet btn-sm" data-qx="unbullet-all">הסר נקודה וטאב מכל הפתק</button><div class="spacer"></div><button class="btn btn-quiet btn-sm" data-qx="memo-undo" ${m && m._history?.length ? "" : "disabled"}>↶ בטל את הפעולה האחרונה</button></div></div>`;
    const editor = m ? `<div class="qx-editor">${align}<div class="qx-row"><label class="modal-field qx-inline">מגבלת הטלפון<select id="qx-memo-limit"><option value="1000" ${qx.memoLimit === 1000 ? "selected" : ""}>1000 תווים</option><option value="3000" ${qx.memoLimit === 3000 ? "selected" : ""}>3000 תווים</option></select></label><div class="spacer"></div><button class="btn btn-danger btn-sm" data-qx="delete-memo">מחיקה</button></div><textarea id="qx-memo-text" dir="auto">${esc(m.text)}</textarea><div id="qx-memo-counter" class="qx-counter"></div><div class="qx-note">כך זה ייראה על מסך הטלפון (הערכה לפי רוחב האותיות; שורות שהטלפון שובר בעצמו מסומנות בחום):</div><div id="qx-memo-preview" class="qx-phone"></div></div>` : `<div class="empty-box"><div class="empty-icon">✎</div><h3>אין פתקים</h3><p>צרו פתק חדש.</p></div>`;
    const note = st.direct ? "" : `<div class="qx-memo-note"><div class="qx-memo-note-head"><i>⚠</i><strong>לפני שחזור של פתקים בטלפון</strong></div>
      <ol><li>הטלפון מזהה פתק לפי <b>שם הקובץ</b>, לא לפי התוכן.</li><li>פתק שערכתם כאן <b>לא יתעדכן</b> כל עוד הפתק הישן קיים בטלפון.</li><li>לכן: מחקו בטלפון את הפתקים שערכתם (או את כולם), ורק אז שחזרו את “הפתקים שלי”.</li></ol>
      <div class="qx-memo-note-foot"><span>רוצים שהשינוי ייכנס מיד, בלי שחזור?</span><button class="btn btn-secondary btn-sm" data-qx="direct-memos">✎ ניהול פתקים ישיר</button></div></div>`;
    return (st.direct ? "" : importBarHtml("memo", st.memos.length)) + `<div class="qx-toolbar"><button class="btn btn-secondary btn-sm" data-qx="new-memo">＋ פתק</button><span class="qx-note">${st.memos.length} פתקים · ${st.direct ? "תיקיית Memo של הכרטיס — הטלפון קורא אותם ישירות" : "קבצי טקסט פשוטים בתיקיית Memo"} · הסדר ברשימה הוא הסדר בטלפון (▲▼ לשינוי)</span></div>${note}<div class="qx-split"><div class="qx-list">${list}</div>${editor}</div>`;
  }
  function calendarTab() {
    const d = qx.open.data; if (!qx.calMonth) qx.calMonth = localIso(new Date()).slice(0, 7);
    const [y, m] = qx.calMonth.split("-").map(Number); const first = new Date(y, m - 1, 1), daysInMonth = new Date(y, m, 0).getDate(), startDow = first.getDay();
    const byDate = {}; d.events.forEach((e, i) => { (byDate[e.date] = byDate[e.date] || []).push({ e, i }); });
    const monthName = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(first), todayKey = localIso(new Date());
    let cells = ""; for (let k = 0; k < startDow; k++) cells += `<div class="qx-day empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`; const evs = (byDate[key] || []).sort((a, b) => a.e.time.localeCompare(b.e.time));
      cells += `<div class="qx-day ${key === todayKey ? "today" : ""}" data-qx="day-add" data-date="${key}" title="הוספת אירוע ב-${key.split("-").reverse().join(".")}"><span class="qx-daynum">${day}<small class="qx-heb">${esc(hebDay(new Date(y, m - 1, day)))}</small></span>${evs.map(({ e, i }) => `<button class="qx-ev ${e.reminder ? "rem" : ""}" data-qx="edit-event" data-i="${i}" title="${esc(e.time + " " + e.title)}">${esc(e.time)} ${esc(e.title)}</button>`).join("")}</div>`;
    }
    const monthEvents = d.events.map((e, i) => ({ e, i })).filter(x => x.e.date.startsWith(qx.calMonth)).sort((a, b) => (a.e.date + a.e.time).localeCompare(b.e.date + b.e.time));
    const list = qx.calView === "list" ? `<div class="qx-table-wrap" style="margin-top:12px"><table class="qx-table"><thead><tr><th>תאריך</th><th>שעה</th><th>כותרת</th><th>תזכורת</th><th></th></tr></thead><tbody>${d.events.map((e, i) => ({ e, i })).sort((a, b) => (b.e.date + b.e.time).localeCompare(a.e.date + a.e.time)).map(({ e, i }) => `<tr data-qx="edit-event" data-i="${i}" style="cursor:pointer"><td class="num">${esc(e.date.split("-").reverse().join("."))}</td><td class="num">${esc(e.time)}</td><td>${esc(e.title)}</td><td>${e.reminder ? "🔔" : ""}</td><td class="act"><button class="icon-btn" aria-label="עריכה">✎</button></td></tr>`).join("")}</tbody></table></div>` : "";
    return importBarHtml("schedule", d.events.length) + `<div class="qx-toolbar"><button class="btn btn-secondary btn-sm" data-qx="add-event">＋ אירוע</button><button class="btn btn-quiet btn-sm" data-qx="cal-prev">‹ חודש קודם</button><button class="btn btn-quiet btn-sm" data-qx="cal-today">היום</button><button class="btn btn-quiet btn-sm" data-qx="cal-next">חודש הבא ›</button><strong style="font-size:15px">${esc(monthName)}</strong><span class="qx-note">${esc(hebRange(first, new Date(y, m - 1, daysInMonth)))}</span><span class="qx-note">${monthEvents.length} אירועים החודש · ${d.events.length} בסך הכל</span><div class="spacer"></div><button class="btn btn-quiet btn-sm" data-qx="cal-toggle">${qx.calView === "list" ? "הסתר רשימה" : "הצג גם כרשימה"}</button></div>
      <div class="qx-cal-head">${["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"].map(n => `<span>${n}</span>`).join("")}</div><div class="qx-cal">${cells}</div><p class="qx-note" style="margin:8px 0 0">לחיצה על יום מוסיפה אירוע באותו תאריך. לחיצה על אירוע פותחת אותו לעריכה.</p>${list}`;
  }
  function playlistsTab() {
    const d = qx.open.data; const p = d.playlists[qx.plIdx];
    const picks = d.playlists.map((x, i) => `<button class="${i === qx.plIdx ? "active" : ""}" data-qx="playlist" data-i="${i}">♪ ${esc(x.name.replace(/\.lst$/i, ""))} <small>(${x.entries.length})</small></button>`).join("");
    const body = p ? `<div class="qx-toolbar"><button class="btn btn-secondary btn-sm" data-qx="add-song">＋ שיר</button><button class="btn btn-danger btn-sm" data-qx="delete-playlist">מחיקת הרשימה</button><span class="qx-note">${p.entries.length} שירים</span></div><div class="qx-table-wrap"><table class="qx-table"><thead><tr><th>#</th><th>קובץ</th><th>גודל</th><th></th></tr></thead><tbody>${p.entries.map((e, i) => `<tr><td>${i + 1}</td><td class="num" style="white-space:normal;direction:ltr">${esc(e.path)}</td><td class="num">${e.fileSize ? (e.fileSize / 1048576).toFixed(1) + " MB" : ""}</td><td class="act"><button class="icon-btn" data-qx="song-up" data-i="${i}" aria-label="למעלה">↑</button><button class="icon-btn" data-qx="song-down" data-i="${i}" aria-label="למטה">↓</button><button class="icon-btn" data-qx="song-remove" data-i="${i}" aria-label="הסרה">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-box"><div class="empty-icon">♪</div><h3>אין רשימות השמעה</h3></div>`;
    return importBarHtml("playlist", d.playlists.length) + `<div class="qx-pl">${picks}<button data-qx="new-playlist">＋ רשימה חדשה</button></div>${body}`;
  }
  function dictionaryTab() {
    const d = qx.open.data;
    return importBarHtml("udb", d.dictionaryWords.length) + `<div class="qx-warn">ניסיוני: המבנה של קובץ חיזוי הטקסט פוענח, אבל ערך הביקורת שלו רק בחלקו. אחרי שחזור של “חיזוי טקסט” מגרסה שנערכה כאן, בדקו בטלפון שהמילים נשמרו.</div>
      <div class="qx-toolbar" style="margin-top:12px"><input id="qx-word" class="qinline" placeholder="מילה חדשה לחיזוי" style="max-width:260px"><button class="btn btn-secondary btn-sm" data-qx="add-word">＋ הוספה</button><button class="btn btn-quiet btn-sm" data-qx="import-words">⇐ מאקסל / מקובץ טקסט</button><span class="qx-note">${d.dictionaryWords.length} מילים${d.dictAdd.length ? ` · ${d.dictAdd.length} חדשות` : ""}${d.dictRemove.length ? ` · ${d.dictRemove.length} להסרה` : ""} · מקום לעוד כ-${Math.max(0, Math.floor(udbFreeBytes() / 26))} מילים</span></div>
      <div class="qx-words">${d.dictionaryWords.map(w => `<span class="qx-word">${esc(w)}<button data-qx="remove-word" data-w="${esc(w)}" aria-label="הסרה">✕</button></span>`).join("") || "<span class='qx-note'>המילון ריק</span>"}</div>`;
  }
  /* הגדרות: קריאה בלבד. מה שקריא מוצג כרשימה, וחיפוש ערך מאתר מספר או טקסט בכל הקידודים — כך אפשר למצוא
     את מיקום קוד הנעילה לפי קוד ידוע, ואחרי שהמקום ידוע לשלוף אותו מגיבוי של טלפון שהקוד שלו נשכח. */
  /* הגדרות שאפשר לקרוא מהכרטיס עצמו (לא מהגיבוי): הצלילים שנבחרו (moreringset\envset.ini) וצלצולי השעונים
     המעוררים (Alarm\N_Ring.ini). נקראים פעם אחת כשפותחים את לשונית ההגדרות עם כרטיס מחובר. */
  async function loadCardSounds() {
    if (!qx.adapter || qx.layout.mode !== "card") { qx.cardSounds = null; return; }
    const out = { envset: [], alarms: [], error: "" };
    try {
      const root = await qx.adapter.list("");
      const dirOf = n => root.find(e => e.kind === "directory" && e.name.toLowerCase() === n)?.name;
      const ring = dirOf("moreringset"); if (ring) { const f = (await qx.adapter.list(ring)).find(e => e.kind === "file" && e.name.toLowerCase() === "envset.ini"); if (f) out.envset = Q.parseSoundPaths(await qx.adapter.read(join(ring, f.name))); }
      const alarm = dirOf("alarm"); if (alarm) for (const f of (await qx.adapter.list(alarm)).filter(e => e.kind === "file" && /^\d+_Ring\.ini$/i.test(e.name)).sort((a, b) => parseInt(a.name) - parseInt(b.name))) { const paths = Q.parseSoundPaths(await qx.adapter.read(join(alarm, f.name))); out.alarms.push({ index: parseInt(f.name), path: paths[0]?.path || "" }); }
    } catch (error) { out.error = error.message || String(error); }
    qx.cardSounds = out;
  }
  function settingsTab() {
    const d = qx.open.data;
    const fromCard = qx.layout?.mode === "card";
    if (fromCard && !qx.cardSounds) loadCardSounds().then(() => { if (qx.tab === "settings" && qx.view === "editor") render(); });
    const cs = qx.cardSounds;
    const soundRows = cs ? cs.envset.map((p, i) => `<tr><td class="num">${i + 1}</td><td class="num" style="white-space:normal;direction:ltr">${esc(p.path)}</td></tr>`).join("") : "";
    const alarmRows = cs ? cs.alarms.map(a => `<tr><td class="num">${a.index}</td><td class="num" style="white-space:normal;direction:ltr">${esc(a.path) || "<span class='qx-note'>ברירת מחדל</span>"}</td></tr>`).join("") : "";
    const card = !fromCard ? `<p class="qx-note">הצלילים שנבחרו וצלצולי השעונים נמצאים בכרטיס עצמו (לא בגיבוי) — כדי לראות אותם בחרו את הכרטיס.</p>`
      : !cs ? `<p class="qx-note">קורא מהכרטיס…</p>`
      : `<div class="qx-table-wrap" style="max-height:40vh"><table class="qx-table"><thead><tr><th>#</th><th>צליל שנבחר בהגדרות (envset.ini)</th></tr></thead><tbody>${soundRows || `<tr><td colspan="2" class="qx-note">לא נמצא קובץ envset.ini בכרטיס</td></tr>`}</tbody></table></div>
         <div class="qx-table-wrap" style="max-height:40vh;margin-top:10px"><table class="qx-table"><thead><tr><th>שעון מעורר</th><th>צלצול (Alarm\\N_Ring.ini)</th></tr></thead><tbody>${alarmRows || `<tr><td colspan="2" class="qx-note">אין תיקיית Alarm בכרטיס</td></tr>`}</tbody></table></div>
         <p class="qx-note">איזו משבצת היא צלצול, הודעה או שעון — הטלפון לא כותב; אם תזהו לפי ההגדרות בטלפון, נסמן.</p>${cs.error ? `<p class="qx-note">שגיאה בקריאה: ${esc(cs.error)}</p>` : ""}`;
    const head = `<div class="qx-panel"><h3 style="margin:0 0 8px">הגדרות מהכרטיס — צלילים ושעונים</h3>${card}</div>`;
    if (!d.settings) return head + `<div class="qx-panel" style="margin-top:12px"><h3 style="margin:0 0 8px">קובץ ההגדרות של הגיבוי</h3><p class="qx-note">בגרסה הזו אין קובץ הגדרות.</p></div>`;
    const strings = Q.settingsStrings(d.settings);
    const rows = strings.map(s => `<tr><td class="num">0x${s.offset.toString(16).padStart(6, "0")}</td><td class="num">${s.kind}</td><td dir="auto">${esc(s.text)}</td></tr>`).join("");
    return head + `<div class="qx-panel" style="margin-top:12px"><h3 style="margin:0 0 8px">קובץ ההגדרות של הגיבוי — צפייה בלבד</h3><p class="qx-note">קובץ ההגדרות (${(d.settings.length / 1024).toFixed(0)} KB) הוא צילום של זיכרון המערכת ואי אפשר לערוך אותו בבטחה. הוא נשמר בגרסה החדשה כמו שהוא, ובטלפון אפשר לבחור אם לשחזר אותו. רוב ההגדרות שבו (עוצמות, פרופילים, תצוגה) בינאריות ובלי מפה ידועה; מה שקריא: שמות SIM, הגדרות גלישה (APN), מספרי חירום ועותקים של אירועי יומן.</p>
      <div class="qx-toolbar" style="margin-top:12px"><label class="search-field"><span>⌕</span><input id="qx-settings-find" type="search" placeholder="חיפוש ערך בקובץ, למשל קוד נעילה (1234)…"></label><span class="qx-note">מחפש כטקסט, כ-UTF-16, כ-BCD וכמספר. בבדיקה על גיבוי אמיתי (אוקטובר 2026) קוד הנעילה לא נמצא באף קידוד — ככל הנראה הטלפון לא כולל אותו בגיבוי.</span></div>
      <div id="qx-settings-hits" class="qx-note"></div>
      <div class="qx-table-wrap" style="margin-top:10px;max-height:50vh"><table class="qx-table"><thead><tr><th>היסט</th><th>קידוד</th><th>ערך</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="qx-note">לא נמצא טקסט קריא</td></tr>`}</tbody></table></div></div>`;
  }
  function settingsFind(value) {
    const box = document.getElementById("qx-settings-hits"); const d = qx.open?.data; if (!box || !d?.settings) return;
    const text = String(value || "").trim(); if (!text) { box.textContent = ""; return; }
    const hits = Q.findValue(d.settings, text);
    box.innerHTML = hits.length ? `נמצא ${hits.length} פעמים: ` + hits.slice(0, 40).map(h => `<code>${h.kind}@0x${h.offset.toString(16)}</code>`).join(" ") : "לא נמצא באף קידוד";
  }

  /* ---------- אירועים ---------- */
  document.addEventListener("click", async event => {
    // תיבת הסימון שעל כרטיס בתצוגת הקבוצות: מסמנת, ולא פותחת את הכרטיס לעריכה
    const check = event.target.closest?.("[data-qx-select]");
    if (check) { const i = Number(check.dataset.qxSelect); if (qx.selected.has(i)) qx.selected.delete(i); else qx.selected.add(i); return render(); }
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
        case "direct-memos": return openDirectMemos();
        case "to-versions": qx.keepView = !!qx.open; return A().setPage("qualix");
        case "direct-reload": qx.direct = null; return openDirectMemos();
        case "direct-save": return saveDirectMemos();
        case "cloud-login": await A().login(); return syncCloud(true);
        case "cloud-refresh": return syncCloud(true);
        case "cloud-upload-all": return uploadPending(true);
        case "cloud-menu": return cloudMenu(el.dataset.folder);
        case "cloud-download": return downloadVersion(el.dataset.folder);
        case "add-contact": return editContact(-1);
        case "edit-contact": return editContact(i);
        case "pick-ring": return pickAudio("qx-c-ringpath");
        case "pick-song": return pickAudio("qx-song-path");
        case "contacts-view": qx.contactView = el.dataset.view; qx.selected = new Set(); return render();
        case "group-pick": qx.groupSel = el.dataset.group; return render();
        case "clear-search": qx.search = ""; return render();
        case "import-preview": return importPreview(el.dataset.cat);
        case "import-apply": return importApply(el.dataset.cat);
        case "group-new": return newGroup();
        case "group-rename": return renameGroup();
        case "group-select-all": for (const { c, i: ci } of filteredQxContacts()) if ((c.group || "") === qx.groupSel) qx.selected.add(ci); return render();
        case "group-clear": qx.selected = new Set(); return render();
        case "group-move-selected": return moveContacts([...qx.selected], document.getElementById("qx-move-to")?.value || "");
        case "contacts-to-list": return contactsToList();
        case "contacts-from-list": return contactsFromList();
        case "contacts-from-file": return contactsFromFile();
        case "add-call": return addCall();
        case "call-filter": qx.callFilter = el.dataset.filter; qx.callContact = null; return render();
        case "call-group": qx.callContact = el.dataset.key; return render();
        case "call-back": qx.callContact = null; return render();
        case "call-info": return callInfo(Number(el.dataset.ei), Number(el.dataset.ci));
        case "delete-group": return deleteGroup(el.dataset.key);
        case "delete-call": return deleteCall(Number(el.dataset.ei), Number(el.dataset.ci));
        case "memo": memoStore().idx = i; return render();
        case "new-memo": return newMemo();
        case "delete-memo": return deleteMemo();
        case "center-line": return centerMemo(false);
        case "center-all": return centerMemo(true);
        case "bullet-line": return bulletMemo(false);
        case "bullet-all": return bulletMemo(true);
        case "unbullet-all": return unbulletMemo();
        case "uncenter-line": return uncenterMemo(false);
        case "uncenter-all": return uncenterMemo(true);
        case "memo-undo": return undoMemo();
        case "memo-up": return moveMemo(i, -1);
        case "memo-down": return moveMemo(i, 1);
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
  /* גרירת כרטיס (או כמה מסומנים) ללשונית קבוצה. הנתונים עוברים ב-dataTransfer כדי שגם גרירה לחלון אחר לא תפיל */
  const dropHalf = (row, event) => { const r = row.getBoundingClientRect(); return event.clientY > r.top + r.height / 2; }; // false = לפני, true = אחרי
  document.addEventListener("dragstart", event => {
    const memoRow = event.target.closest?.("[data-memo-drag]");
    if (memoRow) { event.dataTransfer.setData("text/plain", JSON.stringify({ ankalMemo: Number(memoRow.dataset.memoDrag) })); event.dataTransfer.effectAllowed = "move"; return; }
    const card = event.target.closest?.("[data-drag-i]"); if (!card || !qx.open) return;
    const i = Number(card.dataset.dragI); const ids = qx.selected.has(i) ? [...qx.selected] : [i];
    event.dataTransfer.setData("text/plain", JSON.stringify({ ankalQx: ids })); event.dataTransfer.effectAllowed = "move";
  });
  document.addEventListener("dragover", event => {
    const row = event.target.closest?.("[data-memo-drop]");
    if (row) { event.preventDefault(); const after = dropHalf(row, event); row.classList.toggle("over-bottom", after); row.classList.toggle("over-top", !after); return; }
    const t = event.target.closest?.("[data-drop-group]"); if (t) { event.preventDefault(); t.classList.add("over"); }
  });
  document.addEventListener("dragleave", event => { const row = event.target.closest?.("[data-memo-drop]"); if (row) row.classList.remove("over-top", "over-bottom"); const t = event.target.closest?.("[data-drop-group]"); if (t) t.classList.remove("over"); });
  document.addEventListener("drop", event => {
    let data = null; try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch (_) { }
    const row = event.target.closest?.("[data-memo-drop]");
    if (row) { event.preventDefault(); row.classList.remove("over-top", "over-bottom"); if (data && typeof data.ankalMemo === "number") reorderMemo(data.ankalMemo, Number(row.dataset.memoDrop), dropHalf(row, event)); return; }
    const t = event.target.closest?.("[data-drop-group]"); if (!t) return;
    event.preventDefault(); t.classList.remove("over");
    if (data && Array.isArray(data.ankalQx)) moveContacts(data.ankalQx, t.dataset.dropGroup);
  });
  document.addEventListener("input", event => {
    if (event.target.id === "qx-search") { qx.search = event.target.value; const list = document.getElementById("qx-contacts-list"); if (list) list.innerHTML = contactsBodyHtml(); }
    if (event.target.id === "qx-settings-find") settingsFind(event.target.value);
    if (event.target.id === "qx-memo-text") { const st = memoStore(); const m = st.memos[st.idx]; if (m) { m.text = event.target.value; m._dirty = true; st.mark(); memoCounter(); markUnsaved(); } }
  });
  document.addEventListener("change", event => {
    if (event.target.id === "qx-memo-limit") { qx.memoLimit = Number(event.target.value) || 1000; localStorage.setItem(LIMIT_KEY, String(qx.memoLimit)); memoCounter(); }
  });
  document.addEventListener("keydown", event => { if (event.key === "Enter" && event.target.id === "qx-word") { event.preventDefault(); addWord(); } });
  window.addEventListener("beforeunload", event => { if (qx.open?.dirty.size || qx.direct?.dirty) { event.preventDefault(); event.returnValue = ""; } });

  // connect מאפשר לבדיקות דפדפן להזרים מתאם בזיכרון במקום כרטיס אמיתי
  // לחיצה על "גיבוי קיוליקס" בתפריט מציגה את הגרסאות (כמו "הרשימות שלי"); מעבר מקטגוריה בתפריט שומר על העורך.
  window.ANKAL_QUALIX_UI = { show: () => { if (!qx.keepView) qx.view = "versions"; qx.keepView = false; render(); if (!qx.adapter && window.electronAPI?.qualix) detectCards(true); if (qx.adapter && cloudUser() && !qx.cloud.loaded && !qx.cloud.uploading) syncCloud(); }, showMemos, pageChanged: renderSubnav, state: qx, connect, render, importList };
})();
