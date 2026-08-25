# סיכום פרויקט ANKAL 2.0

## תאריך
2026-08-22

## 1) מבנה הפרויקט

- אתר Netlify: https://aivr-anshak.netlify.app/
- קובץ Netlify Function: netlify/functions/ankal-api.mjs
- קובץ Apps Script: apps-script/Code.gs
- קובץ תצורה: app-config.json
- קובץ Netlify config: netlify.toml

## 2) קישורים עיקריים

### אתר Netlify
https://aivr-anshak.netlify.app/

### Netlify Dashboard
https://app.netlify.com/sites/aivr-anshak

### Google Apps Script
https://script.google.com

### Google Drive
https://drive.google.com

### Google Sheet של הפרויקט
https://docs.google.com/spreadsheets/d/1suwQ5CDWFdjXhime_muEWgASDDE8R_h93monRv944-4/edit

## 3) מזהים ו-URLs שהוגדרו

### Apps Script URL
https://script.google.com/macros/s/AKfycbxPc9F_6BUF593fe4qUtCTI-o2qXue_lt6MV6BtV5ujob3ouLa6uYJUYcBK2bN-wL1ahQ/exec

### Spreadsheet ID
1suwQ5CDWFdjXhime_muEWgASDDE8R_h93monRv944-4

### Desktop OAuth Client ID
149781710735-jmvkdivfn320fpcf5inteft1tj5issc1.apps.googleusercontent.com

### Netlify Variable Name
APPS_SCRIPT_URL

### Netlify Site Name
aivr-anshak

## 4) מה החיבור עושה

אתר Netlify שולח בקשות ל-Function ב-netlify/functions/ankal-api.mjs.
ה-Func שולח את הבקשה ל-Google Apps Script.
Apps Script מאמת Google ID Token ומעדכן/קורא מתוך Google Sheets/Drive.

## 5) אחסון הנתונים

### תיקיית Drive ראשית
ANKAL_DATA

### Spreadsheet ראשי
ANKAL_DATABASE

### גיליונות בתוך ה-Spreadsheet
- משתמשים
- פעולות
- תקלות

## 6) קוד שהוגדר ל-Sheet

ב-Apps Script הוגדר:

```javascript
var SHEET_ID = "1suwQ5CDWFdjXhime_muEWgASDDE8R_h93monRv944-4";
var USERS_SHEET = "משתמשים";
var LOGS_SHEET = "פעולות";
var ERRORS_SHEET = "תקלות";
```

הפונקציה `sheet_()` פותחת את ה-Spreadsheet על פי ה-ID ומייצרת גיליונות אם הם לא קיימים.

## 7) מבנה החיבור

Frontend (Site) -> Netlify Function -> Google Apps Script -> Google Sheets/Drive

## 8) פונקציות חשובות ב-Apps Script

- `testSheetConnection()`
  - בודק חיבור לגליון
  - מדפיס:
    - Sheet name
    - Sheet URL

- `installTriggers()`
  - מגדיר trigger יומי ושבועי לביקופ/גיבוי

- `runDailyMaintenance()`
- `runWeeklyBackup()`

## 9) מה נבדק ומאומת

בדיקה שהושלמה בהצלחה:

- `testSheetConnection()` רץ בהצלחה
- Logs הראו:
  - Sheet name: משתמשים
  - Sheet URL: https://docs.google.com/spreadsheets/d/1suwQ5CDWFdjXhime_muEWgASDDE8R_h93monRv944-4/edit

## 10) הערות חשובות

- זהו פרויקט שמשלב Netlify + Google Apps Script + Google Sheets.
- האתר עצמו אינו האחסון המרכזי; הנתונים נשמרים ב-Google Drive/Sheets.
- האחסון הראשי של המשתמשים והלוגים הוא ב-Spreadsheet ולא ב-Netlify.
- Web Client ID לא הוכנס לקובץ זה בזמן החיבור, ולכן יש להגדיר אותו ב-Google Cloud / src/config.js בהתאם למדריך.

## 11) קבצים רלוונטיים

- [README.md](README.md)
- [ADMIN_SETUP_GUIDE_HE.md](ADMIN_SETUP_GUIDE_HE.md)
- [USER_GUIDE_HE.md](USER_GUIDE_HE.md)
- [netlify.toml](netlify.toml)
- [app-config.json](app-config.json)
- [apps-script/Code.gs](apps-script/Code.gs)
- [netlify/functions/ankal-api.mjs](netlify/functions/ankal-api.mjs)

## 12) מה עושים בשלב הבא

1. לוודא שהאתר נכנס ל-Apps Script בהצלחה.
2. לבצע כניסת משתמש אמיתית ולבדוק שורת משתמשים בגליון.
3. לבדוק לוגים ופעולות.
4. אם יש צורך, להוסיף Web Client ID ב-Google Cloud ובקוד של האתר.
