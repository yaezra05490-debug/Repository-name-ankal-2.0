# מעלה את קובץ ההתקנה של Windows ל-GitHub Releases.
#
# למה סקריפט ולא העלאה ידנית: הכתובת שהאתר מצביע עליה היא
# releases/latest/download/ankal-windows.exe — היא עובדת רק אם שם הקובץ
# במהדורה זהה בדיוק. הסקריפט מבטיח את זה.
#
# דרישה חד-פעמית: GitHub CLI מותקן ומחובר.
#   winget install GitHub.cli
#   gh auth login
#
# שימוש:  .\scripts\release.ps1            (גרסה מ-package.json)
#         .\scripts\release.ps1 -Version 2.1.0

param([string]$Version = "")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "GitHub CLI לא מותקן." -ForegroundColor Red
  Write-Host "התקינו:  winget install GitHub.cli"
  Write-Host "ואז:     gh auth login"
  exit 1
}

if (-not $Version) { $Version = (Get-Content package.json -Raw | ConvertFrom-Json).version }
$tag = "v$Version"
$exe = Join-Path $root "dist\ankal-windows.exe"

if (-not (Test-Path $exe)) {
  Write-Host "לא נמצא $exe" -ForegroundColor Red
  Write-Host "הריצו קודם:  npm run build"
  exit 1
}

$mb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "מעלה $tag  ($mb MB)…" -ForegroundColor Cyan

# מהדורה קיימת מתעדכנת במקום ליפול על שגיאה, כדי שאפשר יהיה לתקן בנייה שגויה.
$exists = (gh release view $tag 2>$null)
if ($LASTEXITCODE -eq 0) {
  Write-Host "המהדורה $tag כבר קיימת — מחליף את הקובץ."
  gh release upload $tag $exe --clobber
} else {
  gh release create $tag $exe --title "אנק״ל $Version" --notes @"
תוכנת Windows של אנק״ל, גרסה $Version.

הקובץ נייד — אין התקנה. מורידים ומפעילים.
התוכנה אינה חתומה דיגיטלית, ולכן Windows עשוי להציג אזהרת SmartScreen
בהפעלה הראשונה: לוחצים ״מידע נוסף״ ואז ״הפעל בכל זאת״.
"@
}

if ($LASTEXITCODE -ne 0) { Write-Host "ההעלאה נכשלה." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "הועלה. הכפתור באתר כבר מצביע לכאן:" -ForegroundColor Green
Write-Host "https://github.com/yaezra05490-debug/Repository-name-ankal-2.0/releases/latest/download/ankal-windows.exe"
