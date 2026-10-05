[CmdletBinding()]
param(
    [switch]$OpenAdmin
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$serverScript = Join-Path $repoRoot 'external-modules\visual-asset-service\server.mjs'
$dataDir = Join-Path $repoRoot 'external-modules\visual-asset-service\data'
$resolvedServerScript = $null
$nodeCommand = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$serviceHost = '127.0.0.1'
$servicePort = '8798'
$healthUrl = "http://$serviceHost`:$servicePort/v1/health"
$adminUrl = 'http://127.0.0.1:8798/game-admin/'
$logPath = Join-Path $dataDir 'controlled-analyzer-test.log'
$tokenVariable = 'GALGAME_VISUAL_ANALYZER_TOKEN'
$runtimeTokenVariable = 'GALGAME_VISUAL_RUNTIME_TOKEN'
$providerEnvFile = $env:GALGAME_VISUAL_PROVIDER_ENV_FILE
if ([string]::IsNullOrWhiteSpace($providerEnvFile)) {
    $providerEnvFile = Join-Path $repoRoot '.env.local'
}

if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    Write-Error 'visual-asset-service server.mjs was not found.'
    exit 1
}
if ([string]::IsNullOrWhiteSpace($nodeCommand)) {
    Write-Error 'node.exe was not found.'
    exit 1
}
$resolvedServerScript = (Resolve-Path -LiteralPath $serverScript).Path
if (-not (Test-Path -LiteralPath $dataDir -PathType Container)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

function Write-ControlledLauncherLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $line = '{0} {1}' -f (Get-Date).ToString('o'), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
}

function Get-DotEnvLastNonEmptyValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    $resolvedValue = $null
    foreach ($line in (Get-Content -LiteralPath $Path -ErrorAction Stop)) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) {
            continue
        }
        $separator = $trimmed.IndexOf('=')
        if ($separator -le 0) {
            continue
        }
        $candidateKey = $trimmed.Substring(0, $separator).Trim()
        if ($candidateKey -ne $Key) {
            continue
        }
        $candidateValue = $trimmed.Substring($separator + 1).Trim()
        if ($candidateValue.Length -ge 2) {
            $singleQuoted = $candidateValue.StartsWith("'") -and $candidateValue.EndsWith("'")
            $doubleQuoted = $candidateValue.StartsWith('"') -and $candidateValue.EndsWith('"')
            if ($singleQuoted -or $doubleQuoted) {
                $candidateValue = $candidateValue.Substring(1, $candidateValue.Length - 2)
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($candidateValue)) {
            $resolvedValue = $candidateValue
        }
    }
    return $resolvedValue
}

function Test-ProviderBaseUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    try {
        $uri = [Uri]$Value
        return $uri.IsAbsoluteUri -and $uri.Scheme -eq 'https' -and
            [string]::IsNullOrEmpty($uri.UserInfo) -and
            [string]::IsNullOrEmpty($uri.Query) -and
            [string]::IsNullOrEmpty($uri.Fragment)
    } catch {
        return $false
    }
}

$secureToken = $null
$tokenBstr = [IntPtr]::Zero
$plainToken = $null
$process = $null
$previousChildEnvironment = @{}
$childEnvironment = @{}
$leaveChildRunning = $false

try {
    # Never keep an inherited process copy in this wrapper; the child receives only the configured or prompted value.
    Remove-Item -LiteralPath "Env:$tokenVariable" -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "Env:$runtimeTokenVariable" -ErrorAction SilentlyContinue
    $configuredProviderBaseUrl = $null
    $configuredProviderModel = $null
    $configuredProviderToken = $null
    $providerConfigLoaded = $false
    try {
        $configuredProviderBaseUrl = Get-DotEnvLastNonEmptyValue -Path $providerEnvFile -Key 'REFERENCE_VISION_BASE_URL'
        $configuredProviderModel = Get-DotEnvLastNonEmptyValue -Path $providerEnvFile -Key 'REFERENCE_VISION_MODEL'
        $configuredProviderToken = Get-DotEnvLastNonEmptyValue -Path $providerEnvFile -Key 'REFERENCE_VISION_API_KEY'
        $providerConfigLoaded = (-not [string]::IsNullOrWhiteSpace($configuredProviderBaseUrl)) -and
            (-not [string]::IsNullOrWhiteSpace($configuredProviderModel)) -and
            (-not [string]::IsNullOrWhiteSpace($configuredProviderToken)) -and
            (Test-ProviderBaseUrl -Value $configuredProviderBaseUrl)
    } catch {
        $providerConfigLoaded = $false
    }

    if ($providerConfigLoaded) {
        $plainToken = $configuredProviderToken
        $providerUri = [Uri]$configuredProviderBaseUrl
        Write-ControlledLauncherLog -Message ('provider_source=dotenv host={0} model={1} analyzer_style=openai_chat_completions_vision runtime_style=openai_chat_completions_text' -f $providerUri.Host, $configuredProviderModel)
    } else {
        Write-ControlledLauncherLog -Message 'provider_source=hidden_prompt fallback=legacy_direct'
        $secureToken = Read-Host -Prompt '视觉服务密钥（隐藏输入）' -AsSecureString
        $tokenBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
        $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenBstr)
        if ([string]::IsNullOrWhiteSpace($plainToken)) {
            Write-Error 'No analyzer token was entered; visual analyzer test service was not started.'
            exit 1
        }
    }

    # Only replace the exact entry process from this checkout. A similarly
    # named server in another checkout must remain untouched.
    $serverCommandPattern = '(?i)(?:^|[\s"])' + [regex]::Escape($resolvedServerScript.Replace('/', '\')) + '(?=$|[\s"])'
    Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object { $_.Name -ieq 'node.exe' -and $_.CommandLine -match $serverCommandPattern } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }

    $childEnvironment = @{}
    $childEnvironment['GALGAME_VISUAL_ASSET_HOST'] = $serviceHost
    $childEnvironment['GALGAME_VISUAL_ASSET_PORT'] = $servicePort
    $childEnvironment['GALGAME_VISUAL_ASSET_DATA_DIR'] = $dataDir
    $childEnvironment['GALGAME_VISUAL_ASSET_ADMIN_TOKEN'] = ''
    $childEnvironment['GALGAME_VISUAL_ASSET_ADMIN_ORIGINS'] = ''
    $fallbackBaseUrl = 'https://aiself.vip/v1'
    $fallbackModel = 'doubao-seed-2-0-lite-260428'
    $analyzerBaseUrl = if ($providerConfigLoaded) { $configuredProviderBaseUrl } else { $fallbackBaseUrl }
    $analyzerModel = if ($providerConfigLoaded) { $configuredProviderModel } else { $fallbackModel }
    $requestStyle = if ($providerConfigLoaded) { 'openai_chat_completions_vision' } else { 'anthropic_messages_vision' }
    $runtimeRequestStyle = if ($providerConfigLoaded) { 'openai_chat_completions_text' } else { 'anthropic_messages_text' }
    $childEnvironment['GALGAME_VISUAL_ANALYZER_BASE_URL'] = $analyzerBaseUrl
    $childEnvironment['GALGAME_VISUAL_ANALYZER_MODEL'] = $analyzerModel
    $childEnvironment['GALGAME_VISUAL_ANALYZER_REQUEST_STYLE'] = $requestStyle
    # Keep this controlled run isolated from earlier unavailable/timeout
    # cache records created by the ordinary launcher or short probe runs.
    $childEnvironment['GALGAME_VISUAL_ANALYZER_CACHE_SCOPE'] = 'controlled-analyzer-test-doubao-v1'
    $childEnvironment['GALGAME_VISUAL_ANALYZER_TIMEOUT_MS'] = '30000'
    $childEnvironment[$tokenVariable] = $plainToken
    $childEnvironment['GALGAME_VISUAL_RUNTIME_BASE_URL'] = $analyzerBaseUrl
    $childEnvironment['GALGAME_VISUAL_RUNTIME_MODEL'] = $analyzerModel
    $childEnvironment['GALGAME_VISUAL_RUNTIME_REQUEST_STYLE'] = $runtimeRequestStyle
    # Doubao runtime responses are slower than the default local test budget; keep
    # the timeout bounded while allowing the configured provider to complete.
    $childEnvironment['GALGAME_VISUAL_RUNTIME_TIMEOUT_MS'] = '15000'
    $childEnvironment['GALGAME_VISUAL_RUNTIME_RETRY_SCHEMA_INVALID'] = 'true'
    $childEnvironment['GALGAME_VISUAL_RUNTIME_CACHE_SCOPE'] = 'controlled-runtime-live-v1'
    $childEnvironment[$runtimeTokenVariable] = $plainToken

    $previousChildEnvironment = @{}
    foreach ($name in $childEnvironment.Keys) {
        $previousChildEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, [string]$childEnvironment[$name], 'Process')
    }
    $serviceLogDirectory = Join-Path $repoRoot '.codex-longrun'
    New-Item -ItemType Directory -Path $serviceLogDirectory -Force | Out-Null
    $stdoutLog = Join-Path $serviceLogDirectory 'visual-analyzer-test.out.log'
    $stderrLog = Join-Path $serviceLogDirectory 'visual-analyzer-test.err.log'
    $process = Start-Process -FilePath $nodeCommand -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $repoRoot `
        -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
    Write-ControlledLauncherLog -Message ('service_started pid={0} stdout={1} stderr={2}' -f $process.Id, $stdoutLog, $stderrLog)

    $healthy = $false
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri $healthUrl
            $body = $response.Content | ConvertFrom-Json
            if ($response.StatusCode -eq 200 -and $body.ok -eq $true) {
                $healthy = $true
                break
            }
        } catch {
            # The service may need a short moment to bind its loopback port.
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $healthy) {
        $exitCode = if ($process.HasExited) { $process.ExitCode } else { 'running' }
        Write-ControlledLauncherLog -Message ('health_failed pid={0} process={1}' -f $process.Id, $exitCode)
        Write-Error ('visual-asset-service did not become healthy; inspect {0}, {1}, and {2}.' -f $logPath, $stdoutLog, $stderrLog)
        exit 1
    }

    $leaveChildRunning = $true
    Write-ControlledLauncherLog -Message ('health_ok pid={0} url={1}' -f $process.Id, $healthUrl)
    Write-Host "visual analyzer test service is ready at $adminUrl"
    if ($OpenAdmin) {
        try {
            Start-Process $adminUrl | Out-Null
        } catch {
            Write-Warning 'The service is healthy, but the browser could not be opened automatically.'
        }
    }
} catch {
    Write-ControlledLauncherLog -Message 'launcher_failed diagnostics=non-sensitive-launcher-status-only'
    Write-Error 'The controlled analyzer test service could not be started.'
    exit 1
} finally {
    if (-not $leaveChildRunning -and $process -and -not $process.HasExited) {
        $process.Kill()
    }
    if ($previousChildEnvironment) {
        foreach ($name in $previousChildEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $previousChildEnvironment[$name], 'Process')
        }
    }
    # Clear managed references as well as the wrapper environment.
    $childEnvironment.Remove($tokenVariable)
    $childEnvironment.Remove($runtimeTokenVariable)
    $plainToken = $null
    $configuredProviderToken = $null
    if ($tokenBstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenBstr)
        $tokenBstr = [IntPtr]::Zero
    }
    if ($secureToken) {
        $secureToken.Dispose()
    }
    Remove-Item -LiteralPath "Env:$tokenVariable" -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "Env:$runtimeTokenVariable" -ErrorAction SilentlyContinue
}
