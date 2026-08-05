$ErrorActionPreference = 'Continue'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcher = Join-Path $projectRoot 'tools\start-local-sillytavern.ps1'
$output = & powershell -NoProfile -ExecutionPolicy Bypass -File $launcher -NoBrowser -StatusOnly 2>&1 | Out-String
$exitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

if ($exitCode -ne 0) {
    throw "Launcher did not exit cleanly for an already-running project instance.`n$output"
}

if ($output -notmatch 'already running') {
    throw "Launcher did not explain that SillyTavern is already running.`n$output"
}

Write-Host 'PASS: existing SillyTavern is detected before a second startup.'
