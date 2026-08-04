$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime\SillyTavern'
$source = Join-Path $PSScriptRoot 'bridge'
$destination = Join-Path $runtimeRoot 'public\scripts\extensions\third-party\st-rpg-narrator-proxy-spike'

if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'server.js') -PathType Leaf)) {
    throw "Pinned project-local SillyTavern is missing at: $runtimeRoot"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'manifest.json') -Destination $destination -Force
Copy-Item -LiteralPath (Join-Path $source 'index.js') -Destination $destination -Force
Copy-Item -LiteralPath (Join-Path $source 'style.css') -Destination $destination -Force

Write-Host "Installed throwaway bridge at: $destination"
Write-Host "Reload SillyTavern after the first install. The proxy is starting on port 8002."

& node (Join-Path $PSScriptRoot 'proxy.mjs')
exit $LASTEXITCODE
