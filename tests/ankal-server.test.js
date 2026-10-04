/* בדיקות השרת בנטליפי: מחסן זיכרון במקום Google, אימות זהות מדומה, ואותו חוזה כמו Code.gs. */
const assert = require("assert");
const path = require("path");
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/* מחסן זיכרון: גיליון = מפת לשוניות → שורות; Drive = מפת מזהים → פריטים */
function memoryStore() {
  const tabs = {}, items = {}; let seq = 0; const id = () => "id" + (++seq);
  const ensure = (t, headers) => { if (!tabs[t]) tabs[t] = [headers.slice()]; return tabs[t]; };
  return {
    tabs, items,
    readTab: async (t, headers) => ensure(t, headers).map(r => r.slice()),
    appendRow: async (t, headers, row) => { ensure(t, headers).push(row.slice()); },
    updateCells: async (t, row, cells) => { const r = tabs[t][row - 1]; for (const c of Object.keys(cells)) r[Number(c) - 1] = cells[c]; },
    deleteRow: async (t, row) => { tabs[t].splice(row - 1, 1); },
    listChildren: async (parentId, { foldersOnly, filesOnly, name } = {}) => Object.values(items).filter(it => !it.trashed && (parentId ? it.parent === parentId : it.parent === null) && (!foldersOnly || it.isFolder) && (!filesOnly || !it.isFolder) && (!name || it.name === name)).map(it => ({ id: it.id, name: it.name, isFolder: it.isFolder, size: it.text ? Buffer.byteLength(it.text) : 0, description: it.description || "" })),
    createFolder: async (parentId, name) => { const it = { id: id(), name, isFolder: true, parent: parentId, description: "" }; items[it.id] = it; return { id: it.id, name, isFolder: true }; },
    readFileText: async (fid) => { if (!items[fid]) throw new Error("no file"); return items[fid].text; },
    writeFileText: async (parentId, name, text, description, existingId) => { if (existingId) { Object.assign(items[existingId], { text, description }); return { id: existingId }; } const it = { id: id(), name, isFolder: false, parent: parentId, text, description }; items[it.id] = it; return { id: it.id }; },
    updateMeta: async (fid, meta) => { Object.assign(items[fid], meta); }
  };
}

(async () => {
  const server = await import(path.join(__dirname, "..", "netlify", "functions", "lib", "ankal-server.mjs").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
  process.env.ADMIN_EMAIL = "admin@example.com";
  const USERS = { dan: { sub: "111", email: "dan@example.com", name: "דן", picture: "" }, admin: { sub: "999", email: "admin@example.com", name: "מנהל", picture: "" } };
  let store;
  function fresh() { server._reset(); store = memoryStore(); server.setStore(store); server.setTokenVerifier(async token => { if (!USERS[token]) throw server.apiError("INVALID_TOKEN", "bad"); return USERS[token]; }); store.items.root = { id: "root", name: "ANKAL_DATA", isFolder: true, parent: null, description: "" }; }
  const call = (action, token, payload) => server.handle({ action, idToken: token, payload });

  test("פעולה לא מוכרת נדחית בלי ליצור משתמש", async () => { fresh(); const r = await call("nope", "dan"); assert.equal(r.ok, false); assert.equal(r.error, "UNKNOWN_ACTION"); assert.equal((store.tabs["משתמשים"] || []).length, 0); });
  test("בלי טוקן: LOGIN_REQUIRED", async () => { fresh(); const r = await call("session", ""); assert.equal(r.error, "LOGIN_REQUIRED"); });
  test("session יוצר שורת משתמש אחת גם בשתי בקשות מקבילות", async () => {
    fresh(); const [a, b] = await Promise.all([call("session", "dan", { termsVersion: "t1", privacyVersion: "p1" }), call("listLists", "dan")]);
    assert.equal(a.ok, true); assert.equal(a.data.user.email, "dan@example.com"); assert.equal(a.data.user.isAdmin, false); assert.deepEqual(b.data.lists, []);
    const rows = store.tabs["משתמשים"]; assert.equal(rows.length, 2, "שורה אחת למשתמש"); assert.equal(rows[1][8], "t1");
  });
  test("saveList: גרסאות, קונפליקט, ושמירה בתיקיית המשתמש", async () => {
    fresh(); const list = { id: "list_1", name: "רשימה", contacts: [{ id: "c1", name: "דוד", mobile: "0501", group: "משפחה", ringtone: "E:\\x.mp3", extra: "לא נשמר" }], importHashes: [], separatedPairs: [] };
    const r1 = await call("saveList", "dan", { list, expectedVersion: 0 }); assert.equal(r1.ok, true); assert.equal(r1.data.version, 1);
    const r2 = await call("saveList", "dan", { list, expectedVersion: 1 }); assert.equal(r2.data.version, 2);
    const conflict = await call("saveList", "dan", { list, expectedVersion: 1 }); assert.equal(conflict.error, "VERSION_CONFLICT"); assert.equal(conflict.data.list.version, 2);
    const lists = (await call("listLists", "dan")).data.lists; assert.equal(lists.length, 1); assert.equal(lists[0].version, 2); assert.equal(lists[0].contacts[0].group, "משפחה"); assert.equal(lists[0].contacts[0].ringtone, "E:\\x.mp3"); assert.equal(lists[0].contacts[0].extra, undefined);
    const folders = Object.values(store.items).filter(i => i.isFolder && i.parent === "root"); assert.equal(folders.length, 1); assert.equal(folders[0].name, "user_111");
  });
  test("deleteList מסמן מחיקה ו-listLists מסתיר", async () => {
    fresh(); await call("saveList", "dan", { list: { id: "l2", name: "x", contacts: [] }, expectedVersion: 0 });
    assert.equal((await call("deleteList", "dan", { listId: "l2" })).data.deleted, true); assert.equal((await call("listLists", "dan")).data.lists.length, 0);
  });
  test("רשימה לא תקינה נדחית", async () => { fresh(); assert.equal((await call("saveList", "dan", { list: { id: "x" } })).error, "INVALID_LIST"); });
  test("log ו-error נכתבים לגיליונות", async () => {
    fresh(); await call("log", "dan", { action: "import", listId: "l1", device: "web" }); await call("error", "dan", { area: "x", message: "boom", userAgent: "ua" });
    assert.equal(store.tabs["פעולות"].length, 2); assert.equal(store.tabs["פעולות"][1][3], "import"); assert.equal(store.tabs["תקלות"][1][4], "boom");
  });
  test("משתמש חסום: רק session עובר", async () => {
    fresh(); await call("session", "dan"); store.tabs["משתמשים"][1][6] = true;
    assert.equal((await call("listLists", "dan")).error, "ACCOUNT_BLOCKED"); assert.equal((await call("session", "dan")).data.user.blocked, true);
  });
  test("deleteAccount מסמן תאריך וכניסה מחודשת מבטלת", async () => {
    fresh(); await call("saveList", "dan", { list: { id: "l1", name: "x", contacts: [] }, expectedVersion: 0 });
    await call("deleteAccount", "dan"); assert.ok(store.tabs["משתמשים"][1][7]); const folder = Object.values(store.items).find(i => i.name === "user_111"); assert.ok(folder.description.startsWith("DELETED_AT="));
    await call("session", "dan"); assert.equal(store.tabs["משתמשים"][1][7], ""); assert.equal(folder.description, "");
  });
  test("פעולות ניהול דורשות מנהל", async () => { fresh(); assert.equal((await call("adminOverview", "dan", { tab: "users" })).error, "ADMIN_ONLY"); });
  test("adminOverview: סטטיסטיקה, משתמשים, יומן, חסימה ורשימות משתמש", async () => {
    fresh(); await call("saveList", "dan", { list: { id: "l1", name: "x", contacts: [{ id: "a", name: "א" }, { id: "b", name: "ב" }] }, expectedVersion: 0 }); await call("log", "dan", { action: "import" });
    const ov = await call("adminOverview", "admin", { tab: "users" }); assert.equal(ov.ok, true); assert.equal(ov.data.stats.users, 2); assert.equal(ov.data.stats.lists, 1); assert.equal(ov.data.stats.contacts, 2); assert.equal(ov.data.stats.server, "netlify");
    const logs = await call("adminOverview", "admin", { tab: "logs" }); assert.equal(logs.data.items.length, 1); assert.equal(logs.data.items[0].name, "דן");
    assert.equal((await call("adminToggleBlock", "admin", { sub: "111" })).data.updated, true); assert.equal(store.tabs["משתמשים"][1][6], true);
    const ul = await call("adminUserLists", "admin", { sub: "111" }); assert.equal(ul.data.lists.length, 1);
    assert.equal((await call("adminToggleBlock", "admin", { sub: "nope" })).error, "USER_NOT_FOUND");
  });
  test("מצב השרת נשמר בלשונית ההגדרות", async () => {
    fresh(); assert.equal(await server.getServerMode(), "script");
    const r = await call("adminServerMode", "admin", { mode: "netlify" }); assert.equal(r.data.mode, "netlify"); assert.equal(r.data.adminEmail, true);
    const verify = async token => { if (!USERS[token]) throw server.apiError("INVALID_TOKEN", "bad"); return USERS[token]; };
    server._reset(); server.setStore(store); server.setTokenVerifier(verify); assert.equal(await server.getServerMode(), "netlify", "המצב נקרא מהגיליון גם אחרי איפוס המטמון");
    assert.equal((await call("adminServerMode", "dan", {})).error, "ADMIN_ONLY");
    assert.equal(store.tabs["הגדרות"].length, 2);
  });
  test("ping עונה בלי זהות", async () => { fresh(); const r = await call("ping", ""); assert.equal(r.ok, true); assert.equal(r.data.server, "netlify"); });
  test("תקלת תשתית נזרקת החוצה (למנתב) ולא הופכת לתשובה", async () => {
    fresh(); store.readTab = async () => { const e = new Error("google down"); e.infra = true; throw e; };
    let thrown = null; try { await call("session", "dan"); } catch (e) { thrown = e; } assert.ok(thrown && thrown.infra);
  });

  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log("  ✓", name); } catch (error) { failed++; console.log("  ✗", name, "\n      " + String(error.stack || error.message).split("\n").slice(0, 2).join("\n      ")); } }
  if (failed) { console.log(`\n${failed} בדיקות שרת נכשלו.`); process.exit(1); }
  console.log(`\n${tests.length} בדיקות שרת עברו בהצלחה.`);
})().catch(e => { console.error(e); process.exit(1); });
