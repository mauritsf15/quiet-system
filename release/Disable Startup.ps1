$ErrorActionPreference = 'Stop'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Quiet System Telemetry.lnk'
if (Test-Path -LiteralPath $shortcutPath) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ($shortcut.TargetPath -eq (Join-Path $PSScriptRoot 'QuietSystem.Telemetry.exe')) {
        Remove-Item -LiteralPath $shortcutPath
        Write-Host 'Quiet System startup disabled.'
    } else { throw 'The startup shortcut belongs to another installation. Remove it manually from the Startup folder.' }
} else { Write-Host 'Quiet System startup is already disabled.' }
