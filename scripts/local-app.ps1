<#
.SYNOPSIS
  Start the installable local RTS AI app at http://127.0.0.1:3450: the Faction Studio, the website and the native
  battle runner on one origin.

.DESCRIPTION
  Runs from the canonical RTSAI-Web checkout without changing its Git branch. Existing Startup launchers can
  run this hidden at login. -NoUpdate is retained for compatibility with older launch commands.

  Ports: 3450 the app (Studio, plus a proxy to the website), 3451 the production website (loopback only),
  3462 the native OpenRA runner used by Workshop experiments. Logs: .cache\local-app\.
#>
param([switch]$NoUpdate, [string]$Branch = "main")
$ErrorActionPreference = "Stop"

$App = Split-Path -Parent $PSScriptRoot
$Games = Split-Path -Parent $App
$State = Join-Path $App ".cache\local-app"
New-Item -ItemType Directory -Force $State | Out-Null
Start-Transcript -Path (Join-Path $State "start.log") -Force | Out-Null

$AppPort = 3450; $SitePort = 3451; $RunnerPort = 3462
$Python = Join-Path $Games "OpenRA-AI\.venv\Scripts\python.exe"
$Node = (Get-Command node).Source

function Stop-AppServers {
  # Only this worktree's own servers: their command lines carry its path.
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='python.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\').Contains($App + '\') } |
    ForEach-Object { Write-Host "Stopping $($_.Name) $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Get-PortOwner($port) {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { return $listener.OwningProcess }
  return $null
}

function Start-Server($name, $file, $arguments) {
  $process = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $App -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $State "$name.log") -RedirectStandardError (Join-Path $State "$name.err")
  Write-Host "Started $name (PID $($process.Id))"
}

try {
  Set-Location $App
  Stop-AppServers

  if ($Branch -ne 'main') { throw 'The local Studio uses the canonical main checkout.' }
  $head = (git rev-parse HEAD).Trim()
  Write-Host "Serving $head"

  $lock = (Get-FileHash package-lock.json).Hash
  $lockStamp = Join-Path $State "lock.sha"
  if (-not (Test-Path node_modules) -or -not (Test-Path $lockStamp) -or (Get-Content $lockStamp) -ne $lock) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    Set-Content $lockStamp $lock
  }

  # Optional reference caches live in this checkout's .cache; retired folders are not runtime dependencies.

  # The local app is an admin build: it keeps Campaign studio and AI testing, which rtsai.net leaves out (lib/admin.ts).
  $env:RTSAI_ADMIN = "1"
  $siteStamp = Join-Path $State "site.sha"
  $siteBuild = "$head admin"
  if (-not (Test-Path dist) -or -not (Test-Path $siteStamp) -or (Get-Content $siteStamp) -ne $siteBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Website build failed" }
    Set-Content $siteStamp $siteBuild
  }

  $busy = Get-PortOwner $AppPort
  if ($busy) { throw "Port $AppPort is already used by PID $busy; the app needs it." }

  # Studio encounters and Workshop experiments launch OpenRA; keep the AI co-commander off for them.
  $env:OPENRA_AI_HOST = "0"
  $env:RTSAI_STUDIO_PYTHON = $Python
  $env:RTSAI_STUDIO_PORT = "$AppPort"
  $env:RTSAI_SITE_ORIGIN = "http://127.0.0.1:$SitePort"

  if (Get-PortOwner $RunnerPort) { Write-Host "Port $RunnerPort already has a native runner; using it." }
  else { Start-Server "runner" $Python @("`"$App\tools\native-eval-server.py`"") }
  if (Get-PortOwner $SitePort) { throw "Port $SitePort is already used by PID $(Get-PortOwner $SitePort)." }
  Start-Server "site" $Node @("`"$App\node_modules\vinext\dist\cli.js`"", "start", "-p", "$SitePort", "-H", "127.0.0.1")
  # The Studio uses the exact accepted game, verified by the shared launcher. A healthy wrong server is insufficient.
  $WebGame = Join-Path $Games "RTSAI-WebGame"
  $launcher = Join-Path $WebGame 'tools/local-game.mjs'
  if (!(Test-Path -LiteralPath $launcher)) { throw 'The verified web-game launcher is missing; refusing an unverified /play server.' }
  $gameOutput = & $Node $launcher start
  if ($LASTEXITCODE -ne 0) { throw 'The accepted web game could not be verified; see the launcher error.' }
  $game = ($gameOutput -join "`n") | ConvertFrom-Json
  $env:RTSAI_WEBGAME_ORIGIN = ([uri]$game.url).GetLeftPart([System.UriPartial]::Authority)
  $env:RTSAI_WEBGAME_PORT = [string]([uri]$game.url).Port
  Write-Host "Verified webgame $($game.buildId) at $env:RTSAI_WEBGAME_ORIGIN"
  Start-Server "studio" $Node @("--import", "tsx", "`"$App\scripts\art-lab-preview.ts`"")

  $deadline = (Get-Date).AddMinutes(4)
  do {
    Start-Sleep -Seconds 3
    try { $ready = (Invoke-WebRequest "http://127.0.0.1:$AppPort/factions" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200 } catch { $ready = $false }
  } until ($ready -or (Get-Date) -gt $deadline)
  if ($ready) { Write-Host "RTS AI Studio is ready: http://127.0.0.1:$AppPort/art/review" }
  else { Write-Host "Not answering yet; see $State\studio.err and site.err" }
}
catch { Write-Host "Failed: $_" }
finally { Stop-Transcript | Out-Null }
