param(
    [Parameter(Mandatory = $true)][ValidateSet('configService', 'runtimeBridge', 'visualService')][string]$Service,
    [switch]$ReplaceExisting
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$restartForLlmFailure = $Service -eq 'runtimeBridge' -and $env:GALGAME_BRIDGE_RESTART_IF_LLM_UNHEALTHY -ceq '1'
# The recovery signal authorizes only this one bounded bridge replacement. Do
# not pass it through to the replacement bridge process or future launches.
Remove-Item Env:\GALGAME_BRIDGE_RESTART_IF_LLM_UNHEALTHY -ErrorAction SilentlyContinue
$definitions = @{
    configService = @{ Entry = 'external-modules\game-config-service\server.mjs'; Log = 'galgame-config-service' }
    runtimeBridge = @{ Entry = 'external-modules\original-runtime-bridge\server.mjs'; Log = 'original-runtime-bridge' }
    visualService = @{ Entry = 'external-modules\visual-asset-service\server.mjs'; Log = 'visual-asset-service' }
}
$entry = [IO.Path]::GetFullPath((Join-Path $repoRoot $definitions[$Service].Entry))
$entryPattern = '(?i)(?:^|[\s"])' + [regex]::Escape($entry.Replace('/', '\')) + '(?=$|[\s"])'
$existing = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -ieq 'node.exe' -and $_.CommandLine -match $entryPattern })
if ($existing.Count -gt 0) {
    $replaceBridge = $false
    if ($Service -eq 'runtimeBridge' -and $ReplaceExisting) {
        try {
            $health = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:8795/health' -TimeoutSec 2
            $replaceBridge = (($health.pending -eq $true) -and ($health.stale -eq $true) -and ($health.stopping -ne $true))
            if (($health.stopping -eq $true) -and ($health.pending -eq $false) -and ($health.stale -eq $false)) {
                $replaceBridge = $true
            }
            if (($health.recoveryRequired -eq $true) -and ($health.pending -ne $true)) {
                $replaceBridge = $true
            }
            if ($restartForLlmFailure -and $health.shutdownGate -eq $true
                -and $health.pending -ne $true -and $health.stale -ne $true -and $health.stopping -ne $true
                -and $health.recoveryRequired -ne $true) {
                $replaceBridge = $true
            }
        }
        catch { $replaceBridge = $false }
    }
    if (-not $replaceBridge) { exit 0 }
    $existing | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
    if ($Service -eq 'runtimeBridge') {
        $profile = [IO.Path]::GetFullPath((Join-Path $repoRoot '.codex-longrun\original-runtime-bridge-chrome-claude'))
        $profilePattern = '(?i)(?:^|\s)--user-data-dir(?:=|\s+)"?' + [regex]::Escape($profile.Replace('/', '\')) + '"?(?=$|\s)'
        Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object { $_.Name -ieq 'chrome.exe' -and $_.CommandLine -match $profilePattern } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
    }
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeArguments = @()
if ($Service -eq 'runtimeBridge') {
    # Node 24 fetch does not use HTTP_PROXY/HTTPS_PROXY by default. The bridge
    # must honor the current user's configured proxy for Anthropic requests.
    $nodeArguments += '--use-env-proxy'
}
$nodeArguments += '"' + $entry + '"'
$logDirectory = Join-Path $repoRoot '.codex-longrun'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$out = Join-Path $logDirectory ($definitions[$Service].Log + '.out.log')
$err = Join-Path $logDirectory ($definitions[$Service].Log + '.err.log')
Start-Process -FilePath $node -ArgumentList ($nodeArguments -join ' ') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
