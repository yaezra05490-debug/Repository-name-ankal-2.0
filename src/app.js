(function () {
  "use strict";

  const CFG = window.ANKAL_CONFIG || {};
  const STORAGE_KEY = "ankal.v2.workspace";
  const QUEUE_KEY = "ankal.v2.syncQueue";
  const PHONE_FIELDS = ["mobile", "home", "work", "fax"];
  const FIELDS = ["name", ...PHONE_FIELDS, "email", "note"];
  const LABELS = { name: "שם", mobile: "נייד", home: "בית", work: "עבודה", fax: "פקס", email: "מייל", note: "הערה" };
  const PAGE_TITLES = { lists: ["מרכז העבודה", "הרשימות שלי"], contacts: ["ניהול רשימה", "אנשי קשר"], clean: ["כלי עבודה", "ניקוי והחלפה"], duplicates: ["בקרת איכות", "בדיקת כפולים"], smart: ["איכות נתונים", "ניהול חכם"], transfer: ["קבצים", "ייבוא וייצוא"], help: ["מרכז מידע", "עזרה והסברים"], admin: ["למנהל בלבד", "ניהול מערכת"] };
  const HELP = {
    start: `<h2>התחלה מהירה</h2><div class="help-step"><b>1</b><div><strong>צרו או פתחו רשימה</strong><p>במסך הרשימות לחצו “רשימה חדשה”, או ייבאו קובץ קיים.</p></div></div><div class="help-step"><b>2</b><div><strong>בדקו את המיפוי</strong><p>בייבוא Excel בחרו גיליון, שורת כותרות והעמודה המתאימה לכל אחד משבעת השדות.</p></div></div><div class="help-step"><b>3</b><div><strong>נקו ובדקו כפולים</strong><p>השתמשו בכלי הניקוי ולאחר מכן הפעילו בדיקת כפולים. מיזוג אוטומטי מתבצע רק כשאין סתירה.</p></div></div><div class="help-step"><b>4</b><div><strong>ייצאו</strong><p>עברו לייבוא וייצוא ובחרו VCF, Excel או CSV.</p></div></div>`,
    import: `<h2>ייבוא קבצים</h2><h3>אילו קבצים אפשר לייבא?</h3><p>VCF, XLSX, XLS ו־CSV בלבד. קובץ אחר לא ישנה את הרשימה.</p><h3>Excel עם כמה גיליונות</h3><p>בחרו גיליון אחד או כמה גיליונות. לכל גיליון ניתן לבחור את שורת הכותרות ולמפות את העמודות.</p><h3>מה קורה לערך נוסף?</h3><p>אם המקום שנבחר כבר מלא, אנק״ל ישאל אם להחליף את הערך. אפשר גם לחזור לבחירה או לא לייבא את הערך.</p><h3>ייבוא לרשימה קיימת</h3><p>בחרו אם להוסיף לרשימה או להחליף אותה. אם אותו קובץ כבר יובא, תוצג אזהרה.</p>`,
    duplicates: `<h2>בדיקת כפולים</h2><p>אנק״ל בודק מספרי טלפון, מיילים ושמות דומים. אותו מספר ישראלי מזוהה בכל צורות הכתיבה — עם 0, עם ‎+972, וגם כשאקסל אכל את האפס המוביל.</p><h3>איך עוברים על זה</h3><p>אחרי הסריקה מופיע מסך סיכום עם כרטיס לכל סוג בעיה. בכל סוג אפשר <b>לאשר את כולם בבת אחת</b> או <b>לעבור אחד אחד</b>, ותמיד אפשר לדלג על סוג שלם.</p><h3>מה המערכת מציעה לבד</h3><p>את השם הנקי ביותר (“מרים הריס” ולא “מרים הריס_1”), וכל מספר במשבצת שהקידומת שלו מכתיבה — 05x לנייד, 02/03/04/08/09 ו‑07x לקווי. אפשר לשנות כל שיוך.</p><h3>סוגי הכפילות</h3><p><b>זהים לגמרי</b> — אותו שם ואותם פרטים. <b>מיזוג בטוח</b> — אין סתירה, רק מידע שחסר בכרטיס אחד. <b>שם שונה</b> / <b>מספרים שונים</b> / <b>שם ומספרים שונים</b> — יש ברירת מחדל מוצעת. <b>מייל או הערה שונים</b> ו<b>שם דומה, מספרים שונים</b> — כאן אין ברירת מחדל אמינה וצריך להחליט אחד אחד.</p><h3>השאר נפרדים</h3><p>מסמן שאלה אנשים שונים. ההחלטה נשמרת ברשימה ולא חוזרת בסריקה הבאה.</p>`,
    sync: `<h2>שמירה וסנכרון</h2><p>במצב מקומי הרשימות נשמרות במחשב או בדפדפן. לאחר כניסה עם Google, השינויים ממתינים בתור ונשלחים ברקע.</p><ul><li><strong>נשמר במחשב</strong> — העותק המקומי מעודכן.</li><li><strong>ממתין לסנכרון</strong> — העבודה שמורה מקומית ותישלח כשאפשר.</li><li><strong>מסנכרן</strong> — מתבצעת שמירה בענן.</li><li><strong>נשמר בענן</strong> — השרת אישר את השמירה.</li></ul><p>אם אותה רשימה שונתה במכשיר אחר, המערכת לא תדרוס אותה ותציע להשוות או לשמור עותק.</p>`,
    export: `<h2>ייצוא</h2><h3>VCF</h3><p>מתאים לייבוא בטלפון ושומר את שבעת השדות: שם, נייד, בית, עבודה, פקס, מייל והערה.</p><h3>Excel</h3><p>יוצר גיליון מסודר עם עמודה לכל שדה.</p><h3>CSV</h3><p>כולל הגנה כדי ש־Excel לא יפעיל טקסט כנוסחה. עברית נשמרת עם סימון מתאים ל־Excel.</p>`
  };

  const state = {
    lists: [], activeListId: null, page: "lists", selected: new Set(), visibleLimit: CFG.CONTACTS_PAGE_SIZE || 100,
    dense: false, search: "", listSearch: "", user: null, token: "", syncQueue: [], syncRunning: false,
    modal: null, drawerTimer: null, saveTimer: null, importHash: null, adminTab: "users",
    review: null // מצב אשף בקרת האיכות (סימונים + כפולים), null כשלא רצה בדיקה
  };

  function id(prefix = "id") { return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`; }
  function now() { return new Date().toISOString(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function fmtDate(value) { if (!value) return "—"; try { return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); } catch (_) { return value; } }
  function currentList() { return state.lists.find(list => list.id === state.activeListId) || null; }
  function blankContact(values = {}) { return { id: values.id || id("contact"), name: values.name || "", mobile: values.mobile || "", home: values.home || "", work: values.work || "", fax: values.fax || "", email: values.email || "", note: values.note || "" }; }
  function blankList(name = "רשימה חדשה") { return { id: id("list"), name, contacts: [], version: 0, remoteVersion: 0, updatedAt: now(), createdAt: now(), importHashes: [], separatedPairs: [], undo: [], redo: [], dirty: true }; }

  function loadLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.lists)) {
        state.lists = saved.lists.map(list => ({ ...blankList(list.name), ...list, contacts: (list.contacts || []).map(blankContact), undo: list.undo || [], redo: list.redo || [], separatedPairs: list.separatedPairs || [], importHashes: list.importHashes || [] }));
        state.activeListId = saved.activeListId || state.lists[0]?.id || null;
        state.dense = !!saved.dense;
      }
      state.syncQueue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    } catch (error) {
      console.error(error); toast("לא הצלחנו לקרוא את השמירה המקומית. נפתחה סביבת עבודה חדשה.", "error");
    }
    if (!state.lists.length) state.lists.push(blankList("הרשימה הראשונה"));
    if (!state.activeListId) state.activeListId = state.lists[0].id;
  }

  function persistLocal() {
    const payload = { dataVersion: CFG.DATA_VERSION || 2, activeListId: state.activeListId, dense: state.dense, lists: state.lists };
    try {
      localStorage.setItem(STORAGE_KEY + ".previous", localStorage.getItem(STORAGE_KEY) || "");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      localStorage.setItem(QUEUE_KEY, JSON.stringify(state.syncQueue));
      if (window.electronAPI?.saveWorkspace) window.electronAPI.saveWorkspace(JSON.stringify(payload)).catch(() => {});
    } catch (error) { toast("לא הצלחנו לשמור במחשב. מומלץ לייצא את הרשימה כעת.", "error"); reportError("local_save", error); }
  }

  function markChanged(list = currentList(), reason = "save") {
    if (!list) return;
    invalidateDupeCache(); // כל שינוי ברשימה מבטל את תוצאות הסריקה השמורות
    list.updatedAt = now(); list.version = Number(list.version || 0) + 1; list.dirty = true;
    clearTimeout(state.saveTimer);
    setSyncState("pending", state.user ? "ממתין לסנכרון" : "נשמר במחשב");
    state.saveTimer = setTimeout(() => { persistLocal(); if (state.user) enqueue("saveList", { list: cloudList(list), expectedVersion: list.remoteVersion || 0 }, `save:${list.id}`); }, CFG.AUTOSAVE_DELAY_MS || 1800);
    renderShell();
    safeDataLayer({ event: "ankal_change", action_name: reason });
  }

  function cloudList(list) { const copy = clone(list); delete copy.undo; delete copy.redo; delete copy.dirty; return copy; }
  function setSyncState(kind, text) { const el = document.getElementById("sync-state"); if (!el) return; el.className = "sync-state " + (kind || ""); el.querySelector("span").textContent = text; }
  function toast(message, type = "ok") { const el = document.createElement("div"); el.className = `toast ${type}`; el.textContent = message; document.getElementById("toast-zone")?.appendChild(el); setTimeout(() => el.remove(), 4800); }
  function safeDataLayer(event) { try { window.dataLayer = window.dataLayer || []; window.dataLayer.push(event); } catch (_) {} }

  function apiUrl() {
    const path = CFG.API_PATH || "/.netlify/functions/ankal-api";
    return location.protocol === "file:" ? String(CFG.SITE_URL || "").replace(/\/$/, "") + path : path;
  }
  async function api(action, payload = {}) {
    const response = await fetch(apiUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload, idToken: state.token, appVersion: CFG.APP_VERSION }) });
    const body = await response.json().catch(() => ({ ok: false, error: "INVALID_RESPONSE" }));
    if (!response.ok || body.ok === false) throw Object.assign(new Error(body.message || body.error || "השרת לא השיב"), { code: body.error, details: body });
    return body.data;
  }
  function enqueue(action, payload, key = null) {
    if (key) state.syncQueue = state.syncQueue.filter(item => item.key !== key);
    state.syncQueue.push({ id: id("job"), action, payload, key, attempts: 0, createdAt: now() });
    persistLocal(); processQueue();
  }
  async function processQueue() {
    if (state.syncRunning || !state.user || !state.syncQueue.length || !navigator.onLine) return;
    state.syncRunning = true; setSyncState("pending", "מסנכרן");
    while (state.syncQueue.length && state.user && navigator.onLine) {
      const job = state.syncQueue[0];
      try {
        const result = await api(job.action, job.payload);
        if (job.action === "saveList") { const list = state.lists.find(x => x.id === job.payload.list.id); if (list) { list.remoteVersion = result.version; list.dirty = false; } }
        state.syncQueue.shift(); persistLocal();
      } catch (error) {
        if (error.code === "VERSION_CONFLICT") { state.syncQueue.shift(); await handleSyncConflict(job.payload.list, error.details?.data); persistLocal(); }
        else { job.attempts++; job.lastError = error.message; persistLocal(); setSyncState("error", "לא הצלחנו לסנכרן — ננסה שוב"); break; }
      }
    }
    state.syncRunning = false;
    if (!state.syncQueue.length) setSyncState("", state.user ? "נשמר בענן" : "נשמר במחשב");
  }
  async function handleSyncConflict(localList, remote) {
    const choice = await modal({ kicker: "התנגשות שמירה", title: "הרשימה שונתה במכשיר אחר", html: `<p>לא דרסנו אף שינוי. אפשר לשמור את העבודה המקומית כעותק חדש או להשתמש בגרסה מהענן.</p>`, buttons: [{ id: "copy", label: "שמור עותק חדש", primary: true }, { id: "remote", label: "פתח את גרסת הענן" }, { id: "later", label: "החלט אחר כך" }], dismissible: false });
    if (choice === "copy") { const copy = { ...clone(localList), id: id("list"), name: localList.name + " — עותק", version: 1, remoteVersion: 0, updatedAt: now() }; state.lists.push(copy); enqueue("saveList", { list: cloudList(copy), expectedVersion: 0 }, `save:${copy.id}`); }
    if (choice === "remote" && remote?.list) { const index = state.lists.findIndex(x => x.id === localList.id); if (index >= 0) state.lists[index] = { ...remote.list, undo: [], redo: [], dirty: false }; }
    renderAll();
  }

  function reportError(area, error) { if (!state.user) return; enqueue("error", { area, message: String(error?.message || error), userAgent: navigator.userAgent, at: now() }); }
  function logAction(action, listId = state.activeListId) { if (state.user) enqueue("log", { action, listId, at: now(), device: /Electron/i.test(navigator.userAgent) ? "desktop" : "web" }); }

  function setPage(page) {
    if (page !== "lists" && !currentList() && !["help", "admin"].includes(page)) page = "lists";
    state.page = page;
    // כל עמוד נושא גוון משלו. הסימון כאן מאפשר ל-CSS לצבוע את הכותרת, האייקון
    // ופס ההדגשה לפי העמוד הפעיל, כך שהמיקום במערכת מזוהה בצבע ולא רק בטקסט.
    document.getElementById("app-shell").dataset.activePage = page;
    document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
    document.querySelectorAll("[data-page-panel]").forEach(el => el.classList.toggle("active", el.dataset.pagePanel === page));
    const [kicker, title] = PAGE_TITLES[page] || PAGE_TITLES.lists;
    document.getElementById("page-kicker").textContent = kicker; document.getElementById("page-title").textContent = title;
    if (page === "help") showHelp("start");
    if (page === "admin") loadAdmin();
    renderAll();
  }
  const ENTRY_CHOICE_KEY = "ankal.entryChoice";

  function enterApp(page = "lists") {
    document.getElementById("landing").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");
    setPage(page);
    askHowToWork();
  }

  /* בכניסה שואלים פעם אחת איך לעבוד: חשבון Google (הרשימות נשמרות בענן וזמינות
     מכל מכשיר) או מצב אופליין. מי שכבר בחר, או שכבר מחובר, לא נשאל שוב — אפשר
     לשנות בכל רגע מכרטיס החשבון בתחתית התפריט. */
  async function askHowToWork() {
    if (state.user || localStorage.getItem(ENTRY_CHOICE_KEY)) return;
    if (String(CFG.GOOGLE_WEB_CLIENT_ID || "").includes("PASTE_")) return; // כניסה לא מוגדרת
    const choice = await modal({
      kicker: "ברוכים הבאים לאנק״ל",
      title: "איך תרצו לעבוד?",
      dismissible: false,
      /* שתי האפשרויות הן הכפתורים עצמם. data-modal-choice הוא אותו מנגנון
         שמפעיל את כפתורי התחתית, ולכן אין צורך בשורת כפתורים נוספת שחוזרת
         על אותה בחירה פעמיים. */
      html: `<div class="entry-choices">
          <button class="entry-choice primary" data-modal-choice="google">
            <span class="entry-icon">☁</span>
            <span class="entry-copy"><strong>כניסה עם חשבון Google</strong>
              <span>הרשימות נשמרות בענן, זמינות מכל מחשב, ולא הולכות לאיבוד אם משהו קורה למחשב.</span></span>
            <span class="entry-go">←</span>
          </button>
          <button class="entry-choice" data-modal-choice="offline">
            <span class="entry-icon">▣</span>
            <span class="entry-copy"><strong>עבודה במצב אופליין</strong>
              <span>הכול נשאר במחשב הזה בלבד, בלי חשבון ובלי אינטרנט. אפשר להתחבר מאוחר יותר ולהעלות את הרשימות.</span></span>
            <span class="entry-go">←</span>
          </button>
        </div>`,
      buttons: []
    });
    if (choice === "google") { localStorage.setItem(ENTRY_CHOICE_KEY, "google"); googleLogin(); return; }
    // חלון אחר שנפתח באותו רגע דוחק את זה החוצה. זו לא בחירה, אז נשאל שוב בפעם הבאה.
    if (choice !== "offline") return;
    localStorage.setItem(ENTRY_CHOICE_KEY, "offline");
    toast("עובדים במצב אופליין. אפשר להתחבר בכל רגע מכרטיס החשבון בתחתית התפריט.");
  }

  /* הורדת תוכנת Windows מדף הנחיתה. הקישור מגיע מ-config.js כדי שאפשר יהיה
     לעדכן אותו בלי לגעת בקוד. */
  async function downloadApp() {
    const url = String(CFG.DOWNLOAD_URL || "").trim();
    if (url && await fileExists(url)) {
      window.open(url, "_blank", "noopener");
      logAction("download_app");
      return;
    }
    modal({
      kicker: "תוכנה למחשב", title: "הקובץ עדיין לא פורסם",
      html: `<p>גרסת ה־Windows של אנק״ל קיימת, אבל קובץ ההתקנה עדיין לא הועלה לאתר.</p>
             <p>בינתיים אפשר לעבוד באתר במלוא היכולות — הוא עושה בדיוק את אותו הדבר, והנתונים נשמרים באותה צורה.</p>`,
      buttons: [{ id: "close", label: "המשך באתר", primary: true }]
    });
  }
  /* בדיקה מקדימה, כדי שמשתמש לא ייפול על 404 כשהקובץ עוד לא הועלה. כתובת
     חיצונית חוסמת HEAD בגלל CORS, ולכן שם מדלגים על הבדיקה ופשוט פותחים. */
  async function fileExists(url) {
    if (!url.startsWith("/")) return true;
    try { return (await fetch(url, { method: "HEAD" })).ok; } catch (_) { return false; }
  }
  /* רק בתוך תוכנת השולחן העבודה אין דף נחיתה — שם המשתמש כבר "נכנס" בעצם
     ההפעלה. הבדיקה היא על גשר ה-Electron ולא על file://, כי פתיחת הקובץ
     מהדיסק בדפדפן רגיל היא גם file:// והסתירה את דף הנחיתה בלי סיבה. */
  function isDesktopApp() { return Boolean(window.electronAPI); }
  function showLanding() { if (isDesktopApp()) return; document.getElementById("app-shell").classList.add("hidden"); document.getElementById("landing").classList.remove("hidden"); }
  function toggleTheme() { const next = document.documentElement.dataset.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = next; localStorage.setItem("ankal.theme", next); document.querySelectorAll("[data-theme-icon]").forEach(el => el.textContent = next === "light" ? "☀" : "☾"); }

  function renderAll() { renderShell(); renderLists(); renderContacts(); if (state.review) renderReview(); }
  function renderShell() {
    const list = currentList();
    document.getElementById("nav-contact-count").textContent = list?.contacts.length || 0;
    // המונה מוצג רק אחרי שהורצה בדיקה — אחרת כל רינדור היה גורר סריקה מלאה.
    document.getElementById("nav-dupe-count").textContent = state.review ? (currentDupeGroups().length || "") : "";
    document.getElementById("active-list-name").textContent = list?.name || "ללא רשימה";
    document.getElementById("undo-btn").disabled = !list?.undo?.length; document.getElementById("redo-btn").disabled = !list?.redo?.length;
    document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", !state.user?.isAdmin));
  }
  function renderLists() {
    const grid = document.getElementById("list-grid"); if (!grid) return;
    const q = state.listSearch.trim().toLowerCase();
    const lists = state.lists.filter(x => !x.deletedAt && (!q || x.name.toLowerCase().includes(q))).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    document.getElementById("lists-empty").classList.toggle("hidden", lists.length > 0);
    // אותו גוון-לפי-שם כמו בכרטיסי אנשי הקשר, כדי שרשימה תזוהה בעין ולא בקריאה.
    grid.innerHTML = lists.map(list => `<article class="list-card" style="--tint:${avatarHue(list.name)}"><button class="open-list" data-open-list="${esc(list.id)}" aria-label="פתיחת ${esc(list.name)}"></button><div class="list-mark">${esc(initialOf(list.name))}</div><button class="icon-btn card-menu" data-list-menu="${esc(list.id)}" aria-label="אפשרויות רשימה">⋮</button><h3>${esc(list.name)}</h3><p>${list.contacts.length} אנשי קשר</p><footer><span>${list.dirty && state.user ? "ממתין לסנכרון" : "עודכן " + fmtDate(list.updatedAt)}</span></footer></article>`).join("");
  }
  // מפתח הטלפון נושא קידומת סוג (IL:/INT:) שלא אמורה להשתתף בחיפוש החופשי.
  function searchablePhone(value) { return normalizePhone(value).replace(/^(?:IL|INT):/, ""); }
  function filteredContacts() {
    const list = currentList(); if (!list) return [];
    const q = state.search.trim().toLowerCase(); const qDigits = q.replace(/\D/g, "");
    if (!q) return list.contacts;
    return list.contacts.filter(c => FIELDS.some(field => String(c[field] || "").toLowerCase().replace(/\s+/g, " ").includes(q)) || (qDigits && PHONE_FIELDS.some(field => searchablePhone(c[field]).includes(qDigits))));
  }
  /* צבע קבוע לכל שם: אותו איש קשר יקבל תמיד את אותו גוון, כך שהעין מזהה אותו
     ברשימה בלי לקרוא. גוון בלבד — הבהירות והרוויה נקבעות ב-CSS, כדי שהצבעים
     יישארו קריאים במצב בהיר ובמצב כהה. */
  function avatarHue(name) {
    let hash = 0;
    for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) % 360;
    return hash;
  }
  function initialOf(name) {
    const clean = String(name).trim().replace(/^["'׳״]+/, "");
    return [...clean][0] || "?";
  }

  function renderContacts() {
    const grid = document.getElementById("contact-grid"); if (!grid) return;
    const all = filteredContacts(); const existing = new Set(currentList()?.contacts.map(c => c.id) || []);
    state.selected = new Set([...state.selected].filter(x => existing.has(x)));
    grid.classList.toggle("compact", state.dense);
    /* מציירים רק עמוד אחד. הדפדוף היה מחווט אבל הרינדור התעלם ממנו וצייר את
       כל הרשימה, כך שרשימה של אלפי אנשי קשר בנתה אלפי כרטיסים בכל שינוי. */
    const shown = all.slice(0, state.visibleLimit);
    grid.innerHTML = shown.map(c => {
      const phones = PHONE_FIELDS.filter(f => c[f]).map(f => `<div class="contact-line ${f}"><b>${LABELS[f]}</b><span dir="ltr">${esc(c[f])}</span></div>`).join("");
      const name = c.name || "ללא שם";
      return `<article class="contact-card ${state.selected.has(c.id) ? "selected" : ""}" style="--tint:${avatarHue(name)}">`
        + `<button class="contact-open" data-open-contact="${c.id}" aria-label="עריכת ${esc(name)}"></button>`
        + `<input class="contact-select" data-select-contact="${c.id}" type="checkbox" ${state.selected.has(c.id) ? "checked" : ""} aria-label="בחירת ${esc(name)}">`
        + `<div class="contact-head"><span class="contact-avatar">${esc(initialOf(name))}</span><h3>${esc(name)}</h3></div>`
        + phones
        + (c.email ? `<div class="contact-line email-line"><b>מייל</b><span dir="ltr">${esc(c.email)}</span></div>` : "")
        + (c.note ? `<div class="contact-line note-line"><b>הערה</b><span class="contact-note">${esc(c.note)}</span></div>` : "")
        + `<div class="card-actions"><button class="icon-btn" data-open-contact="${c.id}" aria-label="עריכה">✎</button></div></article>`;
    }).join("");
    document.getElementById("contacts-empty").classList.toggle("hidden", !!shown.length || !currentList());
    const remaining = all.length - shown.length;
    document.getElementById("load-more-wrap").classList.toggle("hidden", remaining <= 0);
    if (remaining > 0) {
      const step = Math.min(remaining, CFG.CONTACTS_PAGE_SIZE || 100);
      document.querySelector('[data-action="load-more"]').textContent = `הצגת ${step} נוספים · נשארו ${remaining}`;
    }
    updateSelectionUi();
  }

  function updateSelectionUi() {
    const count = state.selected.size;
    document.getElementById("selected-count").textContent = count;
    document.getElementById("delete-selected-btn").disabled = !count;
    document.getElementById("move-selected-btn").disabled = !count;
  }

  /* סימון כרטיס נוגע רק בכרטיס שנלחץ ובמונה. קודם כל לחיצה בנתה מחדש את כל
     הרשת, וזו הייתה ההשהיה בין הלחיצה לבין הופעת הסימון. */
  function setSelected(id, on, checkbox) {
    if (on) state.selected.add(id); else state.selected.delete(id);
    (checkbox || document.querySelector(`[data-select-contact="${CSS.escape(id)}"]`))
      ?.closest(".contact-card")?.classList.toggle("selected", on);
    updateSelectionUi();
  }

  function createList() { modal({ kicker: "רשימה חדשה", title: "איך לקרוא לרשימה?", html: `<label class="modal-field">שם הרשימה<input id="modal-list-name" value="רשימה חדשה" maxlength="80"></label>`, buttons: [{ id: "create", label: "יצירת רשימה", primary: true }, { id: "cancel", label: "ביטול" }] }).then(choice => { if (choice !== "create") return; const name = document.getElementById("modal-list-name")?.value.trim() || "רשימה חדשה"; const list = blankList(name); state.lists.push(list); state.activeListId = list.id; persistLocal(); markChanged(list, "create_list"); setPage("contacts"); logAction("create_list", list.id); }); }
  function openList(listId) { if (!state.lists.some(x => x.id === listId)) return; state.activeListId = listId; state.search = ""; state.selected.clear(); state.visibleLimit = CFG.CONTACTS_PAGE_SIZE || 100; document.getElementById("contact-search").value = ""; persistLocal(); setPage("contacts"); }
  function renameList() { const list = currentList(); if (!list) return; modal({ kicker: "שם הרשימה", title: "שינוי שם", html: `<label class="modal-field">שם חדש<input id="modal-list-name" value="${esc(list.name)}" maxlength="80"></label>`, buttons: [{ id: "save", label: "שמירה", primary: true }, { id: "cancel", label: "ביטול" }] }).then(choice => { if (choice !== "save") return; const name = document.getElementById("modal-list-name")?.value.trim(); if (!name) return toast("יש להכניס שם לרשימה", "warning"); list.name = name; markChanged(list, "rename_list"); renderAll(); }); }
  function listMenu(listId) { const list = state.lists.find(x => x.id === listId); if (!list) return; modal({ kicker: "אפשרויות רשימה", title: list.name, html: `<p>${list.contacts.length} אנשי קשר · עודכן ${fmtDate(list.updatedAt)}</p>`, buttons: [{ id: "open", label: "פתיחה", primary: true }, { id: "rename", label: "שינוי שם" }, { id: "delete", label: "העברה לסל" }, { id: "cancel", label: "סגירה" }] }).then(choice => { if (choice === "open") openList(listId); if (choice === "rename") { state.activeListId = listId; renameList(); } if (choice === "delete") deleteList(list); }); }
  function deleteList(list) { list.deletedAt = now(); markChanged(list, "delete_list"); if (state.user) enqueue("deleteList", { listId: list.id }, null); if (state.activeListId === list.id) state.activeListId = state.lists.find(x => !x.deletedAt)?.id || null; persistLocal(); renderAll(); toast("הרשימה הועברה לסל המחזור"); logAction("delete_list", list.id); }

  function openDrawer(contactId = null) {
    const contact = contactId ? currentList()?.contacts.find(c => c.id === contactId) : blankContact();
    if (!contact) return;
    document.getElementById("contact-id").value = contactId || "";
    for (const field of FIELDS) document.getElementById("contact-" + field).value = contact[field] || "";
    document.getElementById("drawer-title").textContent = contactId ? contact.name || "ללא שם" : "איש קשר חדש";
    document.getElementById("drawer-delete").classList.toggle("hidden", !contactId);
    document.getElementById("contact-drawer").classList.add("open"); document.getElementById("drawer-shade").classList.add("open"); document.getElementById("contact-drawer").setAttribute("aria-hidden", "false");
    setTimeout(() => document.getElementById("contact-name").focus(), 150);
  }
  function closeDrawer() { clearTimeout(state.drawerTimer); document.getElementById("contact-drawer").classList.remove("open"); document.getElementById("drawer-shade").classList.remove("open"); document.getElementById("contact-drawer").setAttribute("aria-hidden", "true"); }
  function drawerValues() { const values = {}; for (const field of FIELDS) values[field] = document.getElementById("contact-" + field).value.trim(); return values; }
  function saveDrawer(close = false) {
    const list = currentList(); if (!list) return;
    const contactId = document.getElementById("contact-id").value; const values = drawerValues();
    if (!values.name) return toast("יש להכניס שם", "warning");
    if (contactId) { const contact = list.contacts.find(c => c.id === contactId); if (!contact) return; const before = clone(contact); Object.assign(contact, values); recordChange(list, "עריכת איש קשר", [before], [clone(contact)]); }
    else { const contact = blankContact(values); list.contacts.push(contact); document.getElementById("contact-id").value = contact.id; document.getElementById("drawer-delete").classList.remove("hidden"); recordChange(list, "הוספת איש קשר", [null], [clone(contact)]); }
    markChanged(list, "save_contact"); renderAll(); document.getElementById("drawer-save-state").textContent = "נשמר"; if (close) closeDrawer();
  }
  function deleteDrawer() { const cid = document.getElementById("contact-id").value; const contact = currentList()?.contacts.find(c => c.id === cid); if (!contact) return; confirmBox("מחיקת איש קשר", `למחוק את ${contact.name}?`, "מחיקה").then(ok => { if (!ok) return; const list = currentList(); list.contacts = list.contacts.filter(c => c.id !== cid); recordChange(list, "מחיקת איש קשר", [clone(contact)], [null]); markChanged(list, "delete_contact"); closeDrawer(); renderAll(); }); }

  function recordChange(list, label, before, after) { list.undo = list.undo || []; list.redo = []; list.undo.push({ id: id("change"), label, before, after, at: now() }); if (list.undo.length > 50) list.undo.shift(); }
  function applyChange(list, action, side) { const other = side === "before" ? "after" : "before"; const ids = new Set([...(action[side] || []), ...(action[other] || [])].filter(Boolean).map(c => c.id)); list.contacts = list.contacts.filter(c => !ids.has(c.id)); for (const item of action[side] || []) if (item) list.contacts.push(clone(item)); }
  function undo() { const list = currentList(); const action = list?.undo?.pop(); if (!action) return; applyChange(list, action, "before"); list.redo.push(action); state.selected.clear(); markChanged(list, "undo"); toast(`בוטל: ${action.label}`); renderAll(); }
  function redo() { const list = currentList(); const action = list?.redo?.pop(); if (!action) return; applyChange(list, action, "after"); list.undo.push(action); state.selected.clear(); markChanged(list, "redo"); toast(`בוצע שוב: ${action.label}`); renderAll(); }

  /* מנוע איתור הכפולים והסימונים יושב ב-dedupe.js — קוד טהור בלי DOM, שהבדיקות
     האוטומטיות ב-tests/dedupe.test.js מריצות בדיוק כמו שהאתר מריץ אותו. */
  const ENGINE = window.ANKAL_DEDUPE;
  const normalizePhone = ENGINE.normalizePhone;
  const pairKey = ENGINE.pairKey;
  const proposeMerge = ENGINE.proposeMerge;
  const mergeContacts = ENGINE.mergeContacts;

  function repairIsraeliPhone(value) { const raw = String(value ?? "").trim(); const digits = raw.replace(/\D/g, ""); if (/^[57]\d{8}$/.test(digits) || /^[23489]\d{7}$/.test(digits)) return "0" + digits; return raw; }

  /* ──── בקרת איכות: אשף אחד לסימונים ולכפולים ────
     לכל סוג בעיה יש מסך משלו שאומר כמה נמצאו ונותן שתי דרכים: לטפל בכולם בבת
     אחת, או לעבור אחד-אחד. אותו קוד משרת את דף "בדיקת כפולים" (כפולים בלבד)
     ואת דף "ניהול חכם" (קודם הסימונים, אחר כך הכפולים). */

  const REVIEW_SCOPES = {
    duplicates: { panel: "dupe-review", progress: "dupe-progress", symbols: false },
    smart: { panel: "smart-review", progress: "smart-progress", symbols: true }
  };

  /* תוצאות הסריקה מחושבות מחדש מהרשימה החיה ולא נשמרות כתמונת מצב: קבוצה
     שמוזגה כבר לא קיימת, וכרטיס שנוקה כבר לא נושא את הסימון. 2.0 עבד מול
     תמונת מצב ישנה, ולכן הציג קבוצות שהכרטיסים שלהן כבר נמחקו. */
  let dupeCache = { token: null, groups: [] };
  function invalidateDupeCache() { dupeCache.token = null; }
  function currentDupeGroups() {
    const list = currentList();
    if (!list) return [];
    const token = `${list.id}:${list.contacts.length}:${list.undo.length}:${list.redo.length}:${list.separatedPairs.length}`;
    if (dupeCache.token !== token) {
      dupeCache = { token, groups: ENGINE.findDuplicateGroups(list.contacts, { separatedPairs: list.separatedPairs }) };
    }
    return dupeCache.groups;
  }

  function stepItems(step) {
    const list = currentList();
    if (!list) return [];
    if (step.kind === "symbol") {
      const regex = ENGINE.patternRegex(step.key);
      return list.contacts.filter((contact) => { regex.lastIndex = 0; return regex.test(contact.name); });
    }
    return currentDupeGroups().filter((group) => group.category === step.key);
  }

  function scanReview(scopeKey) {
    const scope = REVIEW_SCOPES[scopeKey];
    const list = currentList();
    if (!list) return toast("צריך לפתוח רשימה לפני הבדיקה", "warning");
    const progress = document.getElementById(scope.progress);
    const panel = document.getElementById(scope.panel);
    progress.classList.remove("hidden");
    panel.innerHTML = "";
    // נותנים לדפדפן לצייר את פס ההתקדמות לפני הסריקה עצמה.
    setTimeout(() => {
      try {
        invalidateDupeCache();
        const steps = [];
        if (scope.symbols) {
          for (const group of ENGINE.findSymbolGroups(list.contacts)) {
            steps.push({ kind: "symbol", key: group.key, title: group.label, desc: "סימון שנדבק לשם ואינו חלק ממנו", tone: "warn", icon: "✦", bulk: "הסר מכולם" });
          }
        }
        for (const entry of ENGINE.buildQueue(currentDupeGroups())) {
          steps.push({ kind: "dupe", key: entry.key, title: entry.title, desc: entry.desc, tone: entry.tone, icon: entry.icon, bulk: entry.bulk });
        }
        state.review = { scope: scopeKey, steps, stepIndex: 0, itemIndex: 0, screen: "overview", stats: { symbols: 0, merged: 0, skipped: 0 } };
        renderReview();
        const total = steps.reduce((sum, step) => sum + stepItems(step).length, 0);
        toast(total ? `הבדיקה הסתיימה: ${total} פריטים לטיפול` : "הבדיקה הסתיימה — לא נמצא מה לתקן");
      } catch (error) {
        toast("לא הצלחנו להשלים את הבדיקה", "error");
        reportError("quality_scan", error);
      } finally {
        progress.classList.add("hidden");
      }
    }, 60);
  }

  function renderReview() {
    const review = state.review;
    if (!review) return;
    const panel = document.getElementById(REVIEW_SCOPES[review.scope].panel);
    if (!panel) return;
    // שלב שנפתר במלואו יורד מהתור מעצמו, כדי שהאשף לא יציג מסך ריק.
    if (review.screen === "step" || review.screen === "item") {
      while (review.stepIndex < review.steps.length && !stepItems(review.steps[review.stepIndex]).length) {
        review.stepIndex++;
        review.itemIndex = 0;
        review.screen = "step";
      }
      if (review.stepIndex >= review.steps.length) review.screen = "done";
    }
    panel.innerHTML =
      review.screen === "overview" ? reviewOverviewHtml() :
      review.screen === "step" ? reviewStepHtml() :
      review.screen === "item" ? reviewItemHtml() : reviewDoneHtml();
    renderShell();
  }

  function liveSteps() {
    return state.review.steps
      .map((step) => ({ step, count: stepItems(step).length }))
      .filter((entry) => entry.count > 0);
  }

  function reviewOverviewHtml() {
    const live = liveSteps();
    if (!live.length) {
      return `<div class="qdone"><div class="qdone-mark">✓</div><h2>הרשימה נקייה</h2>
        <p>לא נמצאו סימונים חריגים ולא אנשי קשר כפולים.</p></div>`;
    }
    const total = live.reduce((sum, entry) => sum + entry.count, 0);
    const card = ({ step, count }) => `
      <button class="qcard ${step.tone}" data-review-jump="${esc(step.key)}">
        <span class="qcard-icon">${esc(step.icon || "•")}</span>
        <span class="qcard-num">${count}</span>
        <span class="qcard-title">${esc(step.title)}</span>
        <span class="qcard-desc">${esc(step.desc)}</span>
      </button>`;
    /* שני האזורים מופרדים כי הם שני סוגי עבודה שונים: ניקוי טקסט מול איחוד
       כרטיסים. בערבוב אחד גדול היה קשה לראות במה מדובר. */
    const section = (title, hint, entries) => entries.length ? `
      <div class="qgroup">
        <div class="qgroup-head"><h3>${esc(title)}</h3></div>
        <p class="qgroup-hint">${esc(hint)}</p>
        <div class="qcards">${entries.map(card).join("")}</div>
      </div>` : "";
    const symbols = live.filter(({ step }) => step.kind === "symbol");
    const dupes = live.filter(({ step }) => step.kind === "dupe");
    const autoCount = dupes.filter(({ step }) => step.key === "exact" || step.key === "safe")
      .reduce((sum, entry) => sum + entry.count, 0);
    return `
      <div class="qsummary">
        <h2>הבדיקה הושלמה</h2>
        <p class="qlead">נמצאו <strong>${total}</strong> פריטים ב-${live.length} סוגים. נעבור עליהם לפי הסדר — קודם מה שבטוח, ואחר כך רק מה שדורש החלטה שלכם.</p>
        ${section("סימונים בשמות", "תווים שנדבקו לשם ואינם חלק ממנו. כדאי לנקות אותם קודם — הם מסתירים כפילויות.", symbols)}
        ${section("אנשי קשר כפולים", "כרטיסים שנראים כמו אותו אדם, מסודרים מהוודאי אל המסופק.", dupes)}
        <div class="qactions">
          <button class="btn btn-primary" data-action="review-start">בוא נתחיל ←</button>
          ${autoCount ? `<button class="btn btn-secondary" data-action="review-auto">מזג את ${autoCount} הכפולים הוודאיים</button>` : ""}
        </div>
        <p class="qnote">אפשר גם ללחוץ על כרטיס כדי לקפוץ ישר לסוג הזה.</p>
      </div>`;
  }

  function reviewNavHtml() {
    const review = state.review;
    const percent = Math.round(review.stepIndex / Math.max(review.steps.length, 1) * 100);
    return `
      <div class="qnav">
        <span class="qnav-step">שלב ${Math.min(review.stepIndex + 1, review.steps.length)} מתוך ${review.steps.length}</span>
        <div class="qbar"><i style="width:${percent}%"></i></div>
        <button class="btn btn-quiet btn-sm" data-action="review-overview">לסיכום</button>
      </div>`;
  }

  function reviewStepHtml() {
    const review = state.review;
    const step = review.steps[review.stepIndex];
    const items = stepItems(step);
    const isSymbol = step.kind === "symbol";
    const shown = isSymbol ? 6 : 4;
    const chips = items.slice(0, shown).map((item) => {
      const label = isSymbol ? item.name : item.contacts.map((c) => c.name).filter(Boolean)[0] || "ללא שם";
      return `<span class="qchip">${esc(label)}</span>`;
    }).join("");
    const canBulk = isSymbol || ENGINE.canBulkApply(step.key);
    return `
      ${reviewNavHtml()}
      <div class="qstep ${step.tone}" data-step-kind="${isSymbol ? "symbol" : "dupe"}" data-step-key="${esc(step.key)}">
        <span class="qstep-kind">${isSymbol ? "סימון בשמות" : "כפולים"}</span>
        <h2><span class="qstep-icon">${esc(step.icon || "•")}</span>${esc(step.title)}</h2>
        <p class="qlead">${isSymbol
          ? `נמצאו <strong>${items.length}</strong> אנשי קשר עם הסימון הזה.`
          : `נמצאו <strong>${items.length}</strong> קבוצות מהסוג הזה.`} ${esc(step.desc)}</p>
        <div class="qchips">${chips}${items.length > shown ? `<span class="qchip muted">ועוד ${items.length - shown}</span>` : ""}</div>
        <div class="qactions">
          <button class="btn btn-primary" data-action="review-one-by-one">עבור אחד אחד ←</button>
          ${canBulk ? `<button class="btn btn-secondary" data-action="review-bulk">${esc(step.bulk)}</button>` : ""}
          <button class="btn btn-quiet" data-action="review-skip-step">דלג על הסוג הזה</button>
        </div>
        ${canBulk ? "" : `<p class="qnote">לסוג הזה אין ברירת מחדל שאפשר לסמוך עליה — כאן צריך להחליט אחד אחד.</p>`}
      </div>`;
  }

  function reviewItemHtml() {
    const review = state.review;
    const step = review.steps[review.stepIndex];
    const items = stepItems(step);
    if (review.itemIndex >= items.length) { review.screen = "step"; return reviewStepHtml(); }
    const position = `${review.itemIndex + 1} / ${items.length}`;
    return step.kind === "symbol"
      ? symbolItemHtml(step, items[review.itemIndex], position)
      : dupeItemHtml(step, items[review.itemIndex], position);
  }

  function symbolItemHtml(step, contact, position) {
    const after = ENGINE.applyPatternRemove(contact.name, step.key);
    return `
      ${reviewNavHtml()}
      <div class="qitem">
        <p class="qitem-pos">${position} · ${esc(step.title)}</p>
        <div class="qrename">
          <div><span class="qlabel">השם היום</span><div class="qname">${esc(contact.name)}</div></div>
          <div class="qarrow">←</div>
          <div><span class="qlabel">אחרי ההסרה</span><div class="qname qname-new">${esc(after)}</div></div>
        </div>
        <div class="qactions">
          <button class="btn btn-primary" data-action="review-apply">הסר ✓</button>
          <button class="btn btn-quiet" data-action="review-skip-item">השאר כמו שהוא ←</button>
        </div>
      </div>`;
  }

  function dupeItemHtml(step, group, position) {
    const proposal = proposeMerge(group.contacts);
    const columns = ENGINE.FIELDS.filter((field) => group.contacts.some((contact) => contact[field]));
    const table = `
      <div class="qtable-wrap">
        <table class="qtable">
          <thead><tr>${columns.map((field) => `<th>${esc(LABELS[field])}</th>`).join("")}</tr></thead>
          <tbody>${group.contacts.map((contact) =>
            `<tr>${columns.map((field) => `<td>${esc(contact[field] || "—")}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;

    let questions = "";
    if (group.conflicts.includes("name")) {
      const names = ENGINE.fieldValues(group.contacts, "name");
      const suggested = names.indexOf(proposal.name);
      questions += `
        <div class="qq">
          <div class="qq-title">איזה שם להשאיר?</div>
          <div class="qq-options">
            ${names.map((name, index) => `
              <label class="qradio"><input type="radio" name="q-name" value="${index}" ${index === suggested ? "checked" : ""}>
              <span>${esc(name)}${index === suggested ? ' <em class="qtag">מוצע</em>' : ""}</span></label>`).join("")}
            <label class="qradio"><input type="radio" name="q-name" value="custom"><span>שם אחר:</span>
              <input type="text" id="q-name-custom" class="qinline" placeholder="הקלידו שם" data-checks="q-name"></label>
          </div>
          <input type="hidden" id="q-name-values" value="${esc(JSON.stringify(names))}">
        </div>`;
    }

    const phoneConflict = group.conflicts.some((field) => ENGINE.PHONE_FIELDS.includes(field));
    if (proposal.numbers.length && (phoneConflict || proposal.numbers.length > 1)) {
      const slots = [...ENGINE.PHONE_FIELDS.map((field) => ({ key: field, label: LABELS[field] })), { key: "", label: "לא לכלול" }];
      questions += `
        <div class="qq">
          <div class="qq-title">לאן לשייך כל מספר?</div>
          <p class="qq-hint">זיהינו לפי מבנה המספר והצענו את המשבצת הסבירה. אפשר לשנות.</p>
          ${proposal.numbers.map((number, index) => `
            <div class="qphone">
              <span class="qphone-num">${esc(number.value)}</span>
              <select data-qslot="${index}">
                ${slots.map((slot) => `<option value="${slot.key}" ${slot.key === number.slot ? "selected" : ""}>${esc(slot.label)}</option>`).join("")}
              </select>
            </div>`).join("")}
          <input type="hidden" id="q-phone-values" value="${esc(JSON.stringify(proposal.numbers.map((n) => n.value)))}">
        </div>`;
    }

    for (const field of ["email", "note"]) {
      if (!group.conflicts.includes(field)) continue;
      const values = ENGINE.fieldValues(group.contacts, field);
      questions += `
        <div class="qq">
          <div class="qq-title">איזה ${esc(LABELS[field])} להשאיר?</div>
          <div class="qq-options">
            ${values.map((value, index) => `
              <label class="qradio"><input type="radio" name="q-${field}" value="${index}" ${index === 0 ? "checked" : ""}>
              <span>${esc(value)}</span></label>`).join("")}
            <label class="qradio"><input type="radio" name="q-${field}" value="-1"><span>— להשאיר ריק —</span></label>
          </div>
          <input type="hidden" id="q-${field}-values" value="${esc(JSON.stringify(values))}">
        </div>`;
    }

    const headline = group.weak ? "יכול להיות אותו אדם — ויכול שלא"
      : group.exact ? "שני הכרטיסים זהים לחלוטין"
      : group.safe ? "אין סתירה בין הכרטיסים — רק מידע שחסר באחד מהם"
      : group.complex ? "הכרטיסים חוברו דרך שרשרת התאמות, לא התאמה ישירה"
      : "יש הבדלים שצריך להכריע בהם";
    const merged = ENGINE.mergeContacts(group.contacts);
    const previewFields = ENGINE.FIELDS.filter((field) => merged[field]);

    return `
      ${reviewNavHtml()}
      <div class="qitem">
        <p class="qitem-pos">${position} · ${esc(step.title)}${group.total ? ` · התאמה ${Math.round(group.score * 100)}%` : ""}</p>
        <h2>${esc(proposal.name || "ללא שם")}${group.contacts.length > 2 ? ` (${group.contacts.length} כרטיסים)` : ""}</h2>
        <p class="qlead">${esc(headline)}</p>
        ${table}
        ${questions}
        ${questions ? "" : `<div class="qpreview"><span class="qlabel">הכרטיס אחרי המיזוג</span>
          <div>${previewFields.map((field) => `<b>${esc(LABELS[field])}:</b> ${esc(merged[field])}`).join(" · ")}</div></div>`}
        <div class="qactions">
          <button class="btn btn-primary" data-action="review-apply">${questions ? "אשר ומזג ✓" : "מזג ✓"}</button>
          <button class="btn btn-secondary" data-action="review-separate">אלה אנשים שונים — השאר נפרדים</button>
          <button class="btn btn-quiet" data-action="review-skip-item">דלג ←</button>
        </div>
      </div>`;
  }

  function reviewDoneHtml() {
    const stats = state.review.stats;
    const parts = [];
    if (stats.symbols) parts.push(`נוקו <strong>${stats.symbols}</strong> שמות`);
    if (stats.merged) parts.push(`מוזגו <strong>${stats.merged}</strong> קבוצות`);
    if (stats.skipped) parts.push(`דילגתם על <strong>${stats.skipped}</strong>`);
    return `
      <div class="qdone">
        <div class="qdone-mark">✓</div>
        <h2>סיימנו</h2>
        <p>${parts.length ? parts.join(", ") + "." : "לא בוצעו שינויים."} ברשימה ${currentList()?.contacts.length || 0} אנשי קשר.</p>
        <div class="qactions">
          <button class="btn btn-primary" data-action="review-rescan">סרוק שוב</button>
          <button class="btn btn-quiet" data-action="review-overview">לסיכום</button>
        </div>
      </div>`;
  }

  /* ──── פעולות האשף ──── */

  function reviewStart() {
    const review = state.review; if (!review) return;
    review.stepIndex = 0; review.itemIndex = 0; review.screen = "step";
    renderReview();
  }
  function reviewJump(stepKey) {
    const review = state.review; if (!review) return;
    const index = review.steps.findIndex((step) => step.key === stepKey);
    if (index < 0) return;
    review.stepIndex = index; review.itemIndex = 0; review.screen = "step";
    renderReview();
  }
  function reviewOverview() {
    const review = state.review; if (!review) return;
    review.screen = "overview";
    renderReview();
  }
  function reviewOneByOne() {
    const review = state.review; if (!review) return;
    review.itemIndex = 0; review.screen = "item";
    renderReview();
  }
  function reviewSkipStep() {
    const review = state.review; if (!review) return;
    review.stats.skipped += stepItems(review.steps[review.stepIndex]).length;
    review.stepIndex++; review.itemIndex = 0; review.screen = "step";
    renderReview();
  }
  function reviewNextStep() {
    const review = state.review;
    review.stepIndex++; review.itemIndex = 0; review.screen = "step";
    renderReview();
  }
  function reviewSkipItem() {
    const review = state.review; if (!review) return;
    review.stats.skipped++;
    review.itemIndex++;
    if (review.itemIndex >= stepItems(review.steps[review.stepIndex]).length) return reviewNextStep();
    renderReview();
  }

  function applySymbolChanges(changes, label) {
    if (!changes.length) return;
    const list = currentList(); if (!list) return;
    const byId = new Map(changes.map((change) => [change.after.id, change.after]));
    list.contacts = list.contacts.map((contact) => byId.get(contact.id) || contact);
    recordChange(list, label, changes.map((c) => c.before), changes.map((c) => c.after));
    markChanged(list, "symbol_clean");
  }

  function applyMerge(group, choices, label) {
    const list = currentList(); if (!list) return null;
    const merged = blankContact(ENGINE.mergeContacts(group.contacts, choices));
    const ids = new Set(group.contacts.map((contact) => contact.id));
    const before = group.contacts.map(clone);
    list.contacts = list.contacts.filter((contact) => !ids.has(contact.id));
    list.contacts.push(merged);
    recordChange(list, label, before, [clone(merged)]);
    markChanged(list, "merge");
    return merged;
  }

  /* קורא את מסך השאלות. שדה שלא נשאלה עליו שאלה נשאר ללא בחירה ונופל בחזרה
     להצעה של המנוע — ולכן מה שהמסך הראה הוא בדיוק מה שנשמר. */
  function readMergeChoices() {
    const choices = {};
    const nameChoice = document.querySelector('input[name="q-name"]:checked');
    if (nameChoice) {
      if (nameChoice.value === "custom") {
        const custom = document.getElementById("q-name-custom").value.trim();
        if (!custom) { toast("צריך להקליד שם, או לבחור אחד מהקיימים", "error"); return null; }
        choices.name = custom;
      } else {
        choices.name = JSON.parse(document.getElementById("q-name-values").value)[Number(nameChoice.value)];
      }
    }
    const slotSelects = [...document.querySelectorAll("select[data-qslot]")];
    if (slotSelects.length) {
      const numbers = JSON.parse(document.getElementById("q-phone-values").value);
      const phones = { mobile: "", home: "", work: "", fax: "" };
      const dropped = [];
      for (const select of slotSelects) {
        const number = numbers[Number(select.dataset.qslot)];
        if (!select.value) continue;
        if (phones[select.value]) { dropped.push(number); continue; }
        phones[select.value] = number;
      }
      if (dropped.length) { toast(`שני מספרים שויכו לאותה משבצת: ${dropped.join(", ")}`, "error"); return null; }
      choices.phones = phones;
    }
    for (const field of ["email", "note"]) {
      const checked = document.querySelector(`input[name="q-${field}"]:checked`);
      const holder = document.getElementById(`q-${field}-values`);
      if (!checked || !holder) continue;
      const index = Number(checked.value);
      choices[field] = index >= 0 ? JSON.parse(holder.value)[index] : "";
    }
    return choices;
  }

  function reviewApplyItem() {
    const review = state.review; if (!review) return;
    const step = review.steps[review.stepIndex];
    const items = stepItems(step);
    const item = items[review.itemIndex];
    if (!item) return reviewNextStep();

    if (step.kind === "symbol") {
      const name = ENGINE.applyPatternRemove(item.name, step.key);
      if (name && name !== item.name) {
        applySymbolChanges([{ before: clone(item), after: Object.assign(clone(item), { name }) }], `הסרת ${step.title}`);
        review.stats.symbols++;
      }
      // ההסרה מוציאה את הכרטיס מרשימת השלב, ולכן המצביע נשאר במקומו.
      if (review.itemIndex >= stepItems(step).length) return reviewNextStep();
      return renderReview();
    }

    const choices = readMergeChoices();
    if (choices === null) return; // הוולידציה נכשלה — משאירים את המסך פתוח
    const merged = applyMerge(item, choices, `מיזוג: ${choices.name || item.contacts[0].name}`);
    review.stats.merged++;
    toast(`מוזג: ${merged.name || "ללא שם"}`);
    if (review.itemIndex >= stepItems(step).length) return reviewNextStep();
    renderReview();
  }

  function reviewSeparateItem() {
    const review = state.review; if (!review) return;
    const step = review.steps[review.stepIndex];
    const group = stepItems(step)[review.itemIndex];
    if (!group) return reviewNextStep();
    const list = currentList(); if (!list) return;
    for (let i = 0; i < group.contacts.length; i++) {
      for (let j = i + 1; j < group.contacts.length; j++) {
        const key = pairKey(group.contacts[i].id, group.contacts[j].id);
        if (!list.separatedPairs.includes(key)) list.separatedPairs.push(key);
      }
    }
    markChanged(list, "keep_separate");
    toast("נשמר: אלה אנשים שונים");
    if (review.itemIndex >= stepItems(step).length) return reviewNextStep();
    renderReview();
  }

  function reviewBulk() {
    const review = state.review; if (!review) return;
    const step = review.steps[review.stepIndex];
    const items = stepItems(step);
    if (!items.length) return reviewNextStep();
    const question = step.kind === "symbol"
      ? `להסיר את הסימון מ-${items.length} אנשי קשר?`
      : `לאשר את ההצעה ולמזג ${items.length} קבוצות מסוג "${step.title}"?`;
    confirmBox(step.title, question, "אישור").then((ok) => {
      if (!ok) return;
      if (step.kind === "symbol") {
        const changes = [];
        for (const contact of items) {
          const name = ENGINE.applyPatternRemove(contact.name, step.key);
          if (name && name !== contact.name) changes.push({ before: clone(contact), after: Object.assign(clone(contact), { name }) });
        }
        applySymbolChanges(changes, `הסרת ${step.title} מכל הרשימה`);
        review.stats.symbols += changes.length;
        toast(`הוסר מ-${changes.length} אנשי קשר`);
      } else {
        review.stats.merged += mergeGroups(items, `מיזוג כל הקבוצות: ${step.title}`);
        toast(`מוזגו ${items.length} קבוצות`);
      }
      reviewNextStep();
    });
  }

  /* מיזוג אצווה בפעולת ביטול אחת. הקבוצות בקטגוריה אחת זרות זו לזו, ולכן
     אפשר לעבור עליהן ברצף בלי שמיזוג אחד ישבש את הבא אחריו. */
  function mergeGroups(groups, label) {
    const list = currentList(); if (!list) return 0;
    const before = [], after = [], removed = new Set();
    for (const group of groups) {
      before.push(...group.contacts.map(clone));
      for (const contact of group.contacts) removed.add(contact.id);
      after.push(blankContact(ENGINE.mergeContacts(group.contacts)));
    }
    list.contacts = list.contacts.filter((contact) => !removed.has(contact.id));
    list.contacts.push(...after);
    recordChange(list, label, before, after.map(clone));
    markChanged(list, "merge_bulk");
    return groups.length;
  }

  function reviewAuto() {
    const review = state.review; if (!review) return;
    const groups = currentDupeGroups().filter((group) => group.category === "exact" || group.category === "safe");
    if (!groups.length) return toast("אין כפולים ודאיים למזג", "warning");
    confirmBox("מיזוג הכפולים הוודאיים", `למזג ${groups.length} קבוצות שאין בהן שום סתירה?`, "מיזוג").then((ok) => {
      if (!ok) return;
      review.stats.merged += mergeGroups(groups, "מיזוג הכפולים הוודאיים");
      toast(`מוזגו ${groups.length} קבוצות`);
      renderReview();
    });
  }

  function reviewRescan() { scanReview(state.review.scope); }

  function quickImport() { document.getElementById("file-picker").click(); }
  async function handleFile(file) {
    const ext = file.name.split(".").pop().toLowerCase(); if (!["vcf", "xlsx", "xls", "csv"].includes(ext)) return toast("סוג הקובץ אינו נתמך. אפשר לייבא VCF, Excel או CSV בלבד.", "error");
    try {
      state.importHash = await fileHash(file);
      const list = currentList(); if (list?.importHashes?.includes(state.importHash)) { const again = await confirmBox("הקובץ כבר יובא", "נראה שהקובץ הזה כבר יובא לרשימה. האם לייבא אותו שוב?", "ייבא בכל זאת"); if (!again) return; }
      if (ext === "vcf") await importVcf(file); else await importSpreadsheet(file, ext);
    } catch (error) { if (error?.message === "IMPORT_CANCELLED") return toast("הייבוא בוטל"); console.error(error); toast("לא הצלחנו לקרוא את הקובץ. ייתכן שהוא פגום או בפורמט לא מתאים.", "error"); reportError("file_import", error); }
  }
  async function fileHash(file) { const bytes = await file.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join(""); }
  async function importVcf(file) { const text = await file.text(); const result = parseVcfDetailed(text); const prepared = []; for (const raw of result.contacts) prepared.push(await reconcile(raw)); await commitImport(prepared, file.name, result.warnings); }
  function ensureXlsx() { if (window.XLSX) return Promise.resolve(); return new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = "xlsx.full.min.js"; script.onload = resolve; script.onerror = () => reject(new Error("XLSX_LOAD_FAILED")); document.body.appendChild(script); }); }
  async function importSpreadsheet(file, ext) {
    try { await ensureXlsx(); } catch (_) { toast("לא הצלחנו להפעיל את רכיב Excel. נסו לפתוח מחדש את המערכת. אם הבעיה חוזרת, פנו לתמיכה.", "error"); return; }
    const buffer = await file.arrayBuffer(); let workbook;
    try { if (ext === "csv") { const text = await chooseCsvEncoding(buffer); if (text === null) return; workbook = XLSX.read(text, { type: "string", raw: false }); } else workbook = XLSX.read(new Uint8Array(buffer), { type: "array", raw: false }); } catch (error) { throw new Error("INVALID_SPREADSHEET"); }
    let selectedSheets = workbook.SheetNames;
    if (selectedSheets.length > 1) { selectedSheets = await chooseSheets(selectedSheets); if (!selectedSheets.length) return; }
    const imported = [];
    for (const sheetName of selectedSheets) {
      const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
      if (!matrix.length) continue;
      const headerIndex = await chooseHeaderRow(matrix, sheetName); if (headerIndex < 0) return;
      const headers = matrix[headerIndex].map((h, i) => String(h || `עמודה ${i + 1}`).trim());
      const rows = matrix.slice(headerIndex + 1).filter(row => row.some(v => String(v).trim()));
      const mapping = await chooseMapping(headers, rows[0] || []); if (!mapping) return;
      for (const row of rows) {
        const raw = rowFromMapping(row, headers, mapping); if (!raw.name && !raw.note && !raw.phones.length && !raw.emails.length) continue;
        imported.push(await reconcile(raw));
      }
    }
    await commitImport(imported, file.name, []);
  }
  async function chooseCsvEncoding(buffer) {
    const utf = new TextDecoder("utf-8").decode(buffer), win = new TextDecoder("windows-1255").decode(buffer); const broken = (utf.match(/�/g) || []).length;
    if (!broken) return utf;
    const choice = await modal({ kicker: "קידוד קובץ CSV", title: "איך להציג את העברית?", html: `<label class="modal-field">קידוד<select id="csv-encoding"><option value="windows">Windows עברית</option><option value="utf">UTF-8</option></select></label><div class="modal-list"><div class="modal-list-row"><span>תצוגה מקדימה</span><b>${esc(win.slice(0, 350))}</b></div></div>`, buttons: [{ id: "next", label: "המשך", primary: true }, { id: "cancel", label: "ביטול הייבוא וסגירת החלון" }], dismissible: false });
    if (choice !== "next") return null; return document.getElementById("csv-encoding").value === "windows" ? win : utf;
  }
  async function chooseSheets(names) { const html = `<p>בחרו גיליון אחד או כמה גיליונות לייבוא.</p>${names.map((n, i) => `<label class="check-line"><input type="checkbox" name="sheet-choice" value="${i}" checked> ${esc(n)}</label>`).join("")}`; const choice = await modal({ kicker: "קובץ עם כמה גיליונות", title: "אילו גיליונות לייבא?", html, buttons: [{ id: "next", label: "המשך", primary: true }, { id: "cancel", label: "ביטול הייבוא וסגירת החלון" }], dismissible: false }); if (choice !== "next") return []; return [...document.querySelectorAll('input[name="sheet-choice"]:checked')].map(el => names[Number(el.value)]); }
  function guessedHeaderRow(matrix) { const words = Object.values(HEADER_HINTS).flat(); let best = 0, score = -1; matrix.slice(0, 10).forEach((row, index) => { const s = row.reduce((n, cell) => n + (words.some(w => String(cell).trim().toLowerCase() === w) ? 2 : String(cell).trim() ? .1 : 0), 0); if (s > score) { score = s; best = index; } }); return best; }
  async function chooseHeaderRow(matrix, sheetName) { const guess = guessedHeaderRow(matrix); const options = matrix.slice(0, Math.min(10, matrix.length)).map((row, i) => `<option value="${i}" ${i === guess ? "selected" : ""}>שורה ${i + 1}: ${esc(row.slice(0, 4).filter(Boolean).join(" | ") || "(ריקה)")}</option>`).join(""); const choice = await modal({ kicker: `גיליון: ${sheetName}`, title: "איפה נמצאות כותרות העמודות?", html: `<label class="modal-field">שורת הכותרות<select id="header-row-choice">${options}</select></label>`, buttons: [{ id: "next", label: "המשך למיפוי", primary: true }, { id: "cancel", label: "ביטול הייבוא וסגירת החלון" }], dismissible: false }); return choice === "next" ? Number(document.getElementById("header-row-choice").value) : -1; }
  const HEADER_HINTS = { name: ["שם", "שם מלא", "name", "full name"], mobile: ["נייד", "פלאפון", "סלולרי", "mobile", "cell"], home: ["בית", "טלפון בבית", "home"], work: ["עבודה", "משרד", "work", "office"], fax: ["פקס", "fax"], email: ["מייל", "אימייל", "email", "e-mail"], note: ["הערה", "הערות", "note", "notes"] };
  function guessHeader(headers, field) { const normalized = headers.map(h => h.toLowerCase()); const hints = HEADER_HINTS[field]; let index = normalized.findIndex(h => hints.includes(h)); if (index < 0) index = normalized.findIndex(h => hints.some(x => h.includes(x))); return index; }
  async function chooseMapping(headers, sample) {
    const rows = FIELDS.map(field => { const guess = guessHeader(headers, field); return `<tr><th>${LABELS[field]}</th><td><select data-map-field="${field}"><option value="">לא לייבא</option>${headers.map((h, i) => `<option value="${i}" ${i === guess ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></td><td data-map-sample="${field}">${guess >= 0 ? esc(sample[guess] || "") : ""}</td></tr>`; }).join("");
    const choice = await modal({ kicker: "מיפוי עמודות", title: "התאימו כל עמודה לשדה", html: `<p>כל עמודה יכולה להיבחר פעם אחת בלבד.</p><div class="modal-list"><table class="data-table"><thead><tr><th>שדה</th><th>עמודה בקובץ</th><th>דוגמה</th></tr></thead><tbody>${rows}</tbody></table></div><div id="mapping-warning"></div>`, buttons: [{ id: "import", label: "המשך לייבוא", primary: true }, { id: "cancel", label: "ביטול הייבוא וסגירת החלון" }], dismissible: false, beforeResolve: value => value !== "import" || validateMapping() });
    if (choice !== "import") return null; const result = {}; document.querySelectorAll("[data-map-field]").forEach(el => result[el.dataset.mapField] = el.value === "" ? -1 : Number(el.value)); return result;
  }
  function validateMapping() { const values = [...document.querySelectorAll("[data-map-field]")].map(el => el.value).filter(Boolean); const duplicates = values.filter((v, i) => values.indexOf(v) !== i); const warning = document.getElementById("mapping-warning"); if (duplicates.length) { warning.textContent = "אותה עמודה נבחרה לכמה שדות. בחרו כל עמודה פעם אחת בלבד."; warning.style.color = "var(--danger)"; return false; } return true; }
  function rowFromMapping(row, headers, map) { const get = field => map[field] >= 0 ? String(row[map[field]] ?? "").trim() : ""; const phones = PHONE_FIELDS.map(field => ({ value: repairIsraeliPhone(get(field)), type: ({ mobile: "CELL", home: "HOME", work: "WORK", fax: "FAX" })[field] })).filter(x => x.value); const email = get("email"); return { name: get("name"), note: get("note"), phones, emails: email ? [{ value: email, type: "" }] : [] }; }
  async function reconcile(raw) {
    const contact = blankContact({ name: String(raw.name || "").replace(/\s+/g, " ").trim() || "ללא שם", note: String(raw.note || "").trim() }); const pending = [];
    for (const phone of raw.phones || []) { const value = String(phone.value || "").replace(/^tel:/i, "").trim(); if (!value) continue; const types = String(phone.type || "").toUpperCase().replace(/["']/g, "").split(/[\/,]/); const field = types.includes("CELL") ? "mobile" : types.includes("HOME") ? "home" : types.includes("WORK") ? "work" : types.includes("FAX") ? "fax" : guessPhoneField(value); if (field && !contact[field]) contact[field] = value; else pending.push({ value, suggested: field || "mobile", source: "טלפון נוסף" }); }
    for (const email of raw.emails || []) { const value = String(email.value || "").trim(); if (!value) continue; if (!contact.email) contact.email = value; else pending.push({ value, suggested: "email", source: "מייל נוסף" }); }
    for (const item of pending) await resolvePending(contact, item);
    return contact;
  }
  function guessPhoneField(value) { return ENGINE.guessPhoneKind(value) || "mobile"; }
  async function resolvePending(contact, item) {
    while (true) {
      const options = FIELDS.map(field => `<option value="${field}" ${field === item.suggested ? "selected" : ""}>${LABELS[field]}</option>`).join(""); const choice = await modal({ kicker: "ערך נוסף", title: `לאן להכניס את ${item.source}?`, html: `<p dir="ltr">${esc(item.value)}</p><label class="modal-field">שדה יעד<select id="pending-target">${options}<option value="">אל תייבא את הערך</option></select></label>`, buttons: [{ id: "choose", label: "אישור", primary: true }, { id: "cancel", label: "ביטול הייבוא וסגירת החלון" }], dismissible: false });
      if (choice === "cancel") throw new Error("IMPORT_CANCELLED"); const target = document.getElementById("pending-target").value; if (!target) return;
      if (!contact[target]) { contact[target] = item.value; return; }
      const replace = await modal({ kicker: "המקום מלא", title: "האם להחליף את הערך הקיים?", html: `<div class="modal-list"><div class="modal-list-row"><span>קיים</span><b>${esc(contact[target])}</b></div><div class="modal-list-row"><span>חדש</span><b>${esc(item.value)}</b></div></div>`, buttons: [{ id: "replace", label: "כן, החלף", primary: true }, { id: "back", label: "לא, חזור לבחירה" }, { id: "cancel", label: "ביטול הייבוא וסגירת החלון" }], dismissible: false });
      if (replace === "replace") { contact[target] = item.value; return; } if (replace === "cancel") throw new Error("IMPORT_CANCELLED");
    }
  }
  async function commitImport(contacts, filename, warnings) {
    if (!contacts.length) return toast("לא נמצאו אנשי קשר בקובץ", "warning");
    let list = currentList(); if (!list) { list = blankList(filename.replace(/\.[^.]+$/, "")); state.lists.push(list); state.activeListId = list.id; }
    let mode = "add";
    if (list.contacts.length) { mode = await modal({ kicker: "ייבוא לרשימה קיימת", title: "איך להכניס את אנשי הקשר?", html: `<p>ברשימה כבר קיימים ${list.contacts.length} אנשי קשר.</p>`, buttons: [{ id: "add", label: "הוסף לרשימה הקיימת", primary: true }, { id: "replace", label: "החלף את כל הרשימה" }, { id: "cancel", label: "ביטול הייבוא וסגירת החלון" }], dismissible: false }); if (mode === "cancel") return; }
    const before = mode === "replace" ? list.contacts.map(clone) : contacts.map(() => null); const after = contacts.map(clone); if (mode === "replace") list.contacts = contacts; else list.contacts.push(...contacts); list.importHashes = list.importHashes || []; if (state.importHash) list.importHashes.push(state.importHash); recordChange(list, `ייבוא ${contacts.length} אנשי קשר`, before, after); markChanged(list, "import"); state.activeListId = list.id; setPage("contacts"); toast(`יובאו ${contacts.length} אנשי קשר`); logAction("import", list.id);
    const unnamed = contacts.filter(c => c.name === "ללא שם").length; const report = document.getElementById("import-report"); report.innerHTML = `<h3>דוח ייבוא</h3><p>יובאו ${contacts.length} אנשי קשר.${unnamed ? ` נמצאו ${unnamed} אנשי קשר ללא שם.` : ""}</p>${warnings.length ? `<ul>${warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}`; report.classList.remove("hidden");
  }

  function downloadBlob(content, type, filename) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function safeFilename(value) { return String(value || "אנשי קשר").replace(/[\\/:*?\"<>|]/g, "-").slice(0, 80); }
  function csvSafe(value) {
    let text = String(value ?? "");
    if (/^[\s\t\r\n]*[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function rowsForExport(list = currentList()) { return (list?.contacts || []).map(c => Object.fromEntries(FIELDS.map(f => [LABELS[f], c[f] || ""]))); }
  async function exportList(format) {
    const list = currentList(); if (!list?.contacts.length) return toast("אין אנשי קשר לייצוא", "warning");
    const base = safeFilename(list.name);
    try {
      if (format === "vcf") downloadBlob(buildVcf(list.contacts), "text/vcard;charset=utf-8", base + ".vcf");
      else if (format === "csv") {
        const lines = [FIELDS.map(f => csvSafe(LABELS[f])).join(","), ...list.contacts.map(c => FIELDS.map(f => csvSafe(c[f])).join(","))];
        downloadBlob("\ufeff" + lines.join("\r\n"), "text/csv;charset=utf-8", base + ".csv");
      } else {
        await ensureXlsx(); const sheet = XLSX.utils.json_to_sheet(rowsForExport(list), { header: FIELDS.map(f => LABELS[f]) });
        const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "אנשי קשר"); XLSX.writeFile(book, base + ".xlsx", { compression: true });
      }
      toast("הקובץ מוכן להורדה"); logAction("export_" + format);
    } catch (error) { toast("לא הצלחנו להכין את הקובץ", "error"); reportError("export_" + format, error); }
  }
  async function downloadTemplate() {
    try { await ensureXlsx(); const sheet = XLSX.utils.aoa_to_sheet([FIELDS.map(f => LABELS[f]), ["ישראל ישראלי", "0501234567", "", "", "", "israel@example.com", "דוגמה — אפשר למחוק"]]); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "תבנית"); XLSX.writeFile(book, "תבנית-אנקל.xlsx"); }
    catch (_) { const header = FIELDS.map(f => csvSafe(LABELS[f])).join(","); downloadBlob("\ufeff" + header, "text/csv;charset=utf-8", "תבנית-אנקל.csv"); }
  }

  function fieldsForScope(scope) { return scope === "phone" ? PHONE_FIELDS : scope === "all" ? FIELDS : [scope]; }
  async function previewAddText() {
    const list = currentList(); if (!list) return; const text = document.getElementById("add-text").value;
    if (!text) return toast("יש להכניס טקסט", "warning"); const prefix = document.getElementById("add-position").value === "prefix";
    const changes = list.contacts.map(c => ({ before: clone(c), after: { ...clone(c), name: prefix ? text + c.name : c.name + text } }));
    showCleanPreview(changes, "הוספת טקסט לשמות");
  }
  async function previewReplace() {
    const list = currentList(); if (!list) return; const find = document.getElementById("replace-find").value; const replacement = document.getElementById("replace-with").value; const useRegex = document.getElementById("replace-regex").checked;
    if (!find) return toast("יש להכניס טקסט לחיפוש", "warning");
    let matcher;
    if (useRegex) {
      const checked = await checkRegex(find); if (!checked.ok) return toast(checked.message, "error");
      try { matcher = new RegExp(find, "gu"); } catch (_) { return toast("החיפוש המתקדם אינו תקין", "error"); }
    }
    const changes = []; const fields = fieldsForScope(document.getElementById("replace-scope").value);
    for (const contact of list.contacts) { const after = clone(contact); for (const field of fields) after[field] = useRegex ? String(after[field]).replace(matcher, replacement) : String(after[field]).split(find).join(replacement); if (FIELDS.some(f => after[f] !== contact[f])) changes.push({ before: clone(contact), after }); }
    if (!changes.length) return toast("לא נמצאו התאמות", "warning"); showCleanPreview(changes, "חיפוש והחלפה");
  }
  function checkRegex(pattern) {
    return new Promise(resolve => {
      const source = `onmessage=e=>{try{const r=new RegExp(e.data.pattern,'gu');const s=e.data.sample;let n=0;while(r.exec(s)&&n++<10000){if(r.lastIndex===0)r.lastIndex++}postMessage({ok:n<10000,message:n<10000?'':'הביטוי מורכב מדי'});}catch(x){postMessage({ok:false,message:'החיפוש המתקדם אינו תקין'});}}`;
      const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" }))); let done = false;
      const finish = result => { if (done) return; done = true; worker.terminate(); resolve(result); };
      worker.onmessage = event => finish(event.data); worker.onerror = () => finish({ ok: false, message: "לא הצלחנו לבדוק את הביטוי" });
      worker.postMessage({ pattern, sample: currentList().contacts.slice(0, 500).map(c => FIELDS.map(f => c[f]).join(" ")).join("\n") });
      setTimeout(() => finish({ ok: false, message: "הביטוי מורכב מדי ולכן הבדיקה נעצרה" }), 1200);
    });
  }
  function showCleanPreview(changes, label) {
    const panel = document.getElementById("clean-preview"); panel.classList.remove("hidden");
    panel.innerHTML = `<h3>${esc(label)}</h3><p>${changes.length} אנשי קשר ישתנו. הנה חמש דוגמאות:</p><div class="modal-list">${changes.slice(0, 5).map(x => `<div class="modal-list-row"><span>${esc(x.before.name)}</span><b>${esc(x.after.name)}</b></div>`).join("")}</div><button class="btn btn-primary" id="apply-clean-change">ביצוע השינוי</button>`;
    document.getElementById("apply-clean-change").onclick = () => { const list = currentList(); const before = changes.map(x => x.before), after = changes.map(x => x.after); const byId = new Map(after.map(c => [c.id, c])); list.contacts = list.contacts.map(c => byId.get(c.id) || c); recordChange(list, label, before, after); markChanged(list, "bulk_edit"); panel.classList.add("hidden"); renderAll(); toast("השינוי בוצע"); };
  }

  function applyPreset(preset) {
    const scopeEl = document.getElementById("replace-scope");
    const findEl = document.getElementById("replace-find");
    const replEl = document.getElementById("replace-with");
    const regexEl = document.getElementById("replace-regex");
    if (!scopeEl) return;
    if (preset === "strip_suffix_num")  { scopeEl.value = "name";  regexEl.checked = true;  findEl.value = "_\\d+";   replEl.value = ""; }
    else if (preset === "underscore_space") { scopeEl.value = "name";  regexEl.checked = true;  findEl.value = "_";       replEl.value = " "; }
    else if (preset === "trim_spaces")      { scopeEl.value = "all";   regexEl.checked = true;  findEl.value = "\\s{2,}"; replEl.value = " "; }
    else if (preset === "strip_digits_name") { scopeEl.value = "name"; regexEl.checked = true;  findEl.value = "\\d+";    replEl.value = ""; }
    else if (preset === "clean_phones")     { scopeEl.value = "phone"; regexEl.checked = true;  findEl.value = "\\D";     replEl.value = ""; }
    setPage("clean");
  }

  /* העברה או העתקה של אנשי הקשר המסומנים לרשימה אחרת. אותו חלון עושה את שניהם:
     ההבדל היחיד הוא אם הכרטיסים נמחקים מהמקור, ולכן אין סיבה לשני מסכים. */
  async function moveSelected() {
    const source = currentList();
    if (!source || !state.selected.size) return;
    const targets = state.lists.filter(list => !list.deletedAt && list.id !== source.id);
    const picked = source.contacts.filter(contact => state.selected.has(contact.id));
    const options = targets.map(list => `<option value="${esc(list.id)}">${esc(list.name)} (${list.contacts.length})</option>`).join("");
    const closing = modal({
      kicker: "העברה בין רשימות",
      title: `${picked.length} אנשי קשר`,
      html: `<label class="modal-field">לאיזו רשימה?
               <select id="move-target">${options}<option value="__new">＋ רשימה חדשה…</option></select></label>
             <label class="modal-field" id="move-new-wrap" style="display:none">שם הרשימה החדשה
               <input id="move-new-name" maxlength="80" value="רשימה חדשה"></label>
             <p class="move-note">‏<b>העברה</b> מוציאה אותם מ״${esc(source.name)}״. ‏<b>העתקה</b> משאירה אותם גם כאן.</p>`,
      buttons: [{ id: "move", label: "העבר", primary: true }, { id: "copy", label: "העתק" }, { id: "cancel", label: "ביטול" }]
    });
    /* המאזין נקשר אחרי שהחלון כבר צויר אך לפני ההמתנה לתשובה — אחרי await
       החלון כבר סגור והשדות אינם קיימים. */
    const targetSelect = document.getElementById("move-target");
    const newWrap = document.getElementById("move-new-wrap");
    if (targetSelect && newWrap) {
      const sync = () => { newWrap.style.display = targetSelect.value === "__new" ? "" : "none"; };
      targetSelect.addEventListener("change", sync);
      sync();
    }
    const choice = await closing;
    if (choice !== "move" && choice !== "copy") return;

    // סגירת החלון רק מסתירה אותו, ולכן השדות עדיין קריאים כאן.
    const targetId = document.getElementById("move-target")?.value;
    let target;
    if (targetId === "__new") {
      target = blankList(document.getElementById("move-new-name")?.value.trim() || "רשימה חדשה");
      state.lists.push(target);
    } else {
      target = state.lists.find(list => list.id === targetId);
    }
    if (!target) return toast("לא נבחרה רשימת יעד", "warning");

    // מזהה חדש לכל כרטיס ביעד: אותו מזהה בשתי רשימות היה שובר undo ומיזוגים.
    const added = picked.map(contact => blankContact({ ...clone(contact), id: undefined }));
    target.contacts.push(...added);
    recordChange(target, `קליטת ${added.length} אנשי קשר מ״${source.name}״`, added.map(() => null), added.map(clone));
    markChanged(target, "receive_contacts");

    if (choice === "move") {
      const ids = new Set(picked.map(contact => contact.id));
      source.contacts = source.contacts.filter(contact => !ids.has(contact.id));
      recordChange(source, `העברת ${picked.length} אנשי קשר ל״${target.name}״`, picked.map(clone), picked.map(() => null));
      markChanged(source, "move_contacts");
      state.selected.clear();
    }
    persistLocal();
    renderAll();
    toast(`${choice === "move" ? "הועברו" : "הועתקו"} ${added.length} אנשי קשר ל״${target.name}״`);
    logAction(choice === "move" ? "move_contacts" : "copy_contacts", target.id);
  }

  /* בחירה גורפת חלה על כל התוצאות המסוננות, גם על אלה שעדיין לא צוירו —
     אבל מסמנת בפועל רק את הכרטיסים שעל המסך, בלי לבנות את הרשת מחדש. */
  function selectAll() {
    for (const contact of filteredContacts()) state.selected.add(contact.id);
    document.querySelectorAll("[data-select-contact]").forEach(box => {
      box.checked = true;
      box.closest(".contact-card")?.classList.add("selected");
    });
    updateSelectionUi();
  }
  function clearSelection() {
    state.selected.clear();
    document.querySelectorAll("[data-select-contact]").forEach(box => {
      box.checked = false;
      box.closest(".contact-card")?.classList.remove("selected");
    });
    updateSelectionUi();
  }
  async function deleteSelected() { const list = currentList(); if (!list || !state.selected.size) return; const ok = await confirmBox("מחיקת אנשי קשר", `למחוק ${state.selected.size} אנשי קשר שנבחרו?`, "מחיקה"); if (!ok) return; const removed = list.contacts.filter(c => state.selected.has(c.id)); list.contacts = list.contacts.filter(c => !state.selected.has(c.id)); recordChange(list, "מחיקת אנשי קשר", removed.map(clone), removed.map(() => null)); state.selected.clear(); markChanged(list, "bulk_delete"); renderAll(); }

  function showHelp(topic) { document.querySelectorAll("[data-help]").forEach(x => x.classList.toggle("active", x.dataset.help === topic)); document.getElementById("help-content").innerHTML = HELP[topic] || HELP.start; }
  async function loadAdmin() {
    if (!state.user?.isAdmin) { document.getElementById("admin-content").innerHTML = "<p>המסך זמין למנהל בלבד.</p>"; return; }
    document.getElementById("admin-content").innerHTML = "<p>טוען נתונים…</p>";
    try { const data = await api("adminOverview", { tab: state.adminTab }); renderAdmin(data); }
    catch (error) { document.getElementById("admin-content").innerHTML = `<p>לא הצלחנו לטעון את נתוני הניהול: ${esc(error.message)}</p>`; }
  }
  function renderAdmin(data = {}) {
    const stats = data.stats || {}; document.getElementById("admin-stats").innerHTML = `<article><strong>${stats.users || 0}</strong><span>משתמשים</span></article><article><strong>${stats.lists || 0}</strong><span>רשימות</span></article><article><strong>${stats.contacts || 0}</strong><span>אנשי קשר</span></article><article><strong>${esc(stats.storage || "0 MB")}</strong><span>אחסון</span></article>`;
    const items = data.items || []; const content = document.getElementById("admin-content");
    if (!items.length) { content.innerHTML = "<p>אין פריטים להצגה.</p>"; return; }
    content.innerHTML = `<div class="modal-list">${items.map(item => `<div class="modal-list-row"><span><b>${esc(item.name || item.email || item.action || item.area || item.listName || "פריט")}</b><small>${esc(item.email || item.at || item.updatedAt || "")}</small></span><span>${item.blocked !== undefined ? `<button class="btn btn-quiet" data-admin-lists="${esc(item.sub)}">רשימות</button> <button class="btn btn-quiet" data-admin-block="${esc(item.sub)}">${item.blocked ? "ביטול חסימה" : "חסימה"}</button>` : esc(item.message || item.status || "")}</span></div>`).join("")}</div>`;
  }
  async function adminBlock(sub) { try { await api("adminToggleBlock", { sub }); toast("מצב המשתמש עודכן"); loadAdmin(); } catch (error) { toast(error.message, "error"); } }
  async function adminUserLists(sub) { try { const data = await api("adminUserLists", { sub }); await modal({ kicker: "תוכן משתמש", title: "רשימות ואנשי קשר", html: (data.lists || []).map(list => `<h3>${esc(list.name)}</h3><p>${list.contacts.length} אנשי קשר</p><div class="modal-list">${list.contacts.map(c => `<div class="modal-list-row"><b>${esc(c.name || "ללא שם")}</b><span dir="ltr">${esc(c.mobile || c.home || c.work || c.email || "")}</span></div>`).join("")}</div>`).join("") || "<p>אין רשימות.</p>", buttons: [{ id: "close", label: "סגירה", primary: true }] }); } catch (error) { toast(error.message, "error"); } }

  async function googleLogin() {
    if (String(CFG.GOOGLE_WEB_CLIENT_ID || "").includes("PASTE_")) return toast("המנהל עדיין לא הגדיר כניסה באמצעות Google", "warning");
    /* לחיצה אחת: ישר לבחירת החשבון של Google, בלי מסך אישור מקדים. ההסכמה
       לתנאים נמסרת בעצם הכניסה, והניסוח מופיע ליד הכפתור עצמו. */
    try {
      let credential;
      if (window.electronAPI?.googleLogin) credential = await window.electronAPI.googleLogin();
      else credential = await browserGoogleLogin();
      if (!credential?.idToken) throw new Error("לא התקבל אישור מ־Google");
      state.token = credential.idToken;
      const session = await api("session", { termsVersion: CFG.TERMS_VERSION, privacyVersion: CFG.PRIVACY_VERSION });
      // השם והתמונה מגיעים מ-Google דרך ה-ID Token ונשמרים בגיליון המשתמשים.
      state.user = session.user;
      localStorage.setItem("ankal.sessionHint", JSON.stringify({ email: state.user.email, name: state.user.name, picture: state.user.picture || "" }));
      localStorage.setItem(ENTRY_CHOICE_KEY, "google");
      updateAccount(); await pullLists(); processQueue();
      toast(`ברוכים הבאים${state.user.name ? ", " + state.user.name : ""}`);
    } catch (error) { if (error?.message !== "LOGIN_CANCELLED") { toast("הכניסה עם Google לא הושלמה", "error"); reportError("google_login", error); } }
  }
  function browserGoogleLogin() {
    return new Promise((resolve, reject) => {
      const show = async () => {
        const closing = modal({
          kicker: "כניסה מאובטחת", title: "בחרו חשבון Google",
          html: `<div id="modal-google-button" style="display:flex;justify-content:center;min-height:44px"></div>
                 <p class="login-terms">הכניסה מהווה אישור <a href="terms.html" target="_blank">לתנאי השימוש</a> ו<a href="privacy.html" target="_blank">למדיניות הפרטיות</a>.</p>`,
          buttons: [{ id: "cancel", label: "ביטול" }]
        });
        google.accounts.id.initialize({ client_id: CFG.GOOGLE_WEB_CLIENT_ID, callback: response => { closeModal("done"); resolve({ idToken: response.credential }); } });
        google.accounts.id.renderButton(document.getElementById("modal-google-button"), { theme: "outline", size: "large", text: "continue_with", locale: "he", width: 300 });
        if (await closing === "cancel") reject(new Error("LOGIN_CANCELLED"));
      };
      if (window.google?.accounts?.id) show(); else { const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.onload = show; script.onerror = () => reject(new Error("GOOGLE_LOAD_FAILED")); document.head.appendChild(script); }
    });
  }
  async function pullLists() {
    try { const data = await api("listLists"); const remoteLists = data.lists || []; const localById = new Map(state.lists.map(x => [x.id, x])); for (const remote of remoteLists) { const local = localById.get(remote.id); if (!local || !local.dirty) { const item = { ...remote, undo: [], redo: [], dirty: false, remoteVersion: remote.version || 0 }; if (local) state.lists[state.lists.indexOf(local)] = item; else state.lists.push(item); } } persistLocal(); renderAll(); }
    catch (error) { setSyncState("error", "עובד מהמחשב — החיבור יחודש"); }
  }
  function logout() { state.user = null; state.token = ""; if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect(); updateAccount(); setSyncState("", "נשמר במחשב"); toast("יצאתם מהחשבון"); }
  function updateAccount() {
    const hint = state.user || {};
    document.getElementById("account-name").textContent = hint.name || "מצב מקומי";
    document.getElementById("account-email").textContent = hint.email || "לא מחובר";
    const avatar = document.getElementById("account-avatar");
    // תמונת הפרופיל מ-Google כשיש, ואות ראשונה כשאין (או כשהתמונה לא נטענת).
    if (hint.picture) avatar.innerHTML = `<img src="${esc(hint.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
    else avatar.textContent = initialOf(hint.name || "א");
    document.querySelectorAll(".signed-in-only").forEach(x => x.classList.toggle("hidden", !state.user));
    renderShell();
  }
  async function accountSettings() {
    const html = `<p>${state.user ? `מחוברים כעת כ־${esc(state.user.email)}.` : "העבודה נשמרת כרגע במחשב זה."}</p><p>גרסת תנאים: ${esc(CFG.TERMS_VERSION || "—")} · גרסת פרטיות: ${esc(CFG.PRIVACY_VERSION || "—")}</p>`;
    const buttons = state.user ? [{ id: "delete", label: "מחיקת החשבון" }, { id: "close", label: "סגירה", primary: true }] : [{ id: "login", label: "כניסה עם Google", primary: true }, { id: "close", label: "סגירה" }]; const choice = await modal({ kicker: "חשבון", title: "הגדרות", html, buttons });
    if (choice === "login") googleLogin(); if (choice === "delete") { const ok = await confirmBox("מחיקת חשבון", "החשבון והרשימות יועברו לסל למשך 30 יום. להמשיך?", "העברה לסל"); if (ok) { await api("deleteAccount"); logout(); toast("החשבון הועבר לסל המחזור"); } }
  }

  function modal({ kicker = "", title = "", html = "", buttons = [], dismissible = true, beforeResolve = null }) {
    if (state.modal) state.modal.resolve("cancel"); const backdrop = document.getElementById("modal-backdrop"); document.getElementById("modal-kicker").textContent = kicker; document.getElementById("modal-title").textContent = title; document.getElementById("modal-body").innerHTML = html; const footer = document.getElementById("modal-footer");
    footer.innerHTML = buttons.map(b => `<button class="btn ${b.primary ? "btn-primary" : b.id === "delete" ? "btn-danger" : "btn-quiet"}" data-modal-choice="${esc(b.id)}">${esc(b.label)}</button>`).join(""); backdrop.classList.add("open"); backdrop.setAttribute("aria-hidden", "false");
    return new Promise(resolve => { state.modal = { resolve, dismissible, beforeResolve }; setTimeout(() => backdrop.querySelector("input,select,button")?.focus(), 30); });
  }
  function closeModal(value) { const active = state.modal; if (!active) return; if (active.beforeResolve && !active.beforeResolve(value)) return; document.getElementById("modal-backdrop").classList.remove("open"); document.getElementById("modal-backdrop").setAttribute("aria-hidden", "true"); state.modal = null; active.resolve(value); }
  async function confirmBox(title, text, accept = "אישור") { return (await modal({ title, html: `<p>${esc(text)}</p>`, buttons: [{ id: "yes", label: accept, primary: true }, { id: "no", label: "ביטול" }] })) === "yes"; }

  function handleAction(action) {
    const actions = { "toggle-theme": toggleTheme, "enter-app": () => enterApp(), "show-landing": showLanding, "open-help": () => { enterApp("help"); }, "quick-import": quickImport, "toggle-sidebar": () => { const side = document.getElementById("sidebar"); side.classList.toggle(innerWidth <= 760 ? "mobile-open" : "collapsed"); }, "new-list": createList, "refresh-lists": () => state.user ? pullLists() : renderLists(), "rename-list": renameList, "add-contact": () => openDrawer(), "close-drawer": closeDrawer, "save-contact": () => saveDrawer(true), "drawer-delete": deleteDrawer, undo, redo, "select-all": selectAll, "clear-selection": clearSelection, "delete-selected": deleteSelected, "move-selected": moveSelected, "toggle-density": () => { state.dense = !state.dense; persistLocal(); renderContacts(); }, "load-more": () => { state.visibleLimit += CFG.CONTACTS_PAGE_SIZE || 100; renderContacts(); }, "preview-add-text": previewAddText, "preview-replace": previewReplace, "download-template": downloadTemplate, "google-login": googleLogin, logout, "account-settings": accountSettings, "account-menu": () => document.getElementById("account-menu").classList.toggle("hidden"), "admin-refresh": loadAdmin, "download-app": downloadApp,
      "scan-duplicates": () => scanReview("duplicates"), "scan-symbols": () => scanReview("smart"),
      "review-start": reviewStart, "review-overview": reviewOverview, "review-one-by-one": reviewOneByOne,
      "review-bulk": reviewBulk, "review-skip-step": reviewSkipStep, "review-apply": reviewApplyItem,
      "review-skip-item": reviewSkipItem, "review-separate": reviewSeparateItem, "review-auto": reviewAuto,
      "review-rescan": reviewRescan };
    actions[action]?.();
  }
  function bindEvents() {
    document.addEventListener("click", event => {
      const modalButton = event.target.closest("[data-modal-choice]"); if (modalButton) return closeModal(modalButton.dataset.modalChoice);
      const page = event.target.closest("[data-page]")?.dataset.page; if (page) return setPage(page);
      const action = event.target.closest("[data-action]")?.dataset.action; if (action) { event.preventDefault(); return handleAction(action); }
      const open = event.target.closest("[data-open-list]")?.dataset.openList; if (open) return openList(open);
      const menu = event.target.closest("[data-list-menu]")?.dataset.listMenu; if (menu) return listMenu(menu);
      const contact = event.target.closest("[data-open-contact]")?.dataset.openContact; if (contact) return openDrawer(contact);
      const select = event.target.closest("[data-select-contact]"); if (select) return setSelected(select.dataset.selectContact, select.checked, select);
      const format = event.target.closest("[data-export]")?.dataset.export; if (format) return exportList(format);
      const help = event.target.closest("[data-help]")?.dataset.help; if (help) return showHelp(help);
      const tab = event.target.closest("[data-admin-tab]")?.dataset.adminTab; if (tab) { state.adminTab = tab; document.querySelectorAll("[data-admin-tab]").forEach(x => x.classList.toggle("active", x.dataset.adminTab === tab)); return loadAdmin(); }
      const sub = event.target.closest("[data-admin-block]")?.dataset.adminBlock; if (sub) return adminBlock(sub);
      const owner = event.target.closest("[data-admin-lists]")?.dataset.adminLists; if (owner) return adminUserLists(owner);
      const preset = event.target.closest("[data-preset]")?.dataset.preset; if (preset) return applyPreset(preset);
      const jump = event.target.closest("[data-review-jump]")?.dataset.reviewJump; if (jump) return reviewJump(jump);
      if (event.target.id === "modal-backdrop" && state.modal?.dismissible) closeModal("cancel");
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && state.modal?.dismissible) closeModal("cancel"); });
    document.getElementById("file-picker").addEventListener("change", event => { const file = event.target.files[0]; event.target.value = ""; if (file) handleFile(file); });
    document.getElementById("contact-search").addEventListener("input", event => { state.search = event.target.value; state.visibleLimit = CFG.CONTACTS_PAGE_SIZE || 100; renderContacts(); });
    document.getElementById("list-search").addEventListener("input", event => { state.listSearch = event.target.value; renderLists(); });
    document.getElementById("contact-form").addEventListener("input", () => { clearTimeout(state.drawerTimer); document.getElementById("drawer-save-state").textContent = "ממתין לשמירה"; state.drawerTimer = setTimeout(() => saveDrawer(false), 900); });
    const drop = document.getElementById("drop-zone"); ["dragenter", "dragover"].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add("dragging"); })); ["dragleave", "drop"].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove("dragging"); })); drop.addEventListener("drop", event => { const file = event.dataTransfer.files[0]; if (file) handleFile(file); });
    window.addEventListener("online", processQueue); window.addEventListener("beforeunload", persistLocal);
  }
  function init() {
    document.documentElement.dataset.theme = localStorage.getItem("ankal.theme") || "dark"; loadLocal(); bindEvents(); updateAccount(); renderAll();
    if (isDesktopApp() || new URLSearchParams(location.search).has("app")) enterApp("lists"); else showLanding();
    showHelp("start"); setSyncState("", "נשמר במחשב"); checkDesktopUpdate();
  }
  async function checkDesktopUpdate() {
    if (!window.electronAPI?.checkUpdate) return; const info = await window.electronAPI.checkUpdate(); if (!info?.version || info.version === info.current) return;
    const choice = await modal({ kicker: "עדכון זמין", title: `גרסה ${info.version} מוכנה`, html: "<p>אפשר להמשיך לעבוד ולעדכן בזמן שנוח לכם.</p>", buttons: [{ id: "download", label: "פתיחת עמוד ההורדה", primary: true }, { id: "later", label: "אחר כך" }] }); if (choice === "download") window.open(info.downloadUrl, "_blank", "noopener");
  }
  init();
})();
