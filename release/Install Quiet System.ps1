param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$wallpaperUrl = 'http://127.0.0.1:9876/wallpaper/'
$executable = Join-Path $PSScriptRoot 'QuietSystem.Telemetry.exe'

function Write-Step([int]$Number, [string]$Title) {
    Write-Host "`n  [$Number/4] $Title" -ForegroundColor Cyan
    Write-Host '  --------------------------------------------------' -ForegroundColor DarkGray
}

function Confirm-Step([string]$Question, [bool]$Default = $true) {
    $hint = if ($Default) { 'Y/n' } else { 'y/N' }
    while ($true) {
        $answer = (Read-Host "  $Question [$hint]").Trim().ToLowerInvariant()
        if ($answer -eq '') { return $Default }
        if ($answer -in @('y', 'yes')) { return $true }
        if ($answer -in @('n', 'no')) { return $false }
        Write-Host '  Please enter Y or N.' -ForegroundColor Yellow
    }
}

try {
    if (-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Version.Build -lt 19041) {
        throw 'This release requires 64-bit Windows 10 version 2004 or newer, or Windows 11.'
    }
    foreach ($required in @('QuietSystem.Telemetry.exe', 'wallpaper/index.html', 'Enable Startup.ps1', 'Disable Startup.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $required))) {
            throw "Missing $required. Extract the complete release ZIP before running setup."
        }
    }
    if ($CheckOnly) { Write-Host 'Release prerequisites and required files verified.'; exit 0 }
    Clear-Host
    Write-Host ''
    Write-Host '  +--------------------------------------------------+' -ForegroundColor Cyan
    Write-Host '  |                  QUIET SYSTEM                    |' -ForegroundColor Cyan
    Write-Host '  |           Your desktop, a little calmer.         |' -ForegroundColor Cyan
    Write-Host '  +--------------------------------------------------+' -ForegroundColor Cyan
    Write-Host "`n  Setup takes about a minute. No administrator access needed."
    Write-Host '  The .NET runtime is already included.' -ForegroundColor DarkGray
    Write-Host '  Keep this extracted folder somewhere permanent.' -ForegroundColor DarkGray
    Write-Host '  Commands you enter in the wallpaper run on your own PC.' -ForegroundColor DarkGray

    Write-Step 1 'Start the companion'
    if (Confirm-Step 'Start Quiet System now?') {
        $running = @(Get-Process -Name 'QuietSystem.Telemetry' -ErrorAction SilentlyContinue)
        if ($running | Where-Object { $_.Path -ne $executable }) {
            throw 'Another Quiet System installation is running. Stop it in Task Manager, then run this setup again.'
        }
        if ($running.Count -eq 0) { Start-Process -FilePath $executable -WorkingDirectory $PSScriptRoot -WindowStyle Hidden }
        $ready = $false
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            try {
                $response = Invoke-WebRequest -Uri $wallpaperUrl -UseBasicParsing -TimeoutSec 2
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            } catch { Start-Sleep -Milliseconds 300 }
        }
        if (-not $ready) { throw 'The companion did not become ready. See README.md for troubleshooting and the local crash-log location.' }
        Write-Host '  Companion ready.' -ForegroundColor Green
    } else { Write-Host '  Skipped. Use Start Quiet System.cmd whenever you are ready.' -ForegroundColor DarkGray }

    Write-Step 2 'Choose startup behavior'
    Write-Host '  Recommended: the wallpaper needs the companion after every restart.' -ForegroundColor DarkGray
    if (Confirm-Step 'Start automatically when you sign in to Windows?') {
        & (Join-Path $PSScriptRoot 'Enable Startup.ps1')
    } elseif (Confirm-Step 'Remove this installation from automatic startup?' $false) {
        & (Join-Path $PSScriptRoot 'Disable Startup.ps1')
    } else { Write-Host '  Startup preferences kept. You can change them later.' -ForegroundColor DarkGray }

    Write-Step 3 'Connect Wallpaper Engine'
    Write-Host '  In Wallpaper Engine: Open Wallpaper > Open from URL'
    Write-Host "  $wallpaperUrl" -ForegroundColor Cyan
    if (Confirm-Step 'Copy this URL to your clipboard?') {
        try { Set-Clipboard -Value $wallpaperUrl; Write-Host '  Copied. Paste it into Open from URL.' -ForegroundColor Green }
        catch { Write-Host '  Clipboard unavailable. Copy the URL shown above.' -ForegroundColor Yellow }
    }
    if (Confirm-Step 'Launch Wallpaper Engine through Steam?') {
        try { Start-Process 'steam://rungameid/431960'; Write-Host '  Paste the URL in Wallpaper Engine, then select your monitor.' }
        catch { Write-Host '  Open Steam and launch Wallpaper Engine manually.' -ForegroundColor Yellow }
    }

    Write-Step 4 'Make it yours'
    Write-Host '  Click settings in the wallpaper to choose your city and colors.'
    Write-Host '  Use my location is optional. No location is selected by default.'
    Write-Host '  Hide desktop icons before typing commands in the wallpaper.'
    if (Confirm-Step 'Open the dashboard in your browser too?' $false) {
        Start-Process $wallpaperUrl
        Write-Host '  Browser preferences may be separate from Wallpaper Engine preferences.' -ForegroundColor DarkGray
    }
    Write-Host "`n  Setup complete. Enjoy your desktop." -ForegroundColor Green
    Write-Host '  To stop or uninstall later, see README.md.' -ForegroundColor DarkGray
    Read-Host "`n  Press Enter to close" | Out-Null
} catch {
    Write-Host "`n  Setup could not finish: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '  Nothing needs to be re-downloaded. Fix the issue and run setup again.' -ForegroundColor DarkGray
    exit 1
}
