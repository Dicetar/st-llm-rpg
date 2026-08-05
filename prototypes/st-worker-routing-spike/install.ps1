param(
    [string]$SillyTavernPath = (Join-Path $PSScriptRoot '..\..\.runtime\SillyTavern')
)

$ErrorActionPreference = 'Stop'

$source = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$stRoot = (Resolve-Path -LiteralPath $SillyTavernPath).Path
$target = Join-Path $stRoot 'public\scripts\extensions\third-party\st-rpg-worker-routing-spike'

if (-not (Test-Path -LiteralPath (Join-Path $stRoot 'public\script.js'))) {
    throw "The target does not look like a SillyTavern installation: $stRoot"
}

if (Test-Path -LiteralPath $target) {
    $manifestPath = Join-Path $target 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Refusing to overwrite an unknown directory: $target"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.display_name -ne 'RPG Campaign Worker Routing Spike') {
        throw "Refusing to overwrite a different extension: $($manifest.display_name)"
    }
}

New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem -LiteralPath $target -File | Remove-Item -Force
Copy-Item -LiteralPath (Join-Path $source 'manifest.json') -Destination $target
Copy-Item -LiteralPath (Join-Path $source 'index.js') -Destination $target
Copy-Item -LiteralPath (Join-Path $source 'style.css') -Destination $target
Copy-Item -LiteralPath (Join-Path $source 'README.md') -Destination $target

Write-Output "Installed RPG Campaign Worker Routing Spike to $target"
Write-Output 'Refresh SillyTavern and use the floating W button or Campaign Workspace > Sync Story.'
