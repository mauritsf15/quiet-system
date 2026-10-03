$ErrorActionPreference = 'Stop'
$executable = Join-Path $PSScriptRoot 'QuietSystem.Telemetry.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Extract the complete release ZIP first.' }
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Quiet System Telemetry.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Quiet System local wallpaper companion'
$shortcut.Save()
Write-Host 'Quiet System will start when you sign in. Keep this folder in its current location.'
