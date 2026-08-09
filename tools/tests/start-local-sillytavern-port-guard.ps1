$ErrorActionPreference = 'Continue'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcher = Join-Path $projectRoot 'tools\start-local-sillytavern.ps1'
$output = & powershell -NoProfile -ExecutionPolicy Bypass -File $launcher -NoBrowser -StatusOnly 2>&1 | Out-String
$exitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

if ($exitCode -ne 0) {
    throw "Launcher did not exit cleanly for an already-running project instance.`n$output"
}

if ($output -notmatch '\[ready\] SillyTavern' -or $output -notmatch '\[ready\] RPG Companion') {
    throw "Launcher did not report both owned services as ready.`n$output"
}

Write-Host 'PASS: the status-only launcher reports the existing playable stack without a second startup.'
