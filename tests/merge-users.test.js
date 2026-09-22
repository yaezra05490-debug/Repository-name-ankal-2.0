/* בדיקה לוגית ל-mergeDuplicateUsers: מדמה גיליון עם כפילויות ומריץ את הפונקציה
   האמיתית מתוך Code.gs מול Sheet מזויף, כדי לוודא שהאיחוד שומר את מה שצריך. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync("D:/44/ankal-2.0-ready/apps-script/Code.gs", "utf8");

function makeSheet(rows) {
  return {
    rows,
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    getRange: (r, c, nr, nc) => ({
      setValues: (vals) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = vals[i][j]; },
      setValue: (v) => { rows[r - 1][c - 1] = v; },
      getValues: () => [rows[r - 1].slice(c - 1, c - 1 + nc)]
    }),
    deleteRow: (r) => { rows.splice(r - 1, 1); },
    getLastRow: () => rows.length,
    appendRow: (r) => rows.push(r.slice())
  };
}

function run(rows) {
  const sheet = makeSheet(rows);
  const logs = [];
  const sandbox = {
    __sheetStub: () => sheet,
    USERS_SHEET: "משתמשים",
    Logger: { log: (m) => logs.push(m) },
    getAppService: (parts) => {
      const n = parts.join("");
      if (n === "LockService") return { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
      if (n === "CacheService") return { getScriptCache: () => ({ remove() {} }) };
      throw new Error("unexpected service " + n);
    }
  };
  // הקובץ מגדיר sheet_ אמיתי שנפתח מול Google; דורסים אותו אחרי ההרמה.
  const body = src.slice(src.indexOf("function findRowBySub_"));
  const fn = new Function(...Object.keys(sandbox), body + "\nsheet_ = __sheetStub;\nreturn mergeDuplicateUsers();");
  const report = fn(...Object.values(sandbox));
  return { rows: sheet.rows, report, logs };
}

const H = ["sub", "email", "name", "picture", "createdAt", "lastSeen", "blocked", "deletedAt", "termsVersion", "privacyVersion"];
let failed = 0;
const test = (name, fn) => { try { fn(); console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "\n      " + e.message); } };

test("שתי שורות לאותו sub מתאחדות לאחת", () => {
  const { rows } = run([H.slice(),
    ["s1", "a@x.co", "ינון", "", "2026-09-07T21:25:00Z", "2026-09-07T21:48:00Z", false, "", "", ""],
    ["s1", "a@x.co", "ינון", "", "2026-09-07T21:25:00Z", "2026-09-07T21:25:00Z", false, "", "", ""]]);
  assert.equal(rows.length, 2, "צריכה להישאר שורה אחת + כותרת");
  assert.equal(rows[1][5], "2026-09-07T21:48:00Z", "הביקור האחרון המאוחר נשמר");
});

test("שומר את ההצטרפות המוקדמת ואת הביקור המאוחר", () => {
  const { rows } = run([H.slice(),
    ["s1", "a@x.co", "א", "", "2026-09-10T10:00:00Z", "2026-09-10T10:00:00Z", false, "", "", ""],
    ["s1", "a@x.co", "א", "", "2026-09-01T08:00:00Z", "2026-09-20T22:00:00Z", false, "", "", ""]]);
  assert.equal(rows[1][4], "2026-09-01T08:00:00Z");
  assert.equal(rows[1][5], "2026-09-20T22:00:00Z");
});

test("חסימה באחת מהשורות שורדת את האיחוד", () => {
  const { rows } = run([H.slice(),
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-01", false, "", "", ""],
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-02", "TRUE", "", "", ""]]);
  assert.equal(rows.length, 2);
  assert.equal(String(rows[1][6]).toLowerCase(), "true", "החסימה לא נעלמה");
});

test("תאריך מחיקה באחת מהשורות שורד", () => {
  const { rows } = run([H.slice(),
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-01", false, "", "", ""],
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-01", false, "2026-09-05", "", ""]]);
  assert.equal(rows[1][7], "2026-09-05");
});

test("שדות ריקים מתמלאים מהכפולה", () => {
  const { rows } = run([H.slice(),
    ["s1", "", "", "", "2026-09-01", "2026-09-01", false, "", "", ""],
    ["s1", "a@x.co", "אברהם", "pic.png", "2026-09-01", "2026-09-01", false, "", "2.0", "2.0"]]);
  assert.equal(rows[1][1], "a@x.co");
  assert.equal(rows[1][2], "אברהם");
  assert.equal(rows[1][3], "pic.png");
  assert.equal(rows[1][8], "2.0");
});

test("שלוש שורות לאותו sub → אחת", () => {
  const { rows } = run([H.slice(),
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-01", false, "", "", ""],
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-02", false, "", "", ""],
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-03", false, "", "", ""]]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][5], "2026-09-03");
});

test("משתמשים שונים לא מתערבבים, והסדר נשמר", () => {
  const { rows } = run([H.slice(),
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-05", false, "", "", ""],
    ["s2", "b@x.co", "ב", "", "2026-09-02", "2026-09-06", false, "", "", ""],
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-01", false, "", "", ""],
    ["s3", "c@x.co", "ג", "", "2026-09-03", "2026-09-07", false, "", "", ""]]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ["s1", "s2", "s3"]);
  assert.equal(rows[2][1], "b@x.co", "שורת s2 לא נדרסה במחיקה");
});

test("מייל זהה עם sub שונה מדווח ולא מאוחד", () => {
  const { rows, report } = run([H.slice(),
    ["s1", "same@x.co", "א", "", "2026-09-01", "2026-09-01", false, "", "", ""],
    ["s2", "same@x.co", "א", "", "2026-09-02", "2026-09-02", false, "", "", ""]]);
  assert.equal(rows.length, 3, "שתי השורות נשארות — אלה חשבונות נפרדים");
  assert.ok(/מייל עם יותר ממזהה אחד/.test(report), "הדוח חייב להזהיר: " + report);
});

test("גיליון בלי כפילויות אינו משתנה", () => {
  const before = [H.slice(),
    ["s1", "a@x.co", "א", "", "2026-09-01", "2026-09-05", false, "", "", ""],
    ["s2", "b@x.co", "ב", "", "2026-09-02", "2026-09-06", false, "", "", ""]];
  const { rows, report } = run(before.map((r) => r.slice()));
  assert.deepEqual(rows, before);
  assert.ok(/אוחדו 0/.test(report), report);
});

test("גיליון ריק (כותרת בלבד) לא מתרסק", () => {
  const { rows, report } = run([H.slice()]);
  assert.equal(rows.length, 1);
  assert.ok(/אוחדו 0/.test(report));
});

console.log(failed ? `\n${failed} בדיקות נכשלו.` : "\nכל הבדיקות עברו.");
process.exit(failed ? 1 : 0);
