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
if ($LASTEXITCODE -ne 0) {
    throw "Dependency restore failed with exit code $LASTEXITCODE. Publishing stopped."
}
& $dotnetPath publish $projectPath -c Release -r win-x64 --self-contained false --no-restore -o $outputPath
if ($LASTEXITCODE -ne 0) {
    throw "Publishing failed with exit code $LASTEXITCODE. Wallpaper files were not copied."
}
$wallpaperOutput = Join-Path $outputPath 'wallpaper'
New-Item -ItemType Directory -Path $wallpaperOutput -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot '..\wallpaper\*') -Destination $wallpaperOutput -Recurse -Force
Write-Host "Published to $outputPath"
