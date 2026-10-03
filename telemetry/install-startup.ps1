$ErrorActionPreference = 'Stop'
$executable = Join-Path $PSScriptRoot 'publish\QuietSystem.Telemetry.exe'
if (-not (Test-Path -LiteralPath $executable)) {
    throw 'Publish the telemetry service first by running publish.ps1.'
}

$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Quiet System Telemetry.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = Split-Path -Parent $executable
$shortcut.Description = 'Local hardware telemetry for Quiet System Terminal'
$shortcut.Save()

Write-Host "Startup shortcut created at $shortcutPath"
