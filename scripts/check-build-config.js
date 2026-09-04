/* רץ לפני בניית ה-EXE ועוצר אותה אם app-config.json עדיין מכיל ערכי תבנית.
   בלי הבדיקה הבנייה מצליחה, אבל הכניסה עם Google בתוכנה נכשלת אצל כל מי
   שיוריד את הקובץ — ומגלים את זה רק אחרי שהגרסה כבר פורסמה. */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "app-config.json");
const config = JSON.parse(fs.readFileSync(file, "utf8"));

const bad = ["googleDesktopClientId", "googleDesktopClientSecret"]
  .filter((key) => !config[key] || String(config[key]).includes("PASTE_"));

if (bad.length) {
  console.error("הבנייה נעצרה: app-config.json עדיין לא מולא — " + bad.join(", "));
  console.error("מלאו את הערכים לפי app-config.example.json (מדריך: ADMIN_SETUP_GUIDE_HE.md, שלב 1).");
  process.exit(1);
}
console.log("app-config.json תקין לבנייה.");
