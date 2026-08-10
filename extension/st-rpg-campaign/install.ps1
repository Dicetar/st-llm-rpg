param(
    [string]$TargetRoot,
    [switch]$SkipBundleBuild
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$source = $PSScriptRoot
$stRoot = if ($TargetRoot) { [IO.Path]::GetFullPath($TargetRoot) } else { Join-Path $projectRoot '.runtime\SillyTavern' }
$target = Join-Path $stRoot 'public\scripts\extensions\third-party\st-rpg-campaign'

if (-not (Test-Path (Join-Path $stRoot 'package.json'))) {
    throw "The target does not look like the project-local SillyTavern installation: $stRoot"
}

if (-not $SkipBundleBuild) { & (Join-Path $PSScriptRoot 'build-content-bundle.ps1') }
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
Write-Host "Installed RPG Campaign Workspace to $target"
