param([ValidateSet('Website','Studio')][string]$App = 'Website', [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$games = Split-Path $repository -Parent
$state = Join-Path $repository '.cache/app-launchers'
New-Item -ItemType Directory -Force -Path $state | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
$env:RTSAI_ADMIN = '1'
$port = if ($App -eq 'Studio') { 3450 } else { 3451 }
$url = if ($App -eq 'Studio') { 'http://127.0.0.1:3450/art/review' } else { 'http://127.0.0.1:3451/' }
function Ready([string]$Address) {
    try { return (Invoke-WebRequest $Address -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { return $false }
}
function Start-LocalWebsite {
    if (Ready 'http://127.0.0.1:3451/') { return }
    if (!(Test-Path -LiteralPath (Join-Path $repository 'dist'))) { throw 'Build the canonical website first: npm run build.' }
    if (Get-NetTCPConnection -State Listen -LocalPort 3451 -ErrorAction SilentlyContinue) { throw 'Port 3451 is occupied by an unresponsive server. It was left untouched.' }
    if (!(Ready 'http://127.0.0.1:3452/')) {
        if (Get-NetTCPConnection -State Listen -LocalPort 3452 -ErrorAction SilentlyContinue) { throw 'Website renderer port 3452 is occupied by an unresponsive server. It was left untouched.' }
        Start-Process -FilePath $node -ArgumentList @("`"$repository/node_modules/vinext/dist/cli.js`"",'start','-p','3452','-H','127.0.0.1') -WorkingDirectory $repository -WindowStyle Hidden -RedirectStandardOutput "$state/website-renderer.log" -RedirectStandardError "$state/website-renderer.err"
    }
    Start-Process -FilePath $node -ArgumentList @('--import','tsx',"`"$repository/scripts/website-app-server.ts`"") -WorkingDirectory $repository -WindowStyle Hidden -RedirectStandardOutput "$state/website.log" -RedirectStandardError "$state/website.err"
}
Start-LocalWebsite
if ($App -eq 'Studio' -and !(Ready $url)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw 'Studio port 3450 is occupied by an unresponsive server. It was left untouched.' }
    $gameOutput = & $node (Join-Path $games 'RTSAI-WebGame/tools/local-game.mjs') start
    if ($LASTEXITCODE -ne 0) { throw 'The verified local game could not start.' }
    $game = ($gameOutput -join "`n") | ConvertFrom-Json
    $env:RTSAI_ADMIN = '1'
    $env:OPENRA_AI_HOST = '0'
    $env:RTSAI_STUDIO_PORT = '3450'
    $env:RTSAI_SITE_ORIGIN = 'http://127.0.0.1:3451'
    $env:RTSAI_WEBGAME_ORIGIN = ([uri]$game.url).GetLeftPart([UriPartial]::Authority)
    Start-Process -FilePath $node -ArgumentList @('--import','tsx',"`"$repository/scripts/art-lab-preview.ts`"") -WorkingDirectory $repository -WindowStyle Hidden -RedirectStandardOutput "$state/studio.log" -RedirectStandardError "$state/studio.err"
}
$deadline = (Get-Date).AddMinutes(2)
while (!(Ready $url)) {
    if ((Get-Date) -gt $deadline) { throw "App did not become ready: $url. See $state." }
    Start-Sleep -Milliseconds 500
}
if (!$NoOpen) {
    $browser = @("$env:ProgramFiles/Google/Chrome/Application/chrome.exe", "${env:ProgramFiles(x86)}/Microsoft/Edge/Application/msedge.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (!$browser) { throw 'Chrome or Edge is required for an app window.' }
    # The installed Studio retains its existing browser app ID when present.
    $registration = Join-Path $env:LOCALAPPDATA 'RTSAI/app-shortcuts/installed-studio.json'
    if ($App -eq 'Studio' -and (Test-Path -LiteralPath $registration)) {
        $installed = Get-Content -LiteralPath $registration -Raw | ConvertFrom-Json
        Start-Process -FilePath $installed.target -ArgumentList $installed.arguments
    } else { Start-Process -FilePath $browser -ArgumentList "--app=$url" }
}
Write-Output "$App ready: $url"
