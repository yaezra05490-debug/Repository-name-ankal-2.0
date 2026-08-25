/* בדיקות מנוע הכפולים. כל בדיקה כאן מכסה רגרסיה אמיתית שנמצאה בגרסה 2.0. */
const assert = require("assert");
const D = require("../src/dedupe.js");

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

let seq = 0;
function contact(values) {
  return Object.assign({ id: "c" + (++seq), name: "", mobile: "", home: "", work: "", fax: "", email: "", note: "" }, values);
}
function groupNames(groups) { return groups.map((g) => g.contacts.map((c) => c.name).sort().join("+")).sort(); }

/* ---------------- נרמול מספרים ---------------- */

test("אותו מספר בכל צורות הכתיבה מקבל מפתח זהה", () => {
  const key = D.normalizePhone("050-123-4567");
  for (const spelling of ["0501234567", "+972-50-123-4567", "972501234567", "00972501234567", "050 123 4567"]) {
    assert.equal(D.normalizePhone(spelling), key, spelling);
  }
});

test("אקסל שאכל את האפס המוביל עדיין מתאים", () => {
  // הרגרסיה: 2.0 החזיר IL:501234567 מול RAW:501234567 ולא זיהה את ההתאמה.
  assert.equal(D.normalizePhone("501234567"), D.normalizePhone("0501234567"));
  assert.equal(D.normalizePhone("31234567"), D.normalizePhone("03-1234567"));
});

test("שדה טלפון עם זבל אינו מפתח כלל", () => {
  // הרגרסיה: 2.0 החזיר "RAW:" (מחרוזת אמיתית) לכל אלה, וכל מי שהיה לו שדה כזה
  // התאחד עם כל השאר לקבוצה ענקית אחת.
  for (const junk of ["-", "אין", "n/a", "—", "", "   ", "123", "1234567"]) {
    assert.equal(D.normalizePhone(junk), "", JSON.stringify(junk));
  }
});

test("מספרים שונים אינם מתנגשים", () => {
  assert.notEqual(D.normalizePhone("0501234567"), D.normalizePhone("0501234568"));
  assert.notEqual(D.normalizePhone("+1-555-123-4567"), D.normalizePhone("055-123-4567"));
});

/* ---------------- שיוך מספר למשבצת ---------------- */

test("מזהה נייד מול קווי לפי הקידומת", () => {
  assert.equal(D.guessPhoneKind("052-1234567"), "mobile");
  assert.equal(D.guessPhoneKind("+972501234567"), "mobile");
  assert.equal(D.guessPhoneKind("03-1234567"), "home");
  assert.equal(D.guessPhoneKind("08-9876543"), "home");
  assert.equal(D.guessPhoneKind("072-1234567"), "home");
  assert.equal(D.guessPhoneKind("+1-555-123-4567"), "");
});

test("מציע לכל מספר את המשבצת הנכונה, בלי התנגשות", () => {
  const slots = D.suggestPhoneSlots(["03-6543210", "054-1234567"]);
  assert.deepEqual(slots, ["home", "mobile"]);
});

test("מספר מזוהה תופס את מקומו לפני מספר עמום", () => {
  // מספר זר לא מזוהה לא יגזול את "נייד" ממספר שהקידומת שלו אומרת נייד.
  const slots = D.suggestPhoneSlots(["+1-555-123-4567", "054-1234567"]);
  assert.equal(slots[1], "mobile");
  assert.notEqual(slots[0], "mobile");
});

test("שני מספרים לא חולקים משבצת", () => {
  const slots = D.suggestPhoneSlots(["050-1111111", "052-2222222", "03-3333333"]);
  assert.equal(new Set(slots).size, 3);
  assert.ok(slots.every(Boolean));
});

/* ---------------- דמיון שמות ---------------- */

test("מפתח השם מנקה סימונים שמשתנים בין ייצואים", () => {
  assert.equal(D.nameKey('מרים הריס_1'), D.nameKey("מרים הריס"));
  assert.equal(D.nameKey('ד"ר משה'), D.nameKey("דר משה"));
});

test("שם קצר שמוכל בארוך מקבל ציון לפי הכיסוי", () => {
  assert.equal(D.nameSimilarity("גילה שטיבל", "גילה שטיבל"), 1);
  assert.ok(D.nameSimilarity("גילה שטיב", "גילה שטיבל") > 0.85);
  assert.ok(D.nameSimilarity("אורי", "אורית צדקיה") < 0.5);
});

test("שם קצר מדי אינו ראיה מספקת", () => {
  assert.equal(D.namesLinkContacts("דוד", "דודי"), false);
  assert.equal(D.namesLinkContacts("דוד כהן", "דוד כהן"), true);
});

test("בוחר את השם הנקי ולא את הארוך-הגולמי", () => {
  // הרגרסיה: 2.0 לקח פשוט את הראשון ברשימה, ולכן שמר "מרים הריס_1".
  assert.equal(D.pickBestName(["מרים הריס_1", "מרים הריס"]), "מרים הריס");
  assert.equal(D.pickBestName(["מרים הריס", "מרים הריס_1"]), "מרים הריס");
  assert.equal(D.pickBestName(["גילה שטיב", "גילה שטיבל"]), "גילה שטיבל");
});

/* ---------------- איתור קבוצות ---------------- */

test("מוצא התאמה מקורבת שהחסימה של 2.0 הפילה", () => {
  // הרגרסיה המרכזית: round(10/2)=5 מול round(11/2)=6 שמו את השניים בדליים
  // שונים, והם לא הושוו מעולם — למרות דמיון 0.909.
  const contacts = [contact({ name: "משה בן דוד" }), contact({ name: "משה בן דודי", mobile: "050-1111111" })];
  assert.deepEqual(groupNames(D.findDuplicateGroups(contacts)), ["משה בן דוד+משה בן דודי"]);
});

test("זבל בשדה טלפון לא מאחד את כל הרשימה", () => {
  const contacts = [
    contact({ name: "אבי כהן", mobile: "-" }),
    contact({ name: "בני לוי", mobile: "אין" }),
    contact({ name: "גדי מזרחי", mobile: "n/a" })
  ];
  assert.deepEqual(D.findDuplicateGroups(contacts), []);
});

test("שלושה כרטיסים עם אותו מספר הם מיזוג בטוח, לא קבוצה מורכבת", () => {
  // הרגרסיה: union קישר רק דרך החבר הראשון, ולכן נרשמו 2 קשתות מתוך 3
  // והקבוצה סווגה "מורכבת" ונחסמה ממיזוג אוטומטי.
  const contacts = [
    contact({ name: "רות אבן", mobile: "050-1234567" }),
    contact({ name: "רות אבן", mobile: "050-1234567", email: "r@x.co" }),
    contact({ name: "רות אבן", mobile: "050-1234567", note: "חברה" })
  ];
  const groups = D.findDuplicateGroups(contacts);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].complex, false);
  assert.equal(groups[0].safe, true);
});

test("מספר משותף מקשר גם כששויך לשדות שונים", () => {
  const contacts = [
    contact({ name: "יעל שמש", mobile: "03-1234567" }),
    contact({ name: "יעל ש.", home: "+972-3-1234567" })
  ];
  assert.equal(D.findDuplicateGroups(contacts).length, 1);
});

test("שם דומה עם מספרים סותרים מוצג כדורש בדיקה ולא נעלם", () => {
  const contacts = [
    contact({ name: "גילה שטיב", mobile: "050-1111111" }),
    contact({ name: "גילה שטיבל", mobile: "052-2222222" })
  ];
  const groups = D.findDuplicateGroups(contacts);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].weak, true);
  assert.equal(groups[0].safe, false);
  assert.equal(groups[0].category, "weak");
});

test("קשר חלש לא משתרשר לקבוצה אחת גדולה", () => {
  const contacts = [
    contact({ name: "אבנר גולדמן", mobile: "050-1111111" }),
    contact({ name: "אבנר גולדמןן", mobile: "052-2222222" }),
    contact({ name: "אבנר גולדמןןן", mobile: "053-3333333" })
  ];
  for (const g of D.findDuplicateGroups(contacts)) assert.equal(g.contacts.length, 2);
});

test("מספר מרכזייה לא מאחד עשרות אנשים", () => {
  // שמות שונים באמת — nameKey מוריד ספרות, ולכן "עובד 1"/"עובד 2" היו נחשבים
  // לאותו שם ומתאחדים בצדק, וזה לא מה שנבדק כאן.
  const names = ["אבי כהן", "בני לוי", "גדי מזרחי", "דנה שרון", "הילה פרץ", "ורד אזולאי", "זהר ביטון", "חן נחום"];
  const contacts = names.map((name) => contact({ name, work: "03-9999999" }));
  assert.ok(contacts.length >= D.SHARED_PHONE_CROWD);
  assert.deepEqual(D.findDuplicateGroups(contacts), []);
});

test("מספר משותף בין מעטים עדיין מקשר", () => {
  // מתחת לסף המרכזייה מספר משותף נשאר אות זהות חזק, גם כששני השמות שונים.
  const contacts = [contact({ name: "אבי כהן", work: "03-9999999" }), contact({ name: "בני לוי", work: "03-9999999" })];
  assert.equal(D.findDuplicateGroups(contacts).length, 1);
});

test("‏\"השאר נפרדים\" נשמר גם בקבוצה של שלושה", () => {
  // הרגרסיה: הסינון הסתכל רק על group.length === 2, וקבוצה של שלושה חזרה
  // בסריקה הבאה למרות שהמשתמש כבר הכריע.
  const a = contact({ name: "נועה בר", mobile: "050-1234567" });
  const b = contact({ name: "נועה בר", mobile: "050-1234567" });
  const c = contact({ name: "נועה בר", mobile: "050-1234567" });
  const separatedPairs = [D.pairKey(a.id, b.id), D.pairKey(a.id, c.id), D.pairKey(b.id, c.id)];
  assert.deepEqual(D.findDuplicateGroups([a, b, c], { separatedPairs }), []);
});

/* ---------------- ניקוד וסיווג ---------------- */

test("שדה ריק אינו נספר כהסכמה", () => {
  const scored = D.scoreGroup([contact({ name: "טל", mobile: "050-1234567" }), contact({ name: "טל", mobile: "050-1234567" })]);
  assert.equal(scored.total, 2);
  assert.equal(scored.score, 1);
  assert.equal(scored.exact, true);
});

test("מלא מול ריק הוא מיזוג בטוח, לא התנגשות", () => {
  const scored = D.scoreGroup([contact({ name: "טל", mobile: "050-1234567" }), contact({ name: "טל", mobile: "050-1234567", email: "t@x.co" })]);
  assert.deepEqual(scored.conflicts, []);
  assert.deepEqual(scored.missing, ["email"]);
  assert.equal(scored.safe, true);
  assert.equal(scored.exact, false);
});

test("שני ערכים שונים ולא ריקים הם התנגשות", () => {
  const scored = D.scoreGroup([contact({ name: "טל", email: "a@x.co" }), contact({ name: "טל", email: "b@x.co" })]);
  assert.deepEqual(scored.conflicts, ["email"]);
  assert.equal(scored.safe, false);
  assert.ok(scored.score < 1);
});

test("כל קבוצה נופלת לקטגוריה אחת מוכרת", () => {
  const known = new Set(D.CATEGORIES.map((c) => c.key));
  const contacts = [
    contact({ name: "אבי כהן", mobile: "050-1111111" }),
    contact({ name: "אבי כהן", mobile: "050-1111111", email: "a@x.co" }),
    contact({ name: "אבי כהן!", mobile: "050-1111111", email: "b@x.co" })
  ];
  for (const g of D.findDuplicateGroups(contacts)) assert.ok(known.has(g.category), g.category);
});

test("התור מחזיר רק קטגוריות שיש בהן משהו, בסדר הקבוע", () => {
  const groups = D.findDuplicateGroups([
    contact({ name: "אבי כהן", mobile: "050-1111111" }),
    contact({ name: "אבי כהן", mobile: "050-1111111" })
  ]);
  const queue = D.buildQueue(groups);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].key, "exact");
  assert.ok(queue[0].groups.length);
});

test("רק קטגוריות עם ברירת מחדל אמינה ניתנות לאישור גורף", () => {
  assert.equal(D.canBulkApply("exact"), true);
  assert.equal(D.canBulkApply("phone"), true);
  assert.equal(D.canBulkApply("other"), false);
  assert.equal(D.canBulkApply("weak"), false);
});

/* ---------------- מיזוג ---------------- */

test("המיזוג משבץ כל מספר במקומו", () => {
  const merged = D.mergeContacts([
    contact({ name: "שירה לוי", mobile: "03-6543210" }),
    contact({ name: "שירה לוי", mobile: "054-1234567" })
  ]);
  assert.equal(merged.mobile, "054-1234567");
  assert.equal(merged.home, "03-6543210");
});

test("המיזוג שומר את השם הנקי", () => {
  assert.equal(D.mergeContacts([contact({ name: "מרים הריס_1" }), contact({ name: "מרים הריס" })]).name, "מרים הריס");
});

test("המיזוג לא מאבד ולא משכפל מספרים", () => {
  const merged = D.mergeContacts([
    contact({ name: "יוסי", mobile: "050-1111111", home: "03-2222222" }),
    contact({ name: "יוסי", mobile: "+972-50-111-1111", work: "09-3333333" })
  ]);
  const numbers = D.PHONE_FIELDS.map((f) => merged[f]).filter(Boolean);
  assert.equal(numbers.length, 3);
  assert.equal(new Set(numbers.map(D.normalizePhone)).size, 3);
});

test("המיזוג שומר את הכתיבה הטובה של המספר", () => {
  // הרגרסיה שנצפתה בהרצה: המיזוג שמר "501234599" (אקסל אכל את האפס) רק מפני
  // שהכרטיס הזה הופיע ראשון, במקום את "0501234599" התקין.
  const merged = D.mergeContacts([
    contact({ name: "אבי כהן", mobile: "501234599" }),
    contact({ name: "אבי כהן", mobile: "0501234599" })
  ]);
  assert.equal(merged.mobile, "0501234599");
});

test("צורה מקומית עדיפה על +972 בכרטיס הממוזג", () => {
  const merged = D.mergeContacts([
    contact({ name: "יעל", mobile: "+972501234567" }),
    contact({ name: "יעל", mobile: "050-1234567" })
  ]);
  assert.equal(merged.mobile, "050-1234567");
});

test("בחירת המשתמש גוברת על ההצעה", () => {
  const contacts = [contact({ name: "אבי", email: "a@x.co" }), contact({ name: "אברהם", email: "b@x.co" })];
  const merged = D.mergeContacts(contacts, { name: "אברהם כהן", email: "b@x.co" });
  assert.equal(merged.name, "אברהם כהן");
  assert.equal(merged.email, "b@x.co");
});

test("ההצעה שהמסך מראה היא בדיוק מה שהמיזוג מיישם", () => {
  // "אשר הכל" חייב לעשות מה שהמסך הראה — אחרת אישור גורף הוא הימור.
  const contacts = [contact({ name: "רון גל", mobile: "03-1112222" }), contact({ name: "רון גל", mobile: "052-3334444" })];
  const proposal = D.proposeMerge(contacts);
  const merged = D.mergeContacts(contacts);
  assert.equal(merged.name, proposal.name);
  for (const field of D.PHONE_FIELDS) assert.equal(merged[field], proposal.phones[field]);
});

/* ---------------- סימונים ---------------- */

test("מזהה סוגי סימונים בשמות", () => {
  assert.ok(D.symbolsInName("דני_1").has("_מספר"));
  assert.ok(D.symbolsInName("דני_כהן").has("_"));
  assert.ok(D.symbolsInName("דני ★").has("★"));
  assert.equal(D.symbolsInName('ד"ר דני כהן-לוי').size, 0);
});

test("הסרת סימון לא משאירה רווחים כפולים", () => {
  assert.equal(D.applyPatternRemove("דני _1 כהן", "_מספר"), "דני כהן");
  assert.equal(D.applyPatternRemove("דני★כהן", "★"), "דניכהן");
});

test("מקבץ סימונים לפי שכיחות", () => {
  const groups = D.findSymbolGroups([
    contact({ name: "א_1" }), contact({ name: "ב_2" }), contact({ name: "ג ★" })
  ]);
  assert.equal(groups[0].key, "_מספר");
  assert.equal(groups[0].contacts.length, 2);
});

/* ---------------- היקף ---------------- */

test("שם ממלא-מקום לא מאחד את כל הרשימה לקבוצה אחת", () => {
  // nameKey מוריד ספרות, ולכן "איש קשר 1".."איש קשר 200" הם מפתח שם אחד. הישן
  // הפך את כולם לקבוצה אחת ענקית; שם צפוף כזה כבר לא מקשר לבדו.
  const contacts = [];
  for (let i = 0; i < 200; i++) contacts.push(contact({ name: "איש קשר " + i, mobile: "05" + String(10000000 + i) }));
  assert.deepEqual(D.findDuplicateGroups(contacts), []);
});

test("רשימה גדולה נסרקת מהר ומוצאת את מה שנשתל", () => {
  const contacts = [];
  for (let i = 0; i < 5000; i++) contacts.push(contact({ name: "איש קשר מספר " + i, mobile: "05" + String(10000000 + i) }));
  const planted = 50;
  for (let i = 0; i < planted; i++) contacts.push(contact({ name: "איש קשר מספר " + i, mobile: "05" + String(10000000 + i) }));
  const started = process.hrtime.bigint();
  const groups = D.findDuplicateGroups(contacts);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(groups.length, planted, "כל כפילות שנשתלה צריכה להימצא, ורק היא");
  assert.ok(groups.every((g) => g.contacts.length === 2));
  assert.ok(ms < 3000, `הסריקה ארכה ${Math.round(ms)}ms`);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("  ✓", name); }
  catch (error) { failed++; console.log("  ✗", name, "\n      " + String(error.message).split("\n")[0]); }
}
if (failed) { console.log(`\n${failed} בדיקות נכשלו מתוך ${tests.length}.`); process.exit(1); }
console.log(`\n${tests.length} בדיקות מנוע עברו בהצלחה.`);
