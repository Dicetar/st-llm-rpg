param(
    [switch]$NoBrowser,
    [switch]$StatusOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($args.Count -gt 0) {
    throw "Unknown Wayfinder argument: $($args -join ' ')"
}

function Test-VisibleConsoleWindow {
    if (-not ('RpgLauncher.NativeMethods' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace RpgLauncher
{
    public static class NativeMethods
    {
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindowVisible(IntPtr hWnd);
    }
}
'@
    }

    $consoleWindow = [RpgLauncher.NativeMethods]::GetConsoleWindow()
    return $consoleWindow -ne [IntPtr]::Zero -and [RpgLauncher.NativeMethods]::IsWindowVisible($consoleWindow)
}

function Get-PortOwners([int]$Port) {
    $ownerIds = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    return @($ownerIds | ForEach-Object {
        Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue
    })
}

function Format-PortOwners([object[]]$Owners) {
    if ($Owners.Count -eq 0) { return 'no listener details available' }
    return ($Owners | ForEach-Object {
        $command = if ($_.CommandLine) { $_.CommandLine } else { $_.Name }
        "PID $($_.ProcessId): $command"
    }) -join '; '
}

function Get-CommandHash([string]$CommandLine) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($CommandLine.Trim())
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $hash.Dispose()
    }
}

function Write-ProcessOwnershipRecord(
    [Diagnostics.Process]$Process,
    [string]$Role,
    [string]$Entry,
    [string]$RecordPath,
    [string]$RunId
) {
    $owner = $null
    $deadline = (Get-Date).AddSeconds(5)
    do {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.Id)" -ErrorAction SilentlyContinue
        if (-not $owner -or -not $owner.CommandLine -or -not $owner.ExecutablePath) { Start-Sleep -Milliseconds 50 }
    } while ((Get-Date) -lt $deadline -and (-not $owner -or -not $owner.CommandLine -or -not $owner.ExecutablePath))
    if (-not $owner -or -not $owner.CommandLine -or -not $owner.ExecutablePath) {
        throw "Could not capture the complete $Role process identity for PID $($Process.Id)."
    }
    $Process.Refresh()
    New-Item -ItemType Directory -Path (Split-Path -Parent $RecordPath) -Force | Out-Null
    [ordered]@{
        schema = 'st-rpg.wayfinder-process'
        version = '1.0'
        role = $Role
        runId = $RunId
        processId = $Process.Id
        startTimeUtc = $Process.StartTime.ToUniversalTime().ToString('o')
        executablePath = [IO.Path]::GetFullPath([string]$owner.ExecutablePath)
        commandHash = Get-CommandHash ([string]$owner.CommandLine)
        entry = $Entry
        recordedAt = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $RecordPath -Encoding UTF8
}

function Read-JsonEndpoint([string]$Url, [int]$TimeoutSeconds = 2) {
    try {
        return Invoke-RestMethod -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSeconds
    }
    catch {
        return $null
    }
}

function Test-CompanionOwner([object]$Owner, [string]$Entry) {
    if (-not $Owner -or $Owner.Name -ine 'node.exe' -or -not $Owner.CommandLine) { return $false }
    $normalized = $Entry.Replace('\', '/')
    $command = ([string]$Owner.CommandLine).Replace('\', '/')
    return $command.Contains($normalized)
}

function Test-SillyTavernOwner([object]$Owner, [string]$Entry) {
    if (-not $Owner -or $Owner.Name -ine 'node.exe' -or -not $Owner.CommandLine) { return $false }
    return ([string]$Owner.CommandLine).Replace('\', '/').Contains($Entry.Replace('\', '/'))
}

function Test-RecordedCompanionOwner([object]$Owner, [string]$Entry, [string]$RecordPath) {
    if (-not (Test-CompanionOwner $Owner $Entry) -or -not (Test-Path -LiteralPath $RecordPath -PathType Leaf)) {
        return $false
    }
    try {
        $record = Get-Content -Raw -LiteralPath $RecordPath | ConvertFrom-Json
        return $record.processId -eq $Owner.ProcessId -and [string]$record.entry -eq $Entry
    }
    catch {
        return $false
    }
}

function Test-BuildRequired([string]$Root, [string[]]$Outputs, [string]$Stamp) {
    foreach ($output in $Outputs) {
        if (-not (Test-Path -LiteralPath $output -PathType Leaf)) { return $true }
    }
    if (-not (Test-Path -LiteralPath $Stamp -PathType Leaf)) { return $true }

    $sources = @(
        Get-Item -LiteralPath (Join-Path $Root 'package.json'), (Join-Path $Root 'package-lock.json')
        Get-ChildItem -LiteralPath (Join-Path $Root 'packages\wire\src') -Recurse -File
        Get-ChildItem -LiteralPath (Join-Path $Root 'apps\workspace\src') -Recurse -File
        Get-ChildItem -LiteralPath (Join-Path $Root 'apps\companion\src') -Recurse -File
        Get-Item -LiteralPath (Join-Path $Root 'packages\wire\package.json'), (Join-Path $Root 'apps\workspace\package.json'), (Join-Path $Root 'apps\companion\package.json')
        Get-Item -LiteralPath (Join-Path $Root 'packages\wire\tsconfig.json'), (Join-Path $Root 'apps\workspace\tsconfig.json'), (Join-Path $Root 'apps\workspace\vite.config.ts'), (Join-Path $Root 'apps\workspace\index.html'), (Join-Path $Root 'apps\companion\tsconfig.json')
    )
    $latestSource = ($sources | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
    $successfulBuild = (Get-Item -LiteralPath $Stamp).LastWriteTimeUtc
    return $latestSource -gt $successfulBuild
}

function Write-CompanionReadiness([object]$Readiness) {
    $label = if ($Readiness.status -eq 'degraded') { 'READY (degraded)' } else { 'READY' }
    Write-Host "RPG Companion: $label on port 8002"
    foreach ($component in @($Readiness.components)) {
        if ($component.status -notin @('ready', 'available')) {
            Write-Host "  [$($component.status)] $($component.id): $($component.message)" -ForegroundColor Yellow
        }
    }
}

function Stop-LauncherOwnedCompanion([object]$Process, [string]$Entry, [string]$RecordPath) {
    if (-not $Process) { return }
    $owned = Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.Id)" -ErrorAction SilentlyContinue
    if ($owned) {
        if (-not (Test-CompanionOwner $owned $Entry)) {
            throw "Refusing to stop PID $($Process.Id) because it no longer matches the recorded RPG Companion entry. Ownership record preserved at $RecordPath"
        }
        Write-Host "Stopping launcher-owned RPG Companion PID $($Process.Id)..."
        try {
            Stop-Process -Id $Process.Id -ErrorAction Stop
        }
        catch {
            throw "Could not stop launcher-owned RPG Companion PID $($Process.Id). Ownership record preserved at $RecordPath. $($_.Exception.Message)"
        }
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $deadline -and (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) {
            Start-Sleep -Milliseconds 100
        }
        if (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue) {
            throw "Launcher-owned RPG Companion PID $($Process.Id) did not exit. Ownership record preserved at $RecordPath"
        }
    }
    if (Test-Path -LiteralPath $RecordPath -PathType Leaf) {
        try {
            $record = Get-Content -Raw -LiteralPath $RecordPath | ConvertFrom-Json
            if ($record.processId -eq $Process.Id) { Remove-Item -LiteralPath $RecordPath -Force }
        }
        catch {
            throw "Could not validate the companion ownership record at $RecordPath. It was left in place. $($_.Exception.Message)"
        }
    }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.runtime\SillyTavern'
$serverEntry = Join-Path $runtimeRoot 'server.js'
$configPath = Join-Path $runtimeRoot 'config.yaml'
$companionEntry = Join-Path $projectRoot 'apps\companion\dist\main.js'
$workspaceEntry = Join-Path $projectRoot 'apps\workspace\dist\index.html'
$wireEntry = Join-Path $projectRoot 'packages\wire\dist\index.js'
$bridgeInstaller = Join-Path $projectRoot 'extension\st-rpg-bridge\install.ps1'
$statusTool = Join-Path $projectRoot 'tools\wayfinder-status.mjs'
$releasePath = Join-Path $projectRoot 'release.json'
$companionPort = 8002
$companionUrl = "http://127.0.0.1:$companionPort"
$stateRoot = Join-Path $projectRoot '.runtime\wayfinder'
$logRoot = Join-Path $stateRoot 'logs'
$companionRecord = Join-Path $stateRoot 'companion-process.json'
$sillyTavernRecord = Join-Path $stateRoot 'sillytavern-process.json'
$buildStamp = Join-Path $stateRoot 'successful-build.json'
$launcherRunId = [guid]::NewGuid().ToString()

if ($StatusOnly) {
    & node $statusTool
    exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $serverEntry -PathType Leaf)) {
    throw "Project-local SillyTavern is not installed at: $runtimeRoot"
}
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Project-local SillyTavern configuration is missing at: $configPath"
}
if (-not (Test-Path -LiteralPath $bridgeInstaller -PathType Leaf)) {
    throw "RPG Companion Bridge installer is missing at: $bridgeInstaller"
}
if (-not (Test-Path -LiteralPath $releasePath -PathType Leaf)) {
    throw "Wayfinder release metadata is missing at: $releasePath"
}

$nodeCommand = Get-Command node -ErrorAction Stop
& $nodeCommand.Source (Join-Path $projectRoot 'tools\check-node-version.mjs')
if ($LASTEXITCODE -ne 0) { throw "The project Node runtime check failed with code $LASTEXITCODE." }
$release = Get-Content -Raw -LiteralPath $releasePath | ConvertFrom-Json
$runtimeRevision = [string](& git -C $runtimeRoot rev-parse HEAD 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $runtimeRevision.Trim()) {
    throw "Could not verify the project-local SillyTavern revision at: $runtimeRoot"
}
$runtimeRevision = $runtimeRevision.Trim()
if ($runtimeRevision -ne [string]$release.pinnedSillyTavernRevision) {
    throw "Project-local SillyTavern is at $runtimeRevision; Wayfinder requires pinned revision $($release.pinnedSillyTavernRevision)."
}

$buildOutputs = @($wireEntry, $workspaceEntry, $companionEntry)
if (Test-BuildRequired $projectRoot $buildOutputs $buildStamp) {
    Write-Host 'Building the RPG Companion and Campaign Book...'
    Push-Location $projectRoot
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed with code $LASTEXITCODE." }
    }
    finally {
        Pop-Location
    }
    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    [ordered]@{
        completedAt = (Get-Date).ToUniversalTime().ToString('o')
        gitRevision = (& git -C $projectRoot rev-parse HEAD 2>$null)
    } | ConvertTo-Json | Set-Content -LiteralPath $buildStamp -Encoding UTF8
}

& $bridgeInstaller

$portMatch = Select-String -LiteralPath $configPath -Pattern '^port:\s*(\d+)\s*$' | Select-Object -First 1
if (-not $portMatch) { throw "Could not determine the SillyTavern port from: $configPath" }
$listenPort = [int]$portMatch.Matches[0].Groups[1].Value

$spawnedCompanion = $null
try {
    $companionHealth = Read-JsonEndpoint "$companionUrl/health"
    $companionOwners = @(Get-PortOwners $companionPort)
    $companionOwner = $companionOwners | Where-Object { Test-CompanionOwner $_ $companionEntry } | Select-Object -First 1

    if ($companionOwner -and $companionHealth -and $companionHealth.service -eq 'st-rpg-companion') {
        $runningProcess = Get-Process -Id $companionOwner.ProcessId -ErrorAction Stop
        $buildCompletedAt = (Get-Item -LiteralPath $buildStamp).LastWriteTimeUtc
        if ($buildCompletedAt -gt $runningProcess.StartTime.ToUniversalTime()) {
            if (-not (Test-RecordedCompanionOwner $companionOwner $companionEntry $companionRecord)) {
                throw "RPG Companion PID $($companionOwner.ProcessId) predates the current build and was not started by Wayfinder. Stop that exact process, then run Wayfinder again."
            }
            Write-Host "Restarting launcher-owned RPG Companion PID $($companionOwner.ProcessId) for the current build..."
            Stop-LauncherOwnedCompanion $runningProcess $companionEntry $companionRecord
            $deadline = (Get-Date).AddSeconds(10)
            while ((Get-Date) -lt $deadline -and (@(Get-PortOwners $companionPort)).Count -gt 0) {
                Start-Sleep -Milliseconds 100
            }
            if ((@(Get-PortOwners $companionPort)).Count -gt 0) {
                throw "Launcher-owned RPG Companion PID $($companionOwner.ProcessId) did not release port $companionPort."
            }
            $companionHealth = $null
            $companionOwners = @()
            $companionOwner = $null
        }
    }

    if ($companionHealth -and $companionHealth.service -eq 'st-rpg-companion' -and $companionHealth.status -eq 'alive') {
        if (-not $companionOwner) {
            throw "Port $companionPort answers as an RPG Companion but is not owned by this project. $(Format-PortOwners $companionOwners)"
        }
        Write-Host "RPG Companion is already running on port $companionPort (PID $($companionOwner.ProcessId))."
    }
    elseif ($companionOwners.Count -gt 0) {
        throw "Port $companionPort is occupied and does not answer as this project's RPG Companion. $(Format-PortOwners $companionOwners)"
    }
    else {
        New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
        $stdoutLog = Join-Path $logRoot 'companion.stdout.log'
        $stderrLog = Join-Path $logRoot 'companion.stderr.log'
        Write-Host "Starting RPG Companion on port $companionPort..."
        $previousRunId = $env:RPG_WAYFINDER_RUN_ID
        $env:RPG_WAYFINDER_RUN_ID = $launcherRunId
        try {
            $spawnedCompanion = Start-Process -FilePath $nodeCommand.Source `
                -ArgumentList @('--enable-source-maps', "`"$companionEntry`"") `
                -WorkingDirectory $projectRoot `
                -WindowStyle Hidden `
                -RedirectStandardOutput $stdoutLog `
                -RedirectStandardError $stderrLog `
                -PassThru
        }
        finally {
            if ($null -eq $previousRunId) { Remove-Item Env:RPG_WAYFINDER_RUN_ID -ErrorAction SilentlyContinue }
            else { $env:RPG_WAYFINDER_RUN_ID = $previousRunId }
        }
        Write-ProcessOwnershipRecord $spawnedCompanion 'companion' $companionEntry $companionRecord $launcherRunId

        $deadline = (Get-Date).AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 200
            $companionHealth = Read-JsonEndpoint "$companionUrl/health"
        } while ((Get-Date) -lt $deadline -and (-not $companionHealth -or $companionHealth.service -ne 'st-rpg-companion'))

        if (-not $companionHealth -or $companionHealth.service -ne 'st-rpg-companion') {
            throw "RPG Companion did not become healthy within 20 seconds. Inspect $stderrLog"
        }
    }

    $readiness = Read-JsonEndpoint "$companionUrl/ready" 5
    if (-not $readiness) { throw "RPG Companion is alive but /ready did not respond." }
    if (-not $readiness.ready) {
        $blocking = @($readiness.components | Where-Object { $_.blocking -and $_.status -notin @('ready', 'available') })
        $details = ($blocking | ForEach-Object { "$($_.id): $($_.message)" }) -join '; '
        throw "RPG Companion is not ready. $details"
    }
    Write-CompanionReadiness $readiness

    $versionUrl = "http://127.0.0.1:$listenPort/version"
    $runningVersion = Read-JsonEndpoint $versionUrl
    if ($runningVersion -and $runningVersion.agent -like 'SillyTavern:*') {
        $stOwners = @(Get-PortOwners $listenPort)
        $stOwner = $stOwners | Where-Object { Test-SillyTavernOwner $_ $serverEntry } | Select-Object -First 1
        if (-not $stOwner) {
            throw "Port $listenPort answers as SillyTavern but is not the pinned project process. $(Format-PortOwners $stOwners)"
        }
        $servedRevision = [string]$runningVersion.gitRevision
        if ($servedRevision.Length -lt 7 -or -not ([string]$release.pinnedSillyTavernRevision).StartsWith($servedRevision)) {
            throw "Running SillyTavern reports revision $servedRevision; Wayfinder requires $($release.pinnedSillyTavernRevision)."
        }
        Write-Host "SillyTavern $($runningVersion.pkgVersion) is already running on port $listenPort (PID $($stOwner.ProcessId))."
        & $nodeCommand.Source $statusTool
        if ($LASTEXITCODE -ne 0) { throw 'The playable stack failed its status check.' }
        if (-not $NoBrowser) { Start-Process "http://localhost:$listenPort/" }
        if ($spawnedCompanion) {
            Write-Host 'Companion started under Wayfinder ownership. Use Wayfinder.cmd stop for an identity-safe shutdown.'
        }
        return
    }

    $stOwners = @(Get-PortOwners $listenPort)
    if ($stOwners.Count -gt 0) {
        throw "Port $listenPort is already used by another process. $(Format-PortOwners $stOwners)"
    }
    if (-not (Test-VisibleConsoleWindow)) {
        throw 'Hidden startup is blocked. Start the stack with Wayfinder.cmd so the server console stays visible.'
    }

    try { $Host.UI.RawUI.WindowTitle = "Wayfinder RPG - SillyTavern $listenPort + Companion $companionPort" } catch {}

    $serverArguments = @($serverEntry)
    if ($NoBrowser) { $serverArguments += '--browserLaunchEnabled=false' }

    $stProcess = $null
    try {
        Write-Host "Starting pinned SillyTavern on port $listenPort. Close this window or press Ctrl+C to stop the stack."
        $quotedArguments = @($serverArguments | ForEach-Object {
            if ($_ -match '\s') { "`"$_`"" } else { $_ }
        })
        $stProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList $quotedArguments `
            -WorkingDirectory $runtimeRoot -NoNewWindow -PassThru
        Write-ProcessOwnershipRecord $stProcess 'sillytavern' $serverEntry $sillyTavernRecord $launcherRunId
        Wait-Process -Id $stProcess.Id
        $stProcess.Refresh()
        if ($stProcess.ExitCode -ne 0) { throw "SillyTavern exited with code $($stProcess.ExitCode)" }
    }
    finally {
        if ($stProcess -and -not (Get-Process -Id $stProcess.Id -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $sillyTavernRecord)) {
            try {
                $record = Get-Content -Raw -LiteralPath $sillyTavernRecord | ConvertFrom-Json
                if ($record.processId -eq $stProcess.Id) { Remove-Item -LiteralPath $sillyTavernRecord -Force }
            }
            catch {
                Write-Warning "Could not clean the SillyTavern ownership record at $sillyTavernRecord."
            }
        }
        if ($spawnedCompanion) {
            Stop-LauncherOwnedCompanion $spawnedCompanion $companionEntry $companionRecord
        }
    }
}
catch {
    if ($spawnedCompanion) {
        Stop-LauncherOwnedCompanion $spawnedCompanion $companionEntry $companionRecord
    }
    throw
}
