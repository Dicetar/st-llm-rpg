param(
    [string]$SillyTavernPath = (Join-Path $PSScriptRoot '..\..\.runtime\SillyTavern')
)

$ErrorActionPreference = 'Stop'

$source = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$stRoot = (Resolve-Path -LiteralPath $SillyTavernPath).Path
$extensionsRoot = Join-Path $stRoot 'public\scripts\extensions\third-party'
$target = Join-Path $extensionsRoot 'st-rpg-campaign-durability-spike'

if (-not (Test-Path -LiteralPath (Join-Path $stRoot 'public\script.js'))) {
    throw "The target does not look like a SillyTavern installation: $stRoot"
}

if (Test-Path -LiteralPath $target) {
    $manifestPath = Join-Path $target 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Refusing to overwrite an unknown directory: $target"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.display_name -ne 'RPG Campaign Durability Spike') {
        throw "Refusing to overwrite a different extension: $($manifest.display_name)"
    }
}

New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem -LiteralPath $target -File | Remove-Item -Force
Copy-Item -LiteralPath (Join-Path $source 'manifest.json') -Destination $target
Copy-Item -LiteralPath (Join-Path $source 'campaign-core.js') -Destination $target
Copy-Item -LiteralPath (Join-Path $source 'index.js') -Destination $target
Copy-Item -LiteralPath (Join-Path $source 'style.css') -Destination $target

Write-Output "Installed RPG Campaign Durability Spike to $target"
Write-Output 'Restart SillyTavern, open a character chat, and use the floating D button.'
