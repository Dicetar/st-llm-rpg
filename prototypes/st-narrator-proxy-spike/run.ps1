$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime\SillyTavern'
$source = Join-Path $PSScriptRoot 'bridge'
$destination = Join-Path $runtimeRoot 'public\scripts\extensions\third-party\st-rpg-narrator-proxy-spike'
$proxyPort = 8002
$stateUrl = "http://127.0.0.1:$proxyPort/prototype/state"
$bridgeFiles = @(
    'manifest.json',
    'loader.js',
    'index.js',
    'phone-evidence.js',
    'phone-recorder-ui.js',
    'style.css'
)

if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'server.js') -PathType Leaf)) {
    throw "Pinned project-local SillyTavern is missing at: $runtimeRoot"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($file in $bridgeFiles) {
    $sourceFile = Join-Path $source $file
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Required throwaway bridge file is missing: $sourceFile"
    }
    Copy-Item -LiteralPath $sourceFile -Destination $destination -Force
}

Write-Host "Installed throwaway bridge at: $destination"
Write-Host "Close and reopen SillyTavern so bridge version 0.1.5 is active."

$existingState = $null
try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $stateUrl -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
        $existingState = $response.Content | ConvertFrom-Json
    }
}
catch {
    $existingState = $null
}

if ($existingState -and $existingState.kind -eq 'st-narrator-proxy-spike' -and $existingState.throwaway -eq $true) {
    Write-Host "The throwaway narrator proxy is already running on port $proxyPort. Reusing it."
    Write-Host "State: $stateUrl"
    exit 0
}

$listeners = @(Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    $ownerIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    $ownerSummary = @($ownerIds | ForEach-Object {
        $ownerId = $_
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction SilentlyContinue
        if ($process) {
            "PID $ownerId ($($process.Name)): $($process.CommandLine)"
        }
        else {
            "PID $ownerId (process details unavailable)"
        }
    }) -join '; '
    throw "Port $proxyPort is occupied by another or unhealthy process: $ownerSummary. The launcher did not stop it. Stop the correct process, then rerun npm run prototype:proxy."
}

Write-Host "The proxy is starting on port $proxyPort."
& node (Join-Path $PSScriptRoot 'proxy.mjs')
if ($LASTEXITCODE -ne 0) {
    throw "The throwaway narrator proxy exited with code $LASTEXITCODE."
}
