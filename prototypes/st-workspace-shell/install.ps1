param(
    [string]$SillyTavernRoot = (Join-Path $PSScriptRoot '..\..\.runtime\SillyTavern')
)

$prototypeRoot = $PSScriptRoot
$extensionParent = Join-Path $SillyTavernRoot 'public\scripts\extensions\third-party'
$target = Join-Path $extensionParent 'st-rpg-workspace-spike'
$sillyTavernPackage = Join-Path $SillyTavernRoot 'package.json'

if (-not (Test-Path -LiteralPath $sillyTavernPackage -PathType Leaf)) {
    throw "SillyTavern package.json not found at: $sillyTavernPackage"
}

if (-not (Test-Path -LiteralPath $extensionParent -PathType Container)) {
    throw "SillyTavern third-party extension directory not found at: $extensionParent"
}

$targetManifest = Join-Path $target 'manifest.json'
if (Test-Path -LiteralPath $targetManifest -PathType Leaf) {
    $installedManifest = Get-Content -Raw -LiteralPath $targetManifest | ConvertFrom-Json
    if ($installedManifest.display_name -ne 'RPG Workspace C — Boundary Spike') {
        throw "Refusing to overwrite a different extension at: $target"
    }
}

New-Item -ItemType Directory -Path $target -Force | Out-Null

foreach ($filename in @('manifest.json', 'index.js', 'style.css', 'README.md')) {
    Copy-Item -LiteralPath (Join-Path $prototypeRoot $filename) -Destination (Join-Path $target $filename) -Force
}

Write-Host "Installed boundary spike to: $target"
Write-Host 'Restart SillyTavern, enable RPG Workspace C — Boundary Spike, then open a chat.'
