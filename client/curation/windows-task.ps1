# Windows: runs the curation every hour and at logon (weekly.py decides what is due). Run once, in PowerShell, from the
# repository's folder:   powershell -ExecutionPolicy Bypass -File client\curation\windows-task.ps1
# Needs Python 3 and git on the PATH, git able to push to your fork, config.properties in the repository's folder and
# client\curation\weekly.env with SOFA_LETTERBOXD=<your Letterboxd export folder> and SOFA_PUBLISH=<Pages branch>.
# Remove:  Unregister-ScheduledTask -TaskName SofaCuradoria -Confirm:$false
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$python = (Get-Command python -ErrorAction Stop).Source
$log = Join-Path $repo "client\curation\out\weekly.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
$run = "/c `"`"$python`" `"$repo\client\curation\weekly.py`" >> `"$log`" 2>&1`""
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $run -WorkingDirectory $repo
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)
Register-ScheduledTask -TaskName "SofaCuradoria" -Action $action -Trigger $hourly, $logon -Settings $settings -Force | Out-Null
Write-Host "Scheduled: SofaCuradoria, every hour and at logon. Log: $log"
Write-Host "Check now:  python client\curation\weekly.py --status"
