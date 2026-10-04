$ErrorActionPreference = 'Stop'
$executable = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'QuietSystem.Telemetry.exe'))
if (-not (Test-Path -LiteralPath $executable)) { throw 'Extract the complete release ZIP first.' }
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Quiet System Telemetry.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Quiet System local wallpaper companion'
$shortcut.Save()
$saved = $shell.CreateShortcut($shortcutPath)
if ($saved.TargetPath -ne $executable -or $saved.WorkingDirectory -ne $PSScriptRoot) {
    throw 'The startup shortcut could not be verified. Run Enable Startup.ps1 again from the permanent installation folder.'
}
Write-Host 'Quiet System will start when you sign in. Keep this folder in its current location.'
