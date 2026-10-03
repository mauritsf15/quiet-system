$ErrorActionPreference = 'Stop'
$expectedPath = Join-Path $PSScriptRoot 'QuietSystem.Telemetry.exe'
Get-Process -Name 'QuietSystem.Telemetry' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $expectedPath } |
    Stop-Process
Write-Host 'Quiet System stopped. Closing it also closes active terminal sessions.'
