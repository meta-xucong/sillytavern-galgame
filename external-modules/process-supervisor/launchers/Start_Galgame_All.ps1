# Start_Galgame_All.ps1
# One-click launcher for SillyTavern + Galgame backends.
# Uses the project's wscript detach so processes survive independently.
# After successful health check it auto-opens http://127.0.0.1:8000/game/ in the default browser.
# Pass -NoBrowser to suppress the auto-open (e.g. Start_Galgame_All.bat -NoBrowser).
param(
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location $repo
$script:Failures = [System.Collections.Generic.List[string]]::new()
$script:PresentationExpected = $false

function Log($m){ Write-Host $m }

function Open-GamePage {
  param([string]$Url)
  try {
    Start-Process $Url
    Log "[browser] opened $Url"
  } catch {
    Log "  -> WARN: could not auto-open browser: $_"
    Log "     Please open manually: $Url"
  }
}

function GetEnvVal($content, $k){
  $l = $content | Where-Object { $_ -match "^$k\s*=" }
  if($l){ return ($l -split '=',2)[1].Trim().Trim('"').Trim("'") }
  return ''
}

$node = (Get-Command node.exe).Source
if (-not $node) { Log 'ERROR: node.exe not found. Please install Node.js.'; exit 1 }
$vbs = Join-Path $repo 'external-modules\process-supervisor\run-hidden.vbs'
if (-not (Test-Path $vbs)) { Log "ERROR: missing $vbs"; exit 1 }
$secretFile = Join-Path $repo '.codex-longrun\galgame-bridge-proof-secret.txt'
try {
  if (-not (Test-Path -LiteralPath $secretFile -PathType Leaf)) { throw 'missing' }
  $secret = [IO.File]::ReadAllText($secretFile).Trim()
  if ([string]::IsNullOrWhiteSpace($secret)) { throw 'empty' }
} catch {
  Log 'ERROR: required runtime proof configuration is unavailable; startup aborted.'
  exit 1
}

$computer = $env:COMPUTERNAME.ToLowerInvariant()
$origins = "http://127.0.0.1:8000,http://localhost:8000,http://$computer`:8000,http://$computer`:8001"
$origins8001 = "http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8001,http://localhost:8001,http://$computer`:8000,http://$computer`:8001"

function Test-Port($p){
  try { $c = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1; return ($c -and $c.OwningProcess) }
  catch { return $false }
}
function Set-Env($k,$v){ try { [Environment]::SetEnvironmentVariable($k, [string]$v, 'Process') } catch {} }
function Launch($name, $entryRel){
  $entry = Join-Path $repo $entryRel
  try {
    Start-Process -FilePath 'wscript.exe' -ArgumentList '//B','//NoLogo',"`"$vbs`"","`"$node`"", "`"$entry`"" -WindowStyle Hidden | Out-Null
    Log "  -> launched $name"
  } catch {
    Log "  -> FAILED $name : $_"
    $script:Failures.Add($name)
  }
}

function Launch-Batch($name, $entryRel){
  $entry = Join-Path $repo $entryRel
  $quotedVbs = '"{0}"' -f $vbs
  $quotedEntry = '"{0}"' -f $entry
  try {
    Start-Process -FilePath 'wscript.exe' -ArgumentList '//B','//NoLogo',$quotedVbs,$quotedEntry,'--galgame-hidden-child' -WindowStyle Hidden | Out-Null
    Log "  -> launched $name"
  } catch {
    Log "  -> FAILED $name : $_"
    $script:Failures.Add($name)
  }
}

# 0) Frontend (8000)
if (Test-Port 8000) {
  Log '[frontend] 8000 already listening, skip SillyTavern start.'
} else {
  Log '[frontend] 8000 not listening, launching node server.js ...'
  try {
    Start-Process -FilePath 'wscript.exe' -ArgumentList '//B','//NoLogo',"`"$vbs`"","`"$node`"", "`"$repo\server.js`"" -WindowStyle Hidden | Out-Null
  } catch {
    Log "  -> FAILED frontend : $_"
    $script:Failures.Add('frontend 8000')
  }
}

# 1) game-config-service (8791)
Set-Env 'HOST' '127.0.0.1'; Set-Env 'PORT' '8791'
Set-Env 'SILLYTAVERN_BASE_URL' 'http://127.0.0.1:8000'
Set-Env 'GALGAME_SILLYTAVERN_BASE_URL' 'http://127.0.0.1:8000'
Set-Env 'GALGAME_CORS_ORIGIN' $origins
Set-Env 'GALGAME_BRIDGE_PROOF_SECRET' $secret
Log '[config] starting game-config-service (8791)'; Launch 'game-config' 'external-modules\game-config-service\server.mjs'

# 2) original-runtime-bridge (8795)
Set-Env 'HOST' '127.0.0.1'; Set-Env 'PORT' '8795'
Set-Env 'SILLYTAVERN_BASE_URL' 'http://127.0.0.1:8000'
Set-Env 'GALGAME_SILLYTAVERN_BASE_URL' 'http://127.0.0.1:8000'
Set-Env 'GALGAME_ALLOWED_ORIGINS' $origins
Set-Env 'GALGAME_BRIDGE_USER_DATA_DIR' "$repo\.codex-longrun\original-runtime-bridge-chrome-claude"
Set-Env 'GALGAME_BRIDGE_PROOF_SECRET' $secret
Log '[bridge] starting original-runtime-bridge (8795)'; Launch 'runtime-bridge' 'external-modules\original-runtime-bridge\server.mjs'
Set-Env 'GALGAME_BRIDGE_PROOF_SECRET' ''
Set-Env 'GALGAME_BRIDGE_USER_DATA_DIR' ''
$secret = $null

# 3) presentation-analysis-service (8801)
$envf = $env:GALGAME_PRESENTATION_ENV_FILE
if ([string]::IsNullOrWhiteSpace($envf)) { $envf = Join-Path $repo '.env.local' }
$pv = ''; $pb = ''; $pk = ''; $pm = ''
if (Test-Path $envf) {
  $content = Get-Content $envf -ErrorAction SilentlyContinue
  $pv = 'openai-compatible'
  $pb = GetEnvVal $content 'REFERENCE_VISION_BASE_URL'
  $pk = GetEnvVal $content 'REFERENCE_VISION_API_KEY'
  $pm = GetEnvVal $content 'REFERENCE_VISION_MODEL'
  if ($pv -eq 'aiself-openai-compatible') { $pv = 'openai-compatible' }
}
if ($pb -and $pk -and $pm) {
  $script:PresentationExpected = $true
  Log "[presentation] starting presentation-analysis-service (8801) provider=$pv model=$pm"
  Launch-Batch 'presentation' 'external-modules\presentation-analysis-service\StartGalgamePresentationAnalysisService.cmd'
} else {
  Log '[presentation] SKIP: visual provider configuration is unavailable'
}
$pk = $null
$content = $null

# 4) visual-asset-service (8798) - legacy mode (no analyzer token) to avoid hanging on missing REFERENCE_VISION_*.
Set-Env 'GALGAME_VISUAL_ASSET_HOST' '127.0.0.1'
Set-Env 'GALGAME_VISUAL_ASSET_PORT' '8798'
Set-Env 'GALGAME_VISUAL_ASSET_ADMIN_TOKEN' ''
Set-Env 'GALGAME_VISUAL_ASSET_ADMIN_ORIGINS' ''
Set-Env 'GALGAME_VISUAL_CORE_PLAYER_ORIGINS' $origins8001
Set-Env 'GALGAME_VISUAL_ANALYZER_TOKEN' ''
Set-Env 'GALGAME_VISUAL_RUNTIME_TOKEN' ''
Set-Env 'GALGAME_VISUAL_ASSET_DATA_DIR' "$repo\external-modules\visual-asset-service\data"
Log '[visual] starting visual-asset-service (8798) [legacy mode]'; Launch 'visual' 'external-modules\visual-asset-service\server.mjs'

# Health check
Start-Sleep -Seconds 6
$probes = @(
  @{n='frontend 8000'; u='http://127.0.0.1:8000/game/'; kind='http'},
  @{n='config 8791'; u='http://127.0.0.1:8791/v1/health'; kind='config'},
  @{n='bridge 8795'; u='http://127.0.0.1:8795/health'; kind='bridge'},
  @{n='presentation 8801'; u='http://127.0.0.1:8801/v1/health'; kind='presentation'},
  @{n='visual 8798'; u='http://127.0.0.1:8798/v1/health'; kind='visual'}
)
Write-Host ''
Write-Host '==== Health check ===='
foreach ($p in $probes) {
  if ($p.n -eq 'presentation 8801' -and -not $script:PresentationExpected) {
    Write-Host "  [SKIP] $($p.n) (optional provider is not configured)"
    continue
  }
  $ok = $false
  for ($i = 0; $i -lt 25; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $p.u
      $ok = $r.StatusCode -eq 200
      if ($ok -and $p.kind -ne 'http') {
        $body = $r.Content | ConvertFrom-Json
        switch ($p.kind) {
          'config' { $ok = ($body.ok -eq $true -and $body.runtimeProof.configured -eq $true) }
          'bridge' { $ok = ($body.ok -eq $true -and $body.ready -eq $true -and $body.proofRequired -eq $true -and $body.proofConfigured -eq $true) }
          'presentation' { $ok = ($body.serviceReady -eq $true -and $body.analyzerConfigured -eq $true) }
          'visual' { $ok = ($body.ok -eq $true) }
        }
      }
      if ($ok) { break }
    } catch { $ok = $false }
    Start-Sleep -Milliseconds 500
  }
  if ($ok) { Write-Host "  [OK]   $($p.n)" } else { Write-Host "  [FAIL] $($p.n)"; $script:Failures.Add($p.n) }
}
Write-Host '==== Done. Frontend: http://127.0.0.1:8000/game/ ===='
$gameUrl = 'http://127.0.0.1:8000/game/'
$frontendOk = -not ($script:Failures -contains 'frontend 8000')
if ($frontendOk -and -not $NoBrowser) {
  # Give the backend services a brief moment to finish their own init,
  # then pop the game page in the user's default browser.
  Start-Sleep -Seconds 1
  Open-GamePage -Url $gameUrl
} elseif ($NoBrowser) {
  Write-Host '[browser] skipped (-NoBrowser)'
} else {
  Write-Host "  -> Browser not opened because frontend did not pass health check. Open manually: $gameUrl"
}
if ($script:Failures.Count -gt 0) {
  Write-Error ('Startup failed for: ' + ($script:Failures -join ', '))
  exit 1
}
exit 0
