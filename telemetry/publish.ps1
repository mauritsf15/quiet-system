$ErrorActionPreference = 'Stop'
$projectPath = Join-Path $PSScriptRoot 'QuietSystem.Telemetry.csproj'
$outputPath = Join-Path $PSScriptRoot 'publish'
$nugetConfig = Join-Path $PSScriptRoot 'NuGet.Config'
$dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
$dotnetPath = if ($dotnetCommand) { $dotnetCommand.Source } else { 'C:\Program Files\dotnet\dotnet.exe' }

if (-not (Test-Path -LiteralPath $dotnetPath)) {
    throw 'The .NET 8 SDK was not found. Install it from https://dotnet.microsoft.com/download/dotnet/8.0.'
}

& $dotnetPath restore $projectPath -r win-x64 --configfile $nugetConfig
& $dotnetPath publish $projectPath -c Release -r win-x64 --self-contained false --no-restore -o $outputPath
$wallpaperOutput = Join-Path $outputPath 'wallpaper'
New-Item -ItemType Directory -Path $wallpaperOutput -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot '..\wallpaper\*') -Destination $wallpaperOutput -Recurse -Force
Write-Host "Published to $outputPath"
