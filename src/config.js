/* ================================================================
   הגדרות אנק״ל

   לאחר יצירת שרת Apps Script יש לעדכן את הכתובת במקום הברור
   בקובץ: netlify/functions/ankal-api.mjs

   כאן מכניסים רק את מזהה ההתחברות לאתר שקיבלתם מ-Google Cloud.
   אין להכניס כאן סיסמה, מפתח סודי או הרשאה ל-Google Drive.
   ================================================================ */
window.ANKAL_CONFIG = Object.freeze({
  SITE_URL: "https://aivr-anshak.netlify.app",

  // הדביקו כאן Google OAuth Web Client ID. השאירו ריק עד שמגדירים כניסה.
  GOOGLE_WEB_CLIENT_ID: "149781710735-vneicgr2u83qbdrbkhfpkcljoi8knej2.apps.googleusercontent.com",

  // ב-Netlify הפנייה עוברת דרך פונקציה מאובטחת אל Apps Script.
  API_PATH: "/.netlify/functions/ankal-api",

  /* קובצי גיבוי קיוליקס (עד כמה מגה-בייט) נשלחים ישירות ל-Apps Script: דרך הפונקציה בנטליפי הם נתקעו
     במגבלת 10 השניות שלה (INVALID_RESPONSE). הכתובת ציבורית ממילא; הזהות נבדקת בסקריפט לפי ה-ID Token. */
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxPc9F_6BUF593fe4qUtCTI-o2qXue_lt6MV6BtV5ujob3ouLa6uYJUYcBK2bN-wL1ahQ/exec",

  /* כתובת קובץ ההתקנה של תוכנת Windows, לכפתור "הורדת התוכנה למחשב" בדף הנחיתה.

     הקובץ מתארח ב-GitHub Releases ולא באתר, כי הוא שוקל כ-92MB — נפח כזה בתוך
     המאגר היה מנפח כל שכפול ומאט כל דיפלוי. הכתובת "releases/latest" יציבה:
     היא מפנה תמיד למהדורה האחרונה, ולכן אין צורך לעדכן כאן דבר בשחרור גרסה.

     להעלאת גרסה חדשה: npm run build ואז scripts/release.ps1 */
  DOWNLOAD_URL: "https://github.com/yaezra05490-debug/Repository-name-ankal-2.0/releases/latest/download/ankal-windows.exe",

  // גרסת מבנה הנתונים. אין לשנות ידנית.
  DATA_VERSION: 2,
  APP_VERSION: "2.0.1",
  TERMS_VERSION: "2026-08-21",
  PRIVACY_VERSION: "2026-08-21",
  AUTOSAVE_DELAY_MS: 1800,
  REGEX_TIMEOUT_MS: 1800,
});
