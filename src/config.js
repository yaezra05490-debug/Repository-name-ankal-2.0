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

  /* כתובת קובץ ההתקנה של תוכנת Windows, לכפתור "הורדת התוכנה למחשב" בדף הנחיתה.

     הקובץ מתארח ב-GitHub Releases ולא באתר, כי הוא שוקל כ-92MB — נפח כזה בתוך
     המאגר היה מנפח כל שכפול ומאט כל דיפלוי. הכתובת "releases/latest" יציבה:
     היא מפנה תמיד למהדורה האחרונה, ולכן אין צורך לעדכן כאן דבר בשחרור גרסה.

     להעלאת גרסה חדשה: npm run build ואז scripts/release.ps1 */
  DOWNLOAD_URL: "https://github.com/yaezra05490-debug/Repository-name-ankal-2.0/releases/latest/download/ankal-windows.exe",

  // גרסת מבנה הנתונים. אין לשנות ידנית.
  DATA_VERSION: 2,
  APP_VERSION: "2.0.0",
  TERMS_VERSION: "2026-08-21",
  PRIVACY_VERSION: "2026-08-21",
  AUTOSAVE_DELAY_MS: 1800,
  CONTACTS_PAGE_SIZE: 100,
  REGEX_TIMEOUT_MS: 1800,
});
