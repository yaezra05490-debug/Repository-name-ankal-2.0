@echo off
chcp 65001 >nul
rem מפעיל את התוכנה עם ה-Node הנייד. בהרצה ראשונה מתקין את התלויות (דורש אינטרנט).
cd /d "%~dp0"
set "PATH=%~dp0node;%PATH%"
if not exist "node_modules\electron" (
  echo מתקין תלויות בפעם הראשונה, זה ייקח כמה דקות...
  call "%~dp0node\npm.cmd" install || goto :fail
)
call "%~dp0node\npm.cmd" start
goto :eof

:fail
echo.
echo ההתקנה נכשלה. בדקו חיבור לאינטרנט ונסו שוב.
pause
