/* בדיקות חיווט: כפתור שמפעיל פעולה שלא קיימת, או קוד שמחפש אלמנט שאין —
   שניהם נכשלים בשקט בדפדפן. כאן הם נכשלים בבנייה. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const root = path.join(__dirname, "..", "src");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function matchAll(text, regex) { return [...text.matchAll(regex)].map((m) => m[1]); }

test("כל data-action מחובר לפונקציה", () => {
  // מפת הפעולות היא הליטרל שאחרי "const actions =", עד הסוגר המסיים שלו.
  const start = app.indexOf("const actions = {");
  assert.ok(start > 0, "לא נמצאה מפת הפעולות");
  const map = app.slice(start, app.indexOf("actions[action]", start));
  const registered = new Set([
    ...matchAll(map, /"([a-z0-9-]+)":/g),
    // קיצורי שם כמו undo, redo. lookahead כדי שהפסיק המפריד לא ייבלע ויסתיר את הבא.
    ...matchAll(map, /[{,]\s*([a-z][a-zA-Z0-9]*)\s*(?=[,}])/g)
  ]);
  const used = new Set([...matchAll(html, /data-action="([^"]+)"/g), ...matchAll(app, /data-action="([^"]+)"/g)]);
  const missing = [...used].filter((action) => !registered.has(action));
  assert.deepEqual(missing, [], "פעולות בלי מימוש: " + missing.join(", "));
});

test("כל getElementById מצביע על אלמנט קיים", () => {
  // מזהים שנוצרים דינמית בתוך תבניות של app.js נחשבים קיימים גם הם.
  const known = new Set([...matchAll(html, /\bid="([^"]+)"/g), ...matchAll(app, /\bid="([^"]+)"/g)]);
  const looked = new Set([
    ...matchAll(app, /getElementById\("([^"]+)"\)/g),
    ...matchAll(app, /getElementById\(`([^`${]+)`\)/g)
  ]);
  const missing = [...looked].filter((id) => !known.has(id));
  assert.deepEqual(missing, [], "מזהים שלא קיימים: " + missing.join(", "));
});

test("כל מסכי האשף מיוצרים על ידי הקוד", () => {
  for (const fn of ["reviewOverviewHtml", "reviewStepHtml", "reviewItemHtml", "reviewDoneHtml", "symbolItemHtml", "dupeItemHtml"]) {
    assert.ok(app.includes(`function ${fn}(`), fn);
  }
});

test("שני דפי הבדיקה מצביעים על מכולות שקיימות ב-HTML", () => {
  for (const id of ["dupe-review", "dupe-progress", "smart-review", "smart-progress"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
});

test("אין שאריות של מנוע הכפולים הישן ב-app.js", () => {
  for (const dead of ["state.dupes", "state.smartDupes", "dupeWizardQueue", "renderDupes(", "_symbolsInName", "RAW:"]) {
    assert.ok(!app.includes(dead), "נשארה שארית: " + dead);
  }
});

test("app.js משתמש במנוע ולא במימוש מקומי", () => {
  assert.ok(app.includes("window.ANKAL_DEDUPE"), "app.js צריך לטעון את המנוע");
  assert.ok(!/function findDuplicateGroups\(/.test(app), "איתור הכפולים צריך לחיות רק ב-dedupe.js");
});

/* ---------------- אתר הניהול ---------------- */

const admin = fs.readFileSync(path.join(root, "YAEZRA", "index.html"), "utf8");
const netlify = fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8");

test("הנתיב הגלוי של אתר הניהול חסום", () => {
  // בלי החסימה הכתובת הסודית חסרת ערך — אפשר פשוט לנחש /YAEZRA/.
  assert.ok(/from\s*=\s*"\/YAEZRA\/\*"/.test(netlify), "חסרה חסימה ל-/YAEZRA/*");
  assert.ok(/force\s*=\s*true/.test(netlify), "החסימה חייבת force=true כדי לגבור על הקובץ הסטטי");
});

test("כתובת אתר הניהול אינה שמורה בקוד", () => {
  // המאגר ציבורי. כתובת בתוך netlify.toml הייתה גלויה לכל אחד, והסודיות
  // חסרת ערך. היא מגיעה ממשתנה סביבה ונכתבת ל-_redirects בזמן הבנייה.
  assert.ok(!/to\s*=\s*"\/YAEZRA\/index\.html"/.test(netlify), "הכתובת חזרה לקובץ שנכנס ל-git");
  assert.ok(netlify.includes("build-redirects.js"), "חסרה פקודת הבנייה שיוצרת את ההפניה");
  const ignore = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
  assert.ok(ignore.includes("/src/_redirects"), "_redirects חייב להישאר מחוץ ל-git");
});

test("סקריפט הבנייה מייצר הפניה תקינה, ולא מייצר כלום בלי הגדרה", () => {
  const script = path.join(__dirname, "..", "scripts", "build-redirects.js");
  const out = path.join(root, "_redirects");
  const run = (adminPath) =>
    cp.execFileSync(process.execPath, [script], { env: { ...process.env, ADMIN_PATH: adminPath }, encoding: "utf8" });

  run("abc123def456");
  assert.ok(fs.readFileSync(out, "utf8").includes("/abc123def456  /YAEZRA/index.html  200"));

  run("");
  assert.ok(!/YAEZRA/.test(fs.readFileSync(out, "utf8")), "בלי ADMIN_PATH אסור שתיווצר הפניה");

  // תו לא חוקי חייב להפיל את הבנייה, לא לייצר הפניה שבורה בשקט.
  assert.throws(() => run("bad path/../etc"), /Command failed|status/);
});

test("אתר הניהול אינו מוגש לאינדוקס", () => {
  assert.ok(/name="robots"[^>]*noindex/.test(admin), "חסר noindex");
  assert.ok(fs.readFileSync(path.join(root, "robots.txt"), "utf8").includes("Disallow: /YAEZRA/"));
});

test("אתר הניהול עצמאי ולא תלוי ב-app.js", () => {
  assert.ok(!admin.includes('src="/app.js"'), "אסור לו לטעון את קוד האפליקציה");
  for (const dep of ["/config.js", "/vcard.js", "/style.css"]) assert.ok(admin.includes(dep), dep);
});

test("אתר הניהול מייצא בשלושת הפורמטים", () => {
  for (const format of ["vcf", "csv", "xlsx"]) assert.ok(admin.includes(`data-x="${format}"`), format);
});

test("אתר הניהול לא מציג נתונים בלי אישור מנהל", () => {
  // ההגנה האמיתית היא בשרת, אבל גם הדף עצמו חייב לחסום לפני שהוא מבקש נתונים.
  assert.ok(/if\s*\(!me\.isAdmin\)/.test(admin), "חסרה בדיקת isAdmin לפני הצגת המסך");
});

/* ---------------- הכניסה ומעבר בין רשימות ---------------- */

test("הכניסה עם Google היא בלחיצה אחת", () => {
  assert.ok(!app.includes("login-consent"), "מסך האישור המקדים היה אמור לרדת");
  assert.ok(app.includes("login-terms"), "התנאים צריכים להופיע ליד כפתור הכניסה");
});

test("השם והתמונה מ-Google נשמרים", () => {
  assert.ok(/sessionHint[\s\S]{0,160}picture/.test(app), "התמונה צריכה להישמר יחד עם השם");
  assert.ok(app.includes("hint.picture"), "כרטיס החשבון צריך להציג את התמונה");
});

test("אפשר להעביר וגם להעתיק אנשי קשר בין רשימות", () => {
  assert.ok(app.includes("function moveSelected"), "חסרה הפעולה");
  assert.ok(/id:\s*"move",\s*label/.test(app) && /id:\s*"copy",\s*label/.test(app), "צריך שני כפתורים");
  assert.ok(html.includes('data-action="move-selected"'), "חסר כפתור בממשק");
});

test("דף הנחיתה נחסם רק בתוכנת השולחן", () => {
  // הבדיקה על file:// הסתירה את דף הנחיתה גם כשפותחים את הקובץ בדפדפן רגיל.
  assert.ok(app.includes("function isDesktopApp"), "חסרה הבחנה בין דפדפן לתוכנה");
  assert.ok(!/showLanding\(\)\s*\{\s*if\s*\(location\.protocol/.test(app), "showLanding עדיין בודק file://");
});

/* ---------------- פונט ---------------- */

test("הפונט מקומי, קל, ובלי שאריות של הקודם", () => {
  const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.ok(!css.includes("AnkalSans"), "נשארו אזכורים לפונט הישן");
  assert.ok(css.includes("assistant-he.woff2"), "חסר הפונט העברי");
  assert.ok(!css.includes("fonts.googleapis.com"), "הפונט חייב להיות מקומי כדי לעבוד אופליין");
  const dir = path.join(root, "fonts");
  const total = fs.readdirSync(dir).filter((f) => f.endsWith(".woff2"))
    .reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(total < 120000, `קבצי הפונט תופסים ${total} בתים`);
  assert.ok(!fs.existsSync(path.join(dir, "AnkalSans.ttf")), "הפונט הישן עדיין בתיקייה");
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("  ✓", name); }
  catch (error) { failed++; console.log("  ✗", name, "\n      " + String(error.message).split("\n")[0]); }
}
if (failed) { console.log(`\n${failed} בדיקות חיווט נכשלו.`); process.exit(1); }
console.log(`\n${tests.length} בדיקות חיווט עברו בהצלחה.`);
