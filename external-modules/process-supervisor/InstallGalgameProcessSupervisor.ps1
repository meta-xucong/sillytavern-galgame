$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$entry = Join-Path $PSScriptRoot 'server.mjs'
$hiddenLauncher = Join-Path $PSScriptRoot 'run-hidden-wait.vbs'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$taskName = 'SillyTavern Galgame Process Supervisor'
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$actionArguments = '//B //NoLogo "{0}" "{1}" "{2}"' -f $hiddenLauncher, $node, $entry
$action = New-ScheduledTaskAction -Execute $wscript -Argument $actionArguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Loopback-only recovery for the Galgame player local services.'
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host 'Galgame process supervisor installed for the current Windows user and started.'
