param(
    [switch]$NoBrowser,
    [switch]$StatusOnly
)

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

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.runtime\SillyTavern'
$serverEntry = Join-Path $runtimeRoot 'server.js'
$configPath = Join-Path $runtimeRoot 'config.yaml'

if (-not (Test-Path -LiteralPath $serverEntry -PathType Leaf)) {
    throw "Project-local SillyTavern is not installed at: $runtimeRoot"
}

$portMatch = Select-String -LiteralPath $configPath -Pattern '^port:\s*(\d+)\s*$' | Select-Object -First 1
if (-not $portMatch) {
    throw "Could not determine the SillyTavern port from: $configPath"
}
$listenPort = [int]$portMatch.Matches[0].Groups[1].Value
$versionUrl = "http://127.0.0.1:$listenPort/version"
$runningVersion = $null
try {
    $versionResponse = Invoke-WebRequest -UseBasicParsing -Uri $versionUrl -TimeoutSec 2
    if ($versionResponse.StatusCode -eq 200) {
        $runningVersion = $versionResponse.Content | ConvertFrom-Json
    }
}
catch {
    $runningVersion = $null
}

if ($runningVersion.agent -like 'SillyTavern:*') {
    $knownListeners = @(Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue)
    $knownOwnerId = $knownListeners | Select-Object -ExpandProperty OwningProcess -Unique | Select-Object -First 1
    $pidDetail = if ($knownOwnerId) { " (PID $knownOwnerId)" } else { '' }
    Write-Host "SillyTavern $($runningVersion.pkgVersion) is already running on port $listenPort$pidDetail."
    if (-not $NoBrowser -and -not $StatusOnly) {
        Start-Process "http://localhost:$listenPort/"
    }
    return
}

$listeners = @(Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue)
$ownerIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)

if ($ownerIds.Count -gt 0) {
    $owners = @($ownerIds | ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue })
    $projectOwner = $owners | Where-Object {
        $_.Name -ieq 'node.exe' -and $_.CommandLine -like "*$serverEntry*"
    } | Select-Object -First 1

    if ($projectOwner) {
        $healthUrl = "http://127.0.0.1:$listenPort/"
        try {
            $health = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
        }
        catch {
            throw "Project-local SillyTavern PID $($projectOwner.ProcessId) owns port $listenPort but is not responding. Stop that exact process before restarting."
        }

        if ($health.StatusCode -eq 200) {
            Write-Host "Project-local SillyTavern is already running on port $listenPort (PID $($projectOwner.ProcessId))."
            if (-not $NoBrowser) {
                Start-Process "http://localhost:$listenPort/"
            }
            return
        }
    }

    $ownerSummary = ($owners | ForEach-Object { "PID $($_.ProcessId) ($($_.Name))" }) -join ', '
    throw "Port $listenPort is already used by another process: $ownerSummary. SillyTavern was not started."
}

if ($StatusOnly) {
    Write-Error "Project-local SillyTavern is not running on port $listenPort."
    exit 1
}

if (-not (Test-VisibleConsoleWindow)) {
    throw "Hidden startup is blocked. Start SillyTavern with Start-Local-SillyTavern.cmd so its server console stays visible."
}

try {
    $Host.UI.RawUI.WindowTitle = "SillyTavern RPG - localhost $listenPort"
}
catch {
    # A visible host may not expose a writable title. That does not make startup unsafe.
}

$serverArguments = @($serverEntry)
if ($NoBrowser) {
    $serverArguments += '--browserLaunchEnabled=false'
}

Push-Location $runtimeRoot
try {
    & node @serverArguments
    if ($LASTEXITCODE -ne 0) {
        throw "SillyTavern exited with code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
