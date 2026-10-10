param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$gameUrl = 'http://127.0.0.1:8001/game/'
$supervisorUrl = 'http://127.0.0.1:8790'
$logDirectory = Join-Path $repo '.codex-longrun'
$supervisorEntry = Join-Path $repo 'external-modules\process-supervisor\server.mjs'
$startupTimeoutSeconds = 150
$lastProgress = ''

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Write-StartupLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  $line = '{0} {1}' -f (Get-Date).ToString('o'), $Message
  Write-Host $line
}

function Invoke-LoopbackHttp {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [ValidateSet('GET', 'POST')][string]$Method = 'GET',
    [string]$Body = '',
    [hashtable]$Headers = @{},
    [int]$TimeoutMs = 1500
  )

  $request = [System.Net.HttpWebRequest]::Create($Uri)
  $request.Method = $Method
  $request.Proxy = $null
  $request.Timeout = $TimeoutMs
  $request.ReadWriteTimeout = $TimeoutMs
  $request.KeepAlive = $false
  foreach ($name in $Headers.Keys) {
    if ($name -in @('Content-Type', 'Accept')) { continue }
    $request.Headers[$name] = [string]$Headers[$name]
  }
  $request.Accept = 'application/json, text/html;q=0.9, */*;q=0.5'
  if ($Method -eq 'POST') {
    $request.ContentType = 'application/json; charset=utf-8'
    $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
    $request.ContentLength = $bytes.Length
    $stream = $request.GetRequestStream()
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  }

  $response = $null
  try {
    try {
      $response = $request.GetResponse()
    } catch [System.Net.WebException] {
      if (-not $_.Exception.Response) { throw }
      $response = $_.Exception.Response
    }
    $reader = [IO.StreamReader]::new($response.GetResponseStream())
    try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
    return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Content = $content }
  } finally {
    if ($response) { $response.Dispose() }
  }
}

function Get-JsonHealth {
  param([Parameter(Mandatory = $true)][string]$Uri)
  try {
    $result = Invoke-LoopbackHttp -Uri $Uri -TimeoutMs 1200
    if ($result.StatusCode -ne 200) { return $null }
    return ($result.Content | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    return $null
  }
}

function Test-GamePage {
  try {
    $result = Invoke-LoopbackHttp -Uri $gameUrl -TimeoutMs 1200
    return $result.StatusCode -eq 200 -and
      $result.Content -match '<title>\s*Galgame Player\s*</title>' -and
      $result.Content -match 'id="titleScreen"'
  } catch {
    return $false
  }
}

function Get-StartupReadiness {
  $supervisor = Get-JsonHealth -Uri "$supervisorUrl/health"
  $config = Get-JsonHealth -Uri 'http://127.0.0.1:8791/v1/health'
  $bridge = Get-JsonHealth -Uri 'http://127.0.0.1:8795/health'
  $visual = Get-JsonHealth -Uri 'http://127.0.0.1:8798/v1/health'
  $presentation = Get-JsonHealth -Uri 'http://127.0.0.1:8801/v1/health'
  return [pscustomobject]@{
    Game = Test-GamePage
    Supervisor = ($supervisor.ok -eq $true -and $supervisor.mode -eq 'galgame-process-supervisor')
    Config = ($config.ok -eq $true -and $config.runtimeProof.configured -eq $true)
    Bridge = ($bridge.ok -eq $true -and $bridge.ready -eq $true -and $bridge.proofRequired -eq $true -and $bridge.proofConfigured -eq $true -and $bridge.pending -ne $true -and $bridge.stale -ne $true -and $bridge.stopping -ne $true)
    Visual = ($visual.ok -eq $true -and $visual.service -eq 'galgame-visual-asset-service')
    Presentation = ($presentation.serviceReady -eq $true -and $presentation.analyzerConfigured -eq $true)
  }
}

function Test-CoreReadiness {
  param([Parameter(Mandatory = $true)]$Readiness)
  return $Readiness.Game -and $Readiness.Supervisor -and $Readiness.Config -and
    $Readiness.Bridge -and $Readiness.Visual -and $Readiness.Presentation
}

function Invoke-Recovery {
  $headers = @{ Origin = 'http://127.0.0.1:8001'; 'X-Galgame-Recovery' = '1' }
  $body = '{"protocolVersion":"galgame.process-supervisor.v1"}'
  $response = Invoke-LoopbackHttp -Uri "$supervisorUrl/v1/recover" -Method POST -Body $body -Headers $headers -TimeoutMs 35000
  if ($response.StatusCode -ne 200) {
    throw "process supervisor recovery request returned HTTP $($response.StatusCode)"
  }
  $result = $response.Content | ConvertFrom-Json -ErrorAction Stop
  if ($result.protocolVersion -ne 'galgame.process-supervisor.v1') {
    throw 'process supervisor returned an unexpected recovery protocol'
  }
  return $result
}

function Get-ReadinessSummary {
  param([Parameter(Mandatory = $true)]$Readiness)
  return 'game={0}, supervisor={1}, config={2}, bridge={3}, visual={4}, presentation={5}' -f `
    $(if ($Readiness.Game) { 'ready' } else { 'waiting' }),
    $(if ($Readiness.Supervisor) { 'ready' } else { 'waiting' }),
    $(if ($Readiness.Config) { 'ready' } else { 'waiting' }),
    $(if ($Readiness.Bridge) { 'ready' } else { 'waiting' }),
    $(if ($Readiness.Visual) { 'ready' } else { 'waiting' }),
    $(if ($Readiness.Presentation) { 'ready' } else { 'waiting' })
}

try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath $supervisorEntry -PathType Leaf)) {
    throw 'process supervisor entry file is missing'
  }

  $supervisor = Get-JsonHealth -Uri "$supervisorUrl/health"
  if ($supervisor.ok -eq $true -and $supervisor.mode -eq 'galgame-process-supervisor') {
    Write-StartupLog 'process supervisor already running; keeping the existing instance'
  } else {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 8790 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { throw 'port 8790 is occupied by a process that is not the Galgame process supervisor' }
    $existingSupervisor = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      $_.Name -ieq 'node.exe' -and $_.CommandLine -match '(?i)(?:^|[\s"''])' + [regex]::Escape($supervisorEntry) + '(?=$|[\s"''])'
    })
    if ($existingSupervisor.Count -gt 0) { throw 'the supervisor process exists but is not accepting health checks; refusing to start a duplicate' }
    $stdout = Join-Path $logDirectory 'galgame-process-supervisor.out.log'
    $stderr = Join-Path $logDirectory 'galgame-process-supervisor.err.log'
    Start-Process -FilePath $node -ArgumentList ('"' + $supervisorEntry + '"') -WorkingDirectory $repo `
      -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
    Write-StartupLog 'started process supervisor on 8790'
    $supervisorReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      $supervisor = Get-JsonHealth -Uri "$supervisorUrl/health"
      if ($supervisor.ok -eq $true -and $supervisor.mode -eq 'galgame-process-supervisor') { $supervisorReady = $true; break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $supervisorReady) { throw 'process supervisor did not become healthy on port 8790' }
  }

  Write-StartupLog 'requesting idempotent recovery of the complete game service stack'
  $recovery = Invoke-Recovery
  if ($recovery.accepted -ne $true) { throw 'process supervisor did not accept the startup recovery request' }
  foreach ($name in @('sillyTavern', 'configService', 'runtimeBridge', 'visualService')) {
    $service = $recovery.services.$name
    if ($service.status -in @('not-started', 'running-unhealthy')) {
      $code = if ($service.errorCode) { [string]$service.errorCode } else { 'SERVICE_NOT_READY' }
      throw "$name startup was refused: $code"
    }
  }
  $presentationStart = $recovery.diagnostics.presentationAnalysis
  if ($presentationStart.status -in @('not-started', 'running-unhealthy')) {
    $code = if ($presentationStart.errorCode) { [string]$presentationStart.errorCode } else { 'ANALYZER_NOT_READY' }
    throw "presentation analysis startup was refused: $code"
  }

  $deadline = [DateTime]::UtcNow.AddSeconds($startupTimeoutSeconds)
  $readiness = Get-StartupReadiness
  while (-not (Test-CoreReadiness -Readiness $readiness) -and [DateTime]::UtcNow -lt $deadline) {
    $summary = Get-ReadinessSummary -Readiness $readiness
    if ($summary -ne $lastProgress) {
      Write-StartupLog "waiting for service readiness: $summary"
      $lastProgress = $summary
    }
    Start-Sleep -Milliseconds 1000
    $readiness = Get-StartupReadiness
  }
  if (-not (Test-CoreReadiness -Readiness $readiness)) {
    throw "service readiness timeout after $startupTimeoutSeconds seconds: $(Get-ReadinessSummary -Readiness $readiness)"
  }

  $diagnostics = $recovery.diagnostics
  $llm = $diagnostics.llm
  $serviceStatesReady = $recovery.services.sillyTavern.status -eq 'running' -and
    $recovery.services.configService.status -eq 'running' -and
    $recovery.services.runtimeBridge.status -eq 'running' -and
    $recovery.services.visualService.status -eq 'running'
  if ($llm.ok -ne $true -or $diagnostics.presentationAnalysis.status -ne 'ready' -or -not $serviceStatesReady) {
    Write-StartupLog 'confirming the final LLM and presentation-analysis health after services became ready'
    Start-Sleep -Milliseconds 750
    $recovery = Invoke-Recovery
    $diagnostics = $recovery.diagnostics
    $llm = $diagnostics.llm
  }
  if ($llm.ok -ne $true) {
    $errorCode = if ($llm.errorCode) { [string]$llm.errorCode } else { 'LLM_HEALTH_CHECK_UNAVAILABLE' }
    throw "LLM availability check failed: $errorCode"
  }
  if ($diagnostics.presentationAnalysis.status -ne 'ready' -or $diagnostics.presentationAnalysis.analyzerConfigured -ne $true) {
    throw 'presentation analysis service is not ready or has no configured analyzer'
  }
  if ($recovery.services.sillyTavern.status -ne 'running' -or
      $recovery.services.configService.status -ne 'running' -or
      $recovery.services.runtimeBridge.status -ne 'running' -or
      $recovery.services.visualService.status -ne 'running') {
    throw 'process supervisor reported an unhealthy core service after readiness checks'
  }

  Write-StartupLog ("all services ready; LLM provider={0}, model={1}, latencyMs={2}" -f $llm.provider, $llm.model, $llm.latencyMs)
  if ($NoBrowser) {
    Write-StartupLog 'browser opening suppressed by -NoBrowser'
  } else {
    Start-Process -FilePath $gameUrl | Out-Null
    Write-StartupLog "opened $gameUrl after complete health checks"
  }
  exit 0
} catch {
  $message = $_.Exception.Message -replace '[\r\n]+', ' '
  Write-StartupLog "STARTUP FAILED: $message"
  exit 1
}
