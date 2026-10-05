$ErrorActionPreference = 'Stop'
$checks = @(
    @{ Name = 'game-config-service'; Uri = 'http://127.0.0.1:8791/v1/health'; Kind = 'config' },
    @{ Name = 'original-runtime-bridge'; Uri = 'http://127.0.0.1:8795/health'; Kind = 'bridge' },
    @{ Name = 'SillyTavern'; Uri = 'http://127.0.0.1:8001/'; Kind = 'http' }
)
$failures = [System.Collections.Generic.List[string]]::new()

foreach ($check in $checks) {
    $ok = $false
    $detail = 'unreachable'
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $check.Uri
            $ok = $response.StatusCode -eq 200
            if ($ok -and $check.Kind -ne 'http') {
                $body = $response.Content | ConvertFrom-Json
                if ($check.Kind -eq 'config') {
                    $ok = $body.ok -eq $true -and $body.runtimeProof.configured -eq $true
                    $detail = if ($ok) { 'healthy; runtime proof configured' } else { 'runtime proof is not configured' }
                } elseif ($check.Kind -eq 'bridge') {
                    $ok = $body.ok -eq $true -and $body.ready -eq $true -and $body.proofRequired -eq $true -and $body.proofConfigured -eq $true
                    $detail = if ($ok) { 'healthy; runtime proof verifier configured' } else { 'bridge or runtime proof verifier is not ready' }
                }
            } elseif ($ok) {
                $detail = 'reachable'
            }
            if ($ok) { break }
        } catch {
            $ok = $false
        }
        Start-Sleep -Milliseconds 300
    }
    if ($ok) {
        Write-Host ($check.Name + ': ' + $detail)
    } else {
        Write-Warning ($check.Name + ': ' + $detail + '; story progression remains unavailable')
        $failures.Add($check.Name)
    }
}

if ($failures.Count -gt 0) {
    exit 1
}
exit 0
