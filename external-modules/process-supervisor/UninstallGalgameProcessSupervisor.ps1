$ErrorActionPreference = 'Stop'
$taskName = 'SillyTavern Galgame Process Supervisor'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host 'Galgame process supervisor logon task removed.'
} else {
    Write-Host 'Galgame process supervisor logon task was not installed.'
}
