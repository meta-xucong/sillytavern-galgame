$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverScript = (Resolve-Path (Join-Path $PSScriptRoot 'server.mjs')).Path
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$envFile = $env:GALGAME_PRESENTATION_ENV_FILE
if ([string]::IsNullOrWhiteSpace($envFile)) {
    $envFile = Join-Path $repoRoot '.env.local'
}
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    Write-Error 'Visual analysis provider configuration is unavailable.'
    exit 1
}

$providerValues = @{}
foreach ($line in (Get-Content -LiteralPath $envFile -ErrorAction Stop)) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) { continue }
    $separator = $trimmed.IndexOf('=')
    if ($separator -le 0) { continue }
    $name = $trimmed.Substring(0, $separator).Trim()
    if ($name -notin @('REFERENCE_VISION_BASE_URL', 'REFERENCE_VISION_API_KEY', 'REFERENCE_VISION_MODEL')) { continue }
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) { $providerValues[$name] = $value }
}

$provider = 'openai-compatible'
$baseUrl = $providerValues['REFERENCE_VISION_BASE_URL']
$apiKey = $providerValues['REFERENCE_VISION_API_KEY']
$model = $providerValues['REFERENCE_VISION_MODEL']
try { $providerUri = [Uri]$baseUrl } catch { $providerUri = $null }
if ($provider -ne 'openai-compatible' -or
    [string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($model) -or
    -not $providerUri -or $providerUri.Scheme -ne 'https' -or
    -not [string]::IsNullOrEmpty($providerUri.UserInfo) -or
    -not [string]::IsNullOrEmpty($providerUri.Query) -or
    -not [string]::IsNullOrEmpty($providerUri.Fragment)) {
    Write-Error 'The visual provider configuration is invalid or incomplete.'
    exit 1
}

$serverPattern = '(?i)(?:^|[\s"])' + [regex]::Escape($serverScript.Replace('/', '\')) + '(?=$|[\s"])'
Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object { $_.Name -like 'node*' -and $_.CommandLine -match $serverPattern } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }

$env:GALGAME_PRESENTATION_ANALYZER_PROVIDER = $provider
$env:GALGAME_PRESENTATION_ANALYZER_BASE_URL = $baseUrl
$env:GALGAME_PRESENTATION_ANALYZER_API_KEY = $apiKey
$env:GALGAME_PRESENTATION_ANALYZER_MODEL = $model
$env:GALGAME_PRESENTATION_ANALYZER_ALLOWED_HOSTS = $providerUri.Host
$env:GALGAME_PRESENTATION_PLAYER_ORIGINS = 'http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8001,http://localhost:8001'
$logDirectory = Join-Path $repoRoot '.codex-longrun'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$stdoutPath = Join-Path $logDirectory 'presentation-analysis-service.out.log'
$stderrPath = Join-Path $logDirectory 'presentation-analysis-service.err.log'
try {
    $process = Start-Process -FilePath $nodeCommand -ArgumentList ('"' + $serverScript + '"') `
        -WorkingDirectory $repoRoot -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    if (-not $process) { throw 'service process did not start' }
} finally {
    $env:GALGAME_PRESENTATION_ANALYZER_API_KEY = ''
    $env:GALGAME_PRESENTATION_ANALYZER_BASE_URL = ''
    $apiKey = $null
    $providerValues.Clear()
}

$healthUrl = 'http://127.0.0.1:8801/v1/health'
$headers = @{ Origin = 'http://127.0.0.1:8000' }
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $health = Invoke-RestMethod -Method Get -Uri $healthUrl -Headers $headers -TimeoutSec 1
        if ($health.serviceReady -eq $true -and $health.analyzerConfigured -eq $true) {
            Write-Host 'Presentation analysis service is ready.'
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 300
}

Write-Error 'Presentation analysis service did not become ready; credentials were not logged.'
exit 1
