$ErrorActionPreference = 'Stop'
$originalProcessEnvironment = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverScript = (Resolve-Path (Join-Path $PSScriptRoot 'server.mjs')).Path
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$envFile = Join-Path $repoRoot '.env.local'
$analyzerVariableNames = @(
    'GALGAME_PRESENTATION_ANALYZER_PROVIDER',
    'GALGAME_PRESENTATION_ANALYZER_BASE_URL',
    'GALGAME_PRESENTATION_ANALYZER_API_KEY',
    'GALGAME_PRESENTATION_ANALYZER_MODEL'
)
foreach ($name in $analyzerVariableNames) { Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue }

if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    Write-Error 'Dedicated semantic-analysis configuration is unavailable.'
    exit 1
}

$providerValues = @{}
$allowedConfigurationNames = @(
    'GALGAME_PRESENTATION_ANALYZER_BASE_URL',
    'GALGAME_PRESENTATION_ANALYZER_API_KEY',
    'GALGAME_PRESENTATION_ANALYZER_MODEL'
)
try {
    foreach ($line in (Get-Content -LiteralPath $envFile -ErrorAction Stop)) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) { continue }
        $separator = $trimmed.IndexOf('=')
        if ($separator -le 0) { continue }
        $name = $trimmed.Substring(0, $separator).Trim()
        if ($name -notin $allowedConfigurationNames) { continue }
        if ($providerValues.ContainsKey($name)) { throw 'duplicate analyzer configuration field' }
        $value = $trimmed.Substring($separator + 1).Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ($value.Contains("`r") -or $value.Contains("`n") -or $value.Contains([char]0)) { throw 'invalid analyzer configuration field' }
        $providerValues[$name] = $value
    }
} catch {
    Write-Error 'Dedicated semantic-analysis configuration could not be parsed.'
    exit 1
}

$provider = 'anthropic'
$baseUrl = [string]$providerValues['GALGAME_PRESENTATION_ANALYZER_BASE_URL']
$apiKey = [string]$providerValues['GALGAME_PRESENTATION_ANALYZER_API_KEY']
$model = [string]$providerValues['GALGAME_PRESENTATION_ANALYZER_MODEL']
try { $providerUri = [Uri]$baseUrl } catch { $providerUri = $null }
$modelIsPinned = $model -ceq 'claude-sonnet-4-6'
if ([string]::IsNullOrWhiteSpace($apiKey) -or -not $modelIsPinned -or
    -not $providerUri -or $providerUri.Scheme -ne 'https' -or
    -not [string]::IsNullOrEmpty($providerUri.UserInfo) -or
    -not [string]::IsNullOrEmpty($providerUri.Query) -or
    -not [string]::IsNullOrEmpty($providerUri.Fragment) -or
    $providerUri.Host -ine 'aiself.vip') {
    Write-Error 'The pinned Claude semantic-analysis configuration is invalid or incomplete.'
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
$env:GALGAME_PRESENTATION_PLAYER_ORIGINS = 'http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8001,http://localhost:8001'
$runtimeEnvironmentNames = @(
    'PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
    'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'COMSPEC', 'PATHEXT', 'SystemDrive'
)
$childEnvironmentNameAllowlist = @($runtimeEnvironmentNames + $analyzerVariableNames + 'GALGAME_PRESENTATION_PLAYER_ORIGINS')
$inheritedVariableNames = @([Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process).Keys)
foreach ($name in $inheritedVariableNames) {
    if ($name -notin $childEnvironmentNameAllowlist) {
        Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue
    }
}
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
    $currentVariableNames = @([Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process).Keys)
    foreach ($name in $currentVariableNames) {
        if (-not $originalProcessEnvironment.Contains([string]$name)) {
            [Environment]::SetEnvironmentVariable([string]$name, $null, [EnvironmentVariableTarget]::Process)
        }
    }
    foreach ($name in $originalProcessEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable([string]$name, [string]$originalProcessEnvironment[$name], [EnvironmentVariableTarget]::Process)
    }
    $apiKey = $null
    if ($providerValues.ContainsKey('GALGAME_PRESENTATION_ANALYZER_API_KEY')) {
        $providerValues['GALGAME_PRESENTATION_ANALYZER_API_KEY'] = $null
    }
    $providerValues.Clear()
    $originalProcessEnvironment.Clear()
}

$healthUrl = 'http://127.0.0.1:8801/v1/health'
$headers = @{ Origin = 'http://127.0.0.1:8000' }
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $health = Invoke-RestMethod -Method Get -Uri $healthUrl -Headers $headers -TimeoutSec 1
        $expectedAnnotationScope = "$model`:presentation-annotator.v26"
        $expectedSceneScope = "$model`:scene-continuity-analyzer.v6:galgame.scene-continuity-analysis.v1"
        if ($health.serviceReady -eq $true -and $health.analyzerConfigured -eq $true -and
            $health.analyzerScope -ceq $expectedAnnotationScope -and $health.sceneAnalyzerScope -ceq $expectedSceneScope) {
            Write-Host 'Presentation analysis service is ready with the pinned Claude model and scopes.'
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 300
}

Write-Error 'Presentation analysis service did not become ready; credentials were not logged.'
exit 1
