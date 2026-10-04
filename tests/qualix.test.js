/* בדיקות ספריית הגיבוי של קיוליקס: וקטורים ידועים, סבבי קריאה-כתיבה על נתונים מלאכותיים,
   והרכבת תיקיית גיבוי שלמה בזיכרון. הפורמט עצמו אומת מול גיבויים אמיתיים בית-בבית. */
const assert = require("assert");
const Q = require("../src/qualix.js");

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const strip = list => list.map(o => { const c = Object.assign({}, o); delete c._raw; return c; });

test("CRC-16/ARC: וקטור הבדיקה הסטנדרטי", () => assert.equal(Q.crc16arc(Buffer.from("123456789")), 0xBB3D));

test("BCD: ספרות, כוכבית, סולמית ומספר אי-זוגי", () => {
  assert.deepEqual([...Q.encodeBcd("0501234567")], [0x50, 0x10, 0x32, 0x54, 0x76]);
  assert.equal(Q.decodeBcd(Q.encodeBcd("0501234567")), "0501234567");
  assert.equal(Q.decodeBcd(Q.encodeBcd("026417612")), "026417612");
  assert.equal(Q.decodeBcd(Q.encodeBcd("*#0000#")), "*#0000#");
  assert.equal(Q.decodeBcd(Q.encodeBcd("17#734#115731#")), "17#734#115731#");
});

test("זמן הטלפון: שניות מ-1980 בשעון הקיר, ללא אזור זמן", () => {
  assert.equal(Q.phoneTimeToIso(1474821173), "2026-09-25T16:32:53"); // אומת מול שעת גיבוי אמיתית
  assert.equal(Q.isoToPhoneTime("2026-09-25T16:32:53"), 1474821173);
  assert.equal(Q.isoToPhoneTime(Q.phoneTimeToIso(0)), 0);
});

test("ספר טלפונים: בנייה, קריאה, מיון, מזהים וקבוצות", () => {
  const contacts = [
    { name: "דוד כהן", mobile: "050-1234567", home: "02-6417612", work: "", fax: "", email: "a@b.c", note: "שורה 1\nשורה 2", group: "משפחה", groupBit: 0x08 },
    { name: "Voice Mail", mobile: "+972535353151", home: "", work: "", fax: "", email: "", note: "", group: "" },
    { name: "  אחורה", mobile: "*#0000#", home: "", work: "0533149353", fax: "0774179033", email: "", note: "", group: "חברים" },
    { name: "019 מובייל", mobile: "", home: "", work: "", fax: "", email: "", note: "", group: "" }
  ];
  const bytes = Q.buildPhonebook(contacts);
  const back = Q.parsePhonebook(bytes);
  assert.equal(back.recordSize, 1200);
  assert.deepEqual(back.contacts.map(c => c.name), ["  אחורה", "019 מובייל", "Voice Mail", "דוד כהן"], "סדר כמו בטלפון: רווחים, ספרות, לטינית, עברית");
  const david = back.contacts.find(c => c.name === "דוד כהן");
  assert.equal(david.mobile, "0501234567"); assert.equal(david.home, "026417612"); assert.equal(david.email, "a@b.c"); assert.equal(david.note, "שורה 1\nשורה 2");
  assert.equal(david.group, "משפחה"); assert.equal(david.groupBit, 0x08);
  const vm = back.contacts.find(c => c.name === "Voice Mail"); assert.equal(vm.mobile, "+972535353151", "מספר בינלאומי חוזר עם פלוס");
  const back2 = back.contacts.find(c => c.name === "  אחורה"); assert.equal(back2.mobile, "*#0000#"); assert.equal(back2.work, "0533149353"); assert.equal(back2.fax, "0774179033");
  assert.equal(back2.groupBit, 0x01, "קבוצה חדשה מקבלת ביט פנוי");
  const ids = back.contacts.map(c => c.id); assert.equal(new Set(ids).size, 4); assert.ok(ids.every(id => id > 0));
  // סבב שני: רשומות גולמיות נשמרות בית-בבית
  assert.ok(Q.same(Q.buildPhonebook(back.contacts), bytes));
  // סבב שלישי: בנייה מחדש מהשדות בלבד נותנת את אותם בתים
  assert.ok(Q.same(Q.buildPhonebook(strip(back.contacts)), bytes));
});

test("ספר טלפונים: צלצול אישי וקובץ ה-PB", () => {
  const bytes = Q.buildPhonebook([{ id: 3, name: "ivr2", mobile: "0772633681", ringtone: Q.RINGTONE_FILE, group: "" }]);
  const c = Q.parsePhonebook(bytes).contacts[0];
  assert.equal(c.ringtone, 0x80); assert.equal(Q.ringFileName(c.id), "33619971_Ring.ini"); assert.equal(Q.ringIdFromFileName("33619971_Ring.ini"), 3);
  const ini = Q.buildRingIni("E:\\שיר.mp3", 25427968); assert.equal(ini.length, 528);
  assert.deepEqual(Q.parseRingIni(ini), { path: "E:\\שיר.mp3", fileSize: 25427968 });
});

test("יומן שיחות: 100 כניסות, סוגים, סדר לפי השיחה האחרונה", () => {
  const entries = [
    { number: "0548404550", type: "incoming", calls: [{ time: 100, duration: 49 }, { time: 200, duration: 7 }] },
    { number: "+972501234567", type: "outgoing", calls: [{ time: 500, duration: 63 }] },
    { number: "026454226", type: "missed", calls: [{ time: 300, duration: 0 }] },
    { number: "053410337671301", type: "rejected", calls: [{ time: 50, duration: 0 }] }
  ];
  const back = Q.parseCallog(Q.buildCallog(entries));
  assert.deepEqual(back.entries.map(e => e.number), ["+972501234567", "026454226", "0548404550", "053410337671301"]);
  assert.deepEqual(back.entries.map(e => e.type), ["outgoing", "missed", "incoming", "rejected"]);
  assert.deepEqual(back.entries[2].calls, [{ time: 100, duration: 49 }, { time: 200, duration: 7 }]);
  const many = Array.from({ length: 130 }, (_, i) => ({ number: "05000000" + String(i).padStart(2, "0"), type: "incoming", calls: [{ time: i, duration: 1 }] }));
  assert.equal(Q.parseCallog(Q.buildCallog(many)).entries.length, 100, "לא יותר ממאה כניסות");
});

test("יומן פגישות: כותרת, תאריך, שעה ותזכורת", () => {
  const events = [{ title: "רופא שיניים", date: "2026-07-17", time: "17:30", reminder: true, reminderId: 160 }, { title: "", date: "2027-01-01", time: "00:00", reminder: false }];
  const back = Q.parseSchedule(Q.buildSchedule(events)).events;
  assert.equal(back.length, 2); assert.equal(back[0].title, "רופא שיניים"); assert.equal(back[0].date, "2026-07-17"); assert.equal(back[0].time, "17:30"); assert.equal(back[0].reminder, true); assert.equal(back[0].reminderId, 160);
  assert.equal(back[0]._raw.length, 748);
});

test("רשימת השמעה: כותרת קבועה וערכים ברוחב 528", () => {
  const lst = Q.buildLst([{ path: "E:\\ניסן\\שיר.mp3", meta: 7, fileSize: 3370306 }, "D:\\Audio\\rec.wav"]);
  assert.equal(lst.length, 27 + 2 * 528);
  assert.deepEqual(Q.parseLst(lst), [{ path: "E:\\ניסן\\שיר.mp3", meta: 7, fileSize: 3370306 }, { path: "D:\\Audio\\rec.wav", meta: 0, fileSize: 0 }]);
});

test("מניפסט: גודל כולל, מונים ורשימת קבצים", () => {
  const m = Q.buildManifest({ name: "memo.ib", type: Q.TYPES.memo, entries: [{ src: "E:\\Memo\\a.txt", dst: "E:\\ibphone\\x\\a.txt" }, { src: "E:\\Memo\\b.txt", dst: "E:\\ibphone\\x\\b.txt" }], totalBytes: 70000 });
  const back = Q.parseManifest(m);
  assert.equal(back.totalBytes, 70000); assert.equal(back.entries.length, 2); assert.equal(back.entries[1].dst, "E:\\ibphone\\x\\b.txt"); assert.equal(back.count, 2);
  assert.equal(Q.parseIb(m).records[0].length, 12 + 2 + 1066 * 2);
});

test("כותרת הגיבוי: ביטים, סכום גדלים ו-CRC לכל קובץ", () => {
  const pb = Q.buildPhonebook([{ name: "א", mobile: "0501", home: "", work: "", fax: "", email: "", note: "", group: "" }]);
  const sc = Q.buildSchedule([{ title: "x", date: "2026-01-01", time: "10:00" }]);
  const head = Q.buildHead({ folder: "2026-10-04_12-00-00", files: { phonebook: pb, schedule: sc } });
  const h = Q.parseHead(head);
  assert.equal(head.length, 324); assert.equal(h.folder, "2026-10-04_12-00-00"); assert.equal(h.path, "E:\\ibphone\\2026-10-04_12-00-00"); assert.equal(h.version, "0001.00003");
  assert.deepEqual(h.categories, ["schedule", "phonebook"]);
  assert.equal(h.sum, 1200 + 748);
  assert.equal(h.crcs[0], Q.crc16arc(sc)); assert.equal(h.crcs[2], Q.crc16arc(pb)); assert.equal(h.crcs[1], 0);
});

test("פתקים: BOM, מעברי שורה, שם קובץ ותאריך", () => {
  const b = Q.buildMemo("שלום\r\nעולם"); assert.deepEqual([...b.subarray(0, 3)], [0xEF, 0xBB, 0xBF]); assert.equal(Q.parseMemo(b), "שלום\nעולם");
  const name = Q.memoFileName(new Date(2026, 9, 4, 15, 7, 26)); assert.ok(/^MEMO_20261004_150726\d{10}\.txt$/.test(name), name);
  assert.equal(Q.memoDateFromName(name), "2026-10-04T15:07:26");
});

test("רוחב טקסט ומירכוז לפי טבלת הרוחב של הטלפון", () => {
  assert.ok(Math.abs(Q.textWidth("ש".repeat(14)) - 1000) < 20); assert.ok(Math.abs(Q.textWidth("ו".repeat(38)) - 1000) < 20);
  const centered = Q.centerLine("שלום"); assert.ok(centered.startsWith(" ")); assert.ok(centered.endsWith("שלום"));
  assert.ok(Q.textWidth(centered) <= 1000 && Q.textWidth(centered) > 450, "הרווחים מביאים את הטקסט לאמצע");
  const table = Q.calibrateFromMemo("ששששששששששששש\nוווווווווווווווווווווווווווווווווווווווו"); assert.equal(table["ש"], Math.round(1000 / 13)); assert.equal(table["ו"], 25);
});

test("הרכבת גיבוי שלם וקריאתו חזרה", async () => {
  const files = Q.assembleBackup({
    folder: "2026-10-04_12-00-00", cardLetter: "E",
    contacts: [{ name: "דוד", mobile: "0501234567", home: "", work: "", fax: "", email: "", note: "", group: "משפחה" }],
    callog: { entries: [{ number: "0501234567", type: "outgoing", calls: [{ time: 10, duration: 5 }] }] },
    events: [{ title: "פגישה", date: "2026-10-05", time: "09:00", reminder: true, reminderId: 1 }],
    memos: [{ fileName: "MEMO_20261004_1200001234567890.txt", text: "פתק" }],
    playlists: [{ name: "שירים.lst", entries: ["E:\\a.mp3"] }],
    settings: new Uint8Array(0x244 + 16 + 8 + 8).fill(0),
    udb: { phoneCache: new Uint8Array(0), cardCache: new Uint8Array(4096) }
  });
  const names = files.map(f => f.name);
  for (const n of ["phonebook.ib", "callog.ib", "schedule.ib", "settings.ib", "memo.ib", "playlist.ib", "udb.ib", "ibphone_head.in", "udb.cache", "000000000000001", "שירים.lst", "MEMO_20261004_1200001234567890.txt"]) assert.ok(names.includes(n), n);
  const map = new Map(files.map(f => [f.name, f.bytes]));
  const head = Q.parseHead(map.get("ibphone_head.in")); assert.deepEqual(head.categories, ["schedule", "callog", "phonebook", "settings", "memo", "udb", "playlist"]);
  const bk = await Q.readBackup({ folder: "2026-10-04_12-00-00", listFiles: async () => names, readFile: async n => map.get(n) });
  assert.equal(bk.contacts[0].name, "דוד"); assert.equal(bk.callog.entries[0].number, "0501234567"); assert.equal(bk.events[0].title, "פגישה"); assert.equal(bk.memos[0].text, "פתק"); assert.equal(bk.playlists[0].entries[0].path, "E:\\a.mp3"); assert.deepEqual(bk.groups, ["משפחה"]);
  assert.equal(Q.parseManifest(map.get("memo.ib")).entries[0].dst, "E:\\ibphone\\2026-10-04_12-00-00\\MEMO_20261004_1200001234567890.txt");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log("  ✓", name); }
    catch (error) { failed++; console.log("  ✗", name, "\n      " + String(error.stack || error.message).split("\n").slice(0, 3).join("\n      ")); }
  }
  if (failed) { console.log(`\n${failed} בדיקות קיוליקס נכשלו.`); process.exit(1); }
  console.log(`\n${tests.length} בדיקות קיוליקס עברו בהצלחה.`);
})();
