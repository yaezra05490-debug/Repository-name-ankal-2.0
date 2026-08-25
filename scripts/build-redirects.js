/* יוצר את src/_redirects בזמן הבנייה ב-Netlify.
 *
 * למה לא פשוט לכתוב את הכתובת ב-netlify.toml: המאגר ציבורי, וכל מי שיפתח שם
 * את הקובץ יראה את הכתובת ה"סודית". כאן היא מגיעה ממשתנה סביבה של Netlify,
 * שאינו נשמר בקוד ואינו נראה לאיש מלבד בעל האתר.
 *
 * הגדרה חד-פעמית ב-Netlify:
 *   Site configuration → Environment variables → ADMIN_PATH = הכתובת שתבחרו
 *
 * הסודיות היא שכבה נוספת בלבד. ההגנה האמיתית היא בדיקת ADMIN_EMAIL בשרת
 * Apps Script, שרצה על כל בקשה ובקשה גם למי שהגיע לכתובת הנכונה.
 */
const fs = require("fs");
const path = require("path");

const raw = String(process.env.ADMIN_PATH || "").trim().replace(/^\/+/, "");
const target = path.join(__dirname, "..", "src", "_redirects");

if (!raw) {
  // בלי משתנה סביבה אין דרך להגיע לדף הניהול — וזו התנהגות נכונה יותר
  // מאשר ליפול חזרה לכתובת ברירת מחדל שכולם מכירים.
  fs.writeFileSync(target, "# ADMIN_PATH לא הוגדר — אתר הניהול אינו נגיש.\n", "utf8");
  console.log("ADMIN_PATH לא הוגדר. אתר הניהול לא יהיה נגיש בבנייה הזו.");
  process.exit(0);
}

if (!/^[A-Za-z0-9._~-]+$/.test(raw)) {
  console.error(`ADMIN_PATH מכיל תווים לא חוקיים: ${raw}`);
  console.error("מותר: אותיות באנגלית, ספרות, מקף, קו תחתון, נקודה, טילדה.");
  process.exit(1);
}

fs.writeFileSync(target, `# נוצר אוטומטית בזמן הבנייה. אין לערוך ידנית ואין להוסיף ל-git.\n/${raw}  /YAEZRA/index.html  200\n`, "utf8");
console.log(`אתר הניהול זמין בכתובת /${raw}`);
