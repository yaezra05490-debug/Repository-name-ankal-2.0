# אנק״ל 2.0

מערכת עברית לניהול, ניקוי והמרת אנשי קשר. האתר מיועד ל־Netlify, שרת הנתונים הוא Google Apps Script, והמידע המקוון נשמר ב־Google Drive של המנהל.

## מבנה הפרויקט

- `src/` — האתר.
- `netlify/functions/ankal-api.mjs` — החיבור בין האתר ל־Apps Script.
- `apps-script/` — קוד השרת.
- `main.js`, `preload.js` — תוכנת Windows.
- `ADMIN_SETUP_GUIDE_HE.md` — מדריך הקמה מלא למנהל.
- `USER_GUIDE_HE.md` — מדריך למשתמשים.

## כתובת Apps Script

מומלץ להגדיר ב־Netlify משתנה סביבה `APPS_SCRIPT_URL`. לחלופין פותחים רק את `netlify/functions/ankal-api.mjs` ומחליפים את `PASTE_APPS_SCRIPT_URL_HERE` בכתובת `/exec`.

## בדיקה ובנייה

```bash
npm test
npm install
npm run build
```

בניית Windows נעצרת אם הבדיקות נכשלות.
