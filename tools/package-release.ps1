param([string]$Version = '0.1.0', [string]$OutputRoot = (Join-Path $PSScriptRoot '../artifacts/releases'))
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$') { throw 'Use a semantic version, for example 0.1.0.' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) "Quiet-System-$Version-win-x64"
if (Test-Path -LiteralPath $releaseRoot) { throw "Output already exists: $releaseRoot. Use a new output root for a clean build." }
& (Join-Path $repoRoot 'telemetry/publish.ps1') -OutputDirectory $releaseRoot
Copy-Item -Path (Join-Path $repoRoot 'release/*') -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $repoRoot 'README.md') -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $repoRoot 'THIRD-PARTY-NOTICES.md') -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $repoRoot 'licenses') -Destination $releaseRoot -Recurse
$archivePath = "$releaseRoot.zip"
Compress-Archive -LiteralPath $releaseRoot -DestinationPath $archivePath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$archivePath.sha256", "$hash  $([IO.Path]::GetFileName($archivePath))`n")
Write-Host "Release ZIP: $archivePath"
Write-Host "SHA256: $hash"
