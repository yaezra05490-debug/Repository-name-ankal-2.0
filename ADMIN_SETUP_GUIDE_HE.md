# מדריך הקמה למנהל — אנק״ל

המדריך מסודר לפי סדר ההקמה. אין להכניס סיסמת Google בשום קובץ.

## 1. Google Cloud

1. צרו פרויקט Google Cloud ופתחו OAuth consent screen.
2. הגדירו שם אפליקציה וכתובת תמיכה. היקפי ההרשאה הם `openid`, `email`, `profile` בלבד.
3. צרו OAuth Client מסוג Web application.
4. הוסיפו Authorized JavaScript origin: `https://aivr-anshak.netlify.app`.
5. הדביקו את ה־Web Client ID ב־`src/config.js` במקום `PASTE_GOOGLE_WEB_CLIENT_ID_HERE`.
6. צרו OAuth Client נוסף מסוג Desktop app והדביקו אותו ב־`app-config.json` במקום `PASTE_GOOGLE_DESKTOP_CLIENT_ID_HERE`.
7. **גם את ה־Client secret של אותו לקוח Desktop.** גוגל דורשת אותו בהחלפת הקוד לטוקן, גם עם PKCE — בלעדיו הכניסה מהתוכנה נכשלת עם `client_secret is missing`. מדביקים ב־`googleDesktopClientSecret`.

`app-config.json` אינו נכנס ל־git, כי הוא מכיל את הסוד הזה והמאגר ציבורי. התבנית למילוי היא `app-config.example.json` — מעתיקים אותה, משנים את השם ל־`app-config.json` וממלאים.

הסוד ארוז בתוך קובץ ה־EXE, וכל מי שמוריד אותו יכול לחלץ אותו. זו אינה תקלה: גוגל עצמה מציינת שבאפליקציות מותקנות הסוד אינו חסוי. הוא אינו מאפשר גישה לנתונים — רק לזהות כאפליקציה מול מסך ההסכמה של גוגל.

אין צורך ב־Client Secret באתר או בתוכנת Windows.

## 2. Google Apps Script

1. פתחו `script.google.com` וצרו פרויקט בשם `ANKAL Server`.
2. העתיקו אליו את `apps-script/Code.gs`.
3. ב־Project Settings → Script properties הוסיפו:

| שם | ערך |
|---|---|
| `ADMIN_EMAIL` | כתובת Gmail של המנהל |
| `GOOGLE_CLIENT_ID` | Web Client ID, פסיק, Desktop Client ID |

4. בחרו Deploy → New deployment → Web app.
5. בחרו Execute as: Me וגישה לכל המשתמשים. הקוד עדיין בודק Google ID Token בכל בקשה.
6. אשרו Drive, Sheets וחיבור ל־Google והעתיקו את הכתובת שמסתיימת ב־`/exec`.

## 3. המקום היחיד לכתובת הסקריפט

מומלץ להגדיר ב־Netlify משתנה סביבה בשם `APPS_SCRIPT_URL` ולהדביק בו את כתובת `/exec`.

אפשר גם לעדכן את כתובת ה־`/exec` בראש `netlify/functions/ankal-api.mjs` — זה המקום היחיד בקוד. אין לשנות מקום אחר.

## 4. העלאה ל־Netlify

המערכת כוללת Netlify Function, לכן העלאת תיקיית `src` בלבד אינה מספיקה.

דרך מומלצת: העלו את כל הפרויקט ל־GitHub, וב־Netlify בחרו Add new site → Import an existing project. הקובץ `netlify.toml` מגדיר לבד את `src` כפרסום ואת `netlify/functions` כפונקציות.

או דרך שורת פקודה:

```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod
```

## 5. בדיקה ראשונה

1. פתחו את האתר בחלון פרטי והיכנסו עם Google.
2. צרו רשימת `בדיקה`, הוסיפו איש קשר והמתינו ל־`נשמר בענן`.
3. רעננו ובדקו שהרשימה חוזרת.
4. היכנסו עם חשבון המנהל ובדקו את `ניהול מערכת`.
5. ב־Drive של המנהל אמורים להופיע `ANKAL_DATA` ו־`ANKAL_DATABASE`.

## 6. גיבויים

בעורך Apps Script בחרו פעם אחת בפונקציה `installTriggers` ולחצו Run. נוצרים גיבוי יומי דחוס של השינויים, גיבוי שבועי מלא, תחזוקת סל, וניקוי גיבויים בני יותר מ־30 יום. הגיבויים נשמרים ב־`ANKAL_DATA/backups`.

## 7. תוכנת Windows

1. הכניסו Desktop Client ID ו־Client Secret ב־`app-config.json` (הבנייה נעצרת אם הם חסרים).
2. הפעילו `npm install` ואז `npm run build`. הקובץ יופיע ב־`dist/ankal-windows.exe`.
3. העלו ל־GitHub Releases עם `scripts/release.ps1` (דורש פעם אחת `winget install GitHub.cli` ואז `gh auth login`).
4. כפתור `הורדת התוכנה למחשב` בדף הנחיתה מצביע ל־`releases/latest/download/ankal-windows.exe` — כתובת יציבה שמפנה תמיד למהדורה האחרונה, ולכן אין מה לעדכן בקוד בשחרור גרסה. אם אתם מארחים את הקובץ במקום אחר, הדביקו את הקישור הישיר ב־`DOWNLOAD_URL` שב־`src/config.js`.
5. כדי שמשתמשי התוכנה הקיימים יקבלו הצעת עדכון, עדכנו את `src/version.json` למספר הגרסה החדש. הקובץ הזה גם קובע לאן הצעת העדכון מפנה.

התוכנה אינה חתומה. Windows עשוי להציג SmartScreen; המשתמשים יבחרו מידע נוסף → הפעל בכל זאת. העדכון מוצג כהצעה ואינו נכפה.

## 8. אחסון והתנהגות

- ללא כניסה העבודה נשמרת בדפדפן או במחשב.
- אחרי כניסה השינויים נשמרים מקומית ונשלחים בתור ל־Drive של המנהל.
- פעולות שצריכות תשובה עוקפות את תור הדיווחים.
- יומן פעולות ותקלות אינו כולל תוכן אנשי קשר.
- מחיקת חשבון מעבירה אותו לסל ל־30 יום.
- משתמש חסום יכול לעבוד מקומית ולייצא, אך אינו מסנכרן.

## 9. תנאים ופרטיות

בעדכון מסמך שנו את `TERMS_VERSION` או `PRIVACY_VERSION` ב־`src/config.js`. מסך המנהל מציג את הגרסה לכל משתמש.

## 10. תקלות נפוצות

- `SERVER_NOT_CONFIGURED`: בדקו את `APPS_SCRIPT_URL` ובצעו Deploy חדש.
- `WRONG_AUDIENCE`: ודאו ששני Client ID נמצאים ב־`GOOGLE_CLIENT_ID`, מופרדים בפסיק.
- אין מסך מנהל: ודאו ש־`ADMIN_EMAIL` זהה לחשבון המחובר.
- ממתין לסנכרון: בדקו אינטרנט, Function logs ומכסות Apps Script. העותק המקומי נשמר.

## 11. שרת שני בנטליפי (אופציונלי)

לצד Google Apps Script יש שרת זהה שרץ בפונקציית Netlify (`netlify/functions/lib/ankal-server.mjs`). הוא עובד על **אותם נתונים**: אותו גיליון (משתמשים, פעולות, תקלות) ואותה תיקיית `ANKAL_DATA` ב-Drive, ולכן אפשר לעבור בין השרתים בכל רגע בלי להעביר כלום. המעבר נעשה באתר הניהול, בלשונית **⚙ שרת**. אם השרת בנטליפי לא מוגדר או שגוגל לא עונה לו, הבקשות נופלות לבד לסקריפט.

הגדרה חד-פעמית:

1. **חשבון שירות** — ב-Google Cloud (אותו פרויקט של הכניסה): APIs & Services ← Credentials ← Create credentials ← Service account. אחרי היצירה: Keys ← Add key ← JSON. שמרו את הקובץ; הוא סוד.
2. **הפעלת API** — באותו פרויקט הפעילו את Google Sheets API ואת Google Drive API.
3. **שיתוף** — פתחו את הגיליון של אנק״ל ואת התיקייה `ANKAL_DATA` ב-Drive, ושתפו כל אחד מהם עם כתובת חשבון השירות (מופיעה בקובץ ה-JSON בשדה `client_email`) בהרשאת **עורך**.
4. **משתני סביבה ב-Netlify** (Site configuration ← Environment variables):
   - `GOOGLE_SA_JSON` — כל תוכן קובץ ה-JSON של חשבון השירות, כמו שהוא.
   - `ADMIN_EMAIL` — מייל המנהל (אותו ערך כמו בסקריפט). בלעדיו אין פעולות ניהול בנטליפי.
   - `GOOGLE_CLIENT_ID` — אופציונלי: מזהי הלקוח של גוגל מופרדים בפסיק. בלי זה משתמשים במזהים המובנים של האתר והתוכנה.
   - `ANKAL_SHEET_ID`, `ANKAL_ROOT_FOLDER_ID` — אופציונלי: מזהה הגיליון ומזהה התיקייה, אם הם לא ברירת המחדל.
   - `ANKAL_SERVER_MODE` — אופציונלי: `script` או `netlify` כדי לכפות שרת בלי קשר לבחירה באתר הניהול. `SERVER_DISABLED=1` מכבה את נטליפי לגמרי.
5. **פריסה** — אחרי שמשתני הסביבה נשמרו, פרסו מחדש (או דחפו ל-GitHub). קודם משתני סביבה, אחר כך פריסה.
6. **בדיקה** — באתר הניהול, לשונית ⚙ שרת: שני השרתים צריכים להופיע "פעיל". לחצו "העבר את המשתמשים לכאן" תחת Netlify. חזרה לסקריפט מאותו מקום.

מה נשאר רק בסקריפט: הגיבויים היומיים/השבועיים וניקוי סל המחזור (הטריגרים). הם ממשיכים לרוץ גם כשהמשתמשים עובדים מול נטליפי.