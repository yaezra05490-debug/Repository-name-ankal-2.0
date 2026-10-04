# Sets environment variables of the Ankal site on Netlify via the API (functions read them at deploy time).
# Usage:  powershell -ExecutionPolicy Bypass -File .\scripts\netlify-env.ps1 -Vars @{ ADMIN_EMAIL='me@example.com' }
#         powershell -ExecutionPolicy Bypass -File .\scripts\netlify-env.ps1 -SaJson 'C:\path\service-account.json'
#         powershell -ExecutionPolicy Bypass -File .\scripts\netlify-env.ps1 -List
# Token: -Token <PAT>, or the file %LOCALAPPDATA%\Ankal\netlify-token.txt (never commit it).
param([string]$Token = '', [hashtable]$Vars = @{}, [string]$SaJson = '', [switch]$List, [string]$Site = 'aivr-anshak.netlify.app')
$ErrorActionPreference = 'Stop'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
if (-not $Token) { $tokenFile = Join-Path $env:LOCALAPPDATA 'Ankal\netlify-token.txt'; if (Test-Path $tokenFile) { $Token = [System.IO.File]::ReadAllText($tokenFile).Trim() } }
if (-not $Token) { throw 'No Netlify token: pass -Token or create %LOCALAPPDATA%\Ankal\netlify-token.txt' }
$api = 'https://api.netlify.com/api/v1'
$auth = @{ Authorization = "Bearer $Token" }
$siteInfo = Invoke-RestMethod -Uri "$api/sites/$Site" -Headers $auth
$slug = $siteInfo.account_slug; $siteId = $siteInfo.id
"site: $($siteInfo.name)  account: $slug"
if ($SaJson) { $Vars['GOOGLE_SA_JSON'] = [System.IO.File]::ReadAllText($SaJson, (New-Object System.Text.UTF8Encoding($false))) }
$existing = @{}
try { (Invoke-RestMethod -Uri "$api/accounts/$slug/env?site_id=$siteId" -Headers $auth) | ForEach-Object { $existing[$_.key] = $_ } } catch {}
if ($List) { "existing variables: " + (($existing.Keys | Sort-Object) -join ', '); return }
foreach ($k in $Vars.Keys) {
  $item = @{ key = $k; scopes = @('functions', 'builds', 'runtime', 'post_processing'); values = @(@{ value = [string]$Vars[$k]; context = 'all' }) }
  if ($existing[$k]) {
    $json = $item | ConvertTo-Json -Depth 5 -Compress
    $null = Invoke-RestMethod -Uri "$api/accounts/$slug/env/$k`?site_id=$siteId" -Method Put -Headers $auth -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
    "  updated $k"
  } else {
    $json = ConvertTo-Json -Depth 5 -Compress -InputObject @($item)
    $null = Invoke-RestMethod -Uri "$api/accounts/$slug/env?site_id=$siteId" -Method Post -Headers $auth -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
    "  created $k"
  }
}
"done. Values take effect on the next deploy (push to GitHub)."
