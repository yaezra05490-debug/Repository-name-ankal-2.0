@echo off
chcp 65001 >nul
rem מריץ את כל הבדיקות עם ה-Node הנייד שבתיקיית הפרויקט — בלי צורך בהתקנה.
cd /d "%~dp0"
"%~dp0node\node.exe" tests\run-tests.js
echo.
pause
