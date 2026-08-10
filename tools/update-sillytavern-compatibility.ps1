param(
    [switch]$KeepStage,
    [switch]$RollbackDrill,
    [string]$DrillRevision = '',
    [string]$PublishEvidence = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$defaultRuntimeRoot = Join-Path $projectRoot '.runtime'
$runtimeRoot = if ($RollbackDrill) {
    Join-Path $defaultRuntimeRoot 'verification\compatibility-rollback-drill'
} else {
    $defaultRuntimeRoot
}
$liveActiveRoot = Join-Path $defaultRuntimeRoot 'SillyTavern'
$activeRoot = Join-Path $runtimeRoot 'SillyTavern'
$stageRoot = Join-Path $runtimeRoot 'SillyTavern.next'
$previousRoot = Join-Path $runtimeRoot 'SillyTavern.previous'
$stateRoot = Join-Path $runtimeRoot 'wayfinder'
$logRoot = Join-Path $stateRoot 'logs'
$lockPath = Join-Path $projectRoot 'compatibility.lock.json'
$releasePath = Join-Path $projectRoot 'release.json'
$bridgeInstaller = Join-Path $projectRoot 'extension\st-rpg-bridge\install.ps1'
$fallbackInstaller = Join-Path $projectRoot 'extension\st-rpg-campaign\install.ps1'
$smokeConfig = Join-Path $stateRoot 'compatibility-smoke-config.yaml'
$switchReceipt = Join-Path $stateRoot 'compatibility-switch.json'
$persistentPaths = @(
    'config.yaml',
    'config_backup.yaml',
    'secrets.json',
    '.env',
    'data',
    'backups',
    'public\scripts\extensions\third-party'
)

function Assert-ChildPath([string]$Parent, [string]$Candidate) {
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $candidateFull = [IO.Path]::GetFullPath($Candidate)
    if (-not $candidateFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing filesystem operation outside $Parent`: $Candidate"
    }
    return $candidateFull
}

function Resolve-PublishedEvidencePath([string]$RelativePath) {
    if ([string]::IsNullOrWhiteSpace($RelativePath)) { return $null }
    $candidate = [IO.Path]::GetFullPath((Join-Path $projectRoot $RelativePath))
    $prefix = $projectRoot.TrimEnd('\') + '\'
    if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Published evidence must stay inside the project root: $RelativePath"
    }
    return $candidate
}

function Get-GitRevision([string]$Root) {
    $revision = ([string](& git -C $Root rev-parse HEAD)).Trim()
    if ($LASTEXITCODE -ne 0 -or $revision.Length -ne 40) {
        throw "Could not read the Git revision at $Root."
    }
    return $revision
}

function Invoke-Checked([string]$Label, [scriptblock]$Work) {
    Write-Host "[$Label]"
    & $Work
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

function Get-FileHashHex([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Test-BridgeMatches([string]$TargetRoot, [object]$Lock) {
    $target = Join-Path $TargetRoot 'public\scripts\extensions\third-party\st-rpg-bridge'
    foreach ($name in @($Lock.bridge.files)) {
        $sourcePath = Join-Path $projectRoot "extension\st-rpg-bridge\$name"
        $targetPath = Join-Path $target ([string]$name)
        if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) { return $false }
        if ((Get-FileHashHex $sourcePath) -ne (Get-FileHashHex $targetPath)) { return $false }
    }
    return $true
}

function Remove-StageSafely {
    if (-not (Test-Path -LiteralPath $stageRoot)) { return }
    Assert-ChildPath $runtimeRoot $stageRoot | Out-Null
    if (Test-Path -LiteralPath (Join-Path $stageRoot '.git')) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
        return
    }
    throw "Refusing to remove unrecognized staging directory: $stageRoot"
}

function Write-SmokeConfig([int]$Port) {
    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    $content = @"
dataRoot: ./.wayfinder-smoke-data
listen: false
listenAddress:
  ipv4: 127.0.0.1
  ipv6: "[::1]"
protocol:
  ipv4: true
  ipv6: false
port: $Port
browserLaunch:
  enabled: false
whitelistMode: false
basicAuthMode: false
enableUserAccounts: false
skipContentCheck: true
enableDownloadableTokenizers: false
performance:
  useDiskCache: false
extensions:
  enabled: true
  autoUpdate: false
  models:
    autoDownload: false
ssl:
  enabled: false
"@
    Set-Content -LiteralPath $smokeConfig -Value $content -Encoding UTF8
}

function Stop-ExactProcess([Diagnostics.Process]$Process) {
    if (-not $Process -or -not (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) { return }
    Stop-Process -Id $Process.Id -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline -and (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) {
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue) {
        throw "Compatibility smoke process PID $($Process.Id) did not exit."
    }
}

function Test-StagedRuntime([string]$TargetRoot, [object]$Lock) {
    $port = [int]$Lock.sillyTavern.stagingPort
    if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
        throw "Staging port $port is already occupied. No runtime was switched."
    }
    Write-SmokeConfig $port
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $stdout = Join-Path $logRoot 'compatibility-smoke.stdout.log'
    $stderr = Join-Path $logRoot 'compatibility-smoke.stderr.log'
    $entry = Join-Path $TargetRoot 'server.js'
    $arguments = @("`"$entry`"", "--configPath=`"$smokeConfig`"", '--browserLaunchEnabled=false')
    $process = Start-Process -FilePath (Get-Command node -ErrorAction Stop).Source -ArgumentList $arguments `
        -WorkingDirectory $TargetRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    try {
        $deadline = (Get-Date).AddSeconds(120)
        $version = $null
        do {
            Start-Sleep -Milliseconds 250
            if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { break }
            try { $version = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$port/version" -TimeoutSec 2 }
            catch { $version = $null }
        } while ((Get-Date) -lt $deadline -and -not $version)
        if (-not $version) {
            throw "Staged SillyTavern did not become ready. Inspect $stderr"
        }
        $reported = [string]$version.gitRevision
        $expected = [string]$Lock.sillyTavern.revision
        if ($reported.Length -lt 7 -or -not $expected.StartsWith($reported)) {
            throw "Staged SillyTavern reported revision $reported; expected $expected."
        }
        if (-not (Test-BridgeMatches $TargetRoot $Lock)) {
            throw 'Staged RPG Companion Bridge does not match reviewed source.'
        }
        Write-Host "Staged SillyTavern $($version.pkgVersion) at $reported passed isolated startup on port $port."
    }
    finally {
        Stop-ExactProcess $process
    }
}

function Move-PersistentState([string]$FromRoot, [string]$ToRoot) {
    foreach ($relative in $persistentPaths) {
        $source = Join-Path $FromRoot $relative
        if (-not (Test-Path -LiteralPath $source)) { continue }
        $target = Join-Path $ToRoot $relative
        Assert-ChildPath $FromRoot $source | Out-Null
        Assert-ChildPath $ToRoot $target | Out-Null
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Move-Item -LiteralPath $source -Destination $target
    }
}

$drillSentinelPath = $null
$drillSentinelHashBefore = $null
$liveRevisionBefore = $null
if ($RollbackDrill) {
    if (-not (Test-Path -LiteralPath (Join-Path $liveActiveRoot '.git'))) {
        throw "Rollback drill source is not a project-local Git runtime: $liveActiveRoot"
    }
    Assert-ChildPath $defaultRuntimeRoot $runtimeRoot | Out-Null
    if (Test-Path -LiteralPath $runtimeRoot) {
        Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    Invoke-Checked 'Clone isolated rollback-drill runtime' { & git clone --no-hardlinks $liveActiveRoot $activeRoot }
    $liveRevisionBefore = Get-GitRevision $liveActiveRoot
    $drillSentinelPath = Join-Path $activeRoot 'data\wayfinder-rollback-sentinel.txt'
    New-Item -ItemType Directory -Path (Split-Path -Parent $drillSentinelPath) -Force | Out-Null
    Set-Content -LiteralPath $drillSentinelPath -Value "wayfinder rollback drill $($liveRevisionBefore)" -Encoding UTF8
    $drillSentinelHashBefore = Get-FileHashHex $drillSentinelPath
}

if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { throw "Compatibility lock is missing: $lockPath" }
if (-not (Test-Path -LiteralPath $releasePath -PathType Leaf)) { throw "Release metadata is missing: $releasePath" }
if (-not (Test-Path -LiteralPath (Join-Path $activeRoot '.git'))) { throw "Active SillyTavern is not a project-local Git runtime: $activeRoot" }

$dirty = @(& git -C $projectRoot status --porcelain) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the project worktree.' }
if ($dirty.Trim() -and -not $RollbackDrill) { throw 'Project worktree is dirty. Commit or stash project changes before compatibility update.' }
$runtimeDirty = @(& git -C $activeRoot status --porcelain --untracked-files=no) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the active SillyTavern runtime.' }
if ($runtimeDirty.Trim()) { throw 'Active SillyTavern has tracked modifications. Update refused; user runtime state was untouched.' }

$lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
$release = Get-Content -Raw -LiteralPath $releasePath | ConvertFrom-Json
if ([string]$lock.schema -ne 'st-rpg.compatibility-lock' -or [string]$lock.version -ne '1.0') {
    throw 'Compatibility lock schema is unsupported.'
}
if ([string]$lock.sillyTavern.revision -ne [string]$release.pinnedSillyTavernRevision) {
    throw 'release.json and compatibility.lock.json disagree on the reviewed SillyTavern pin.'
}
$desiredRevision = [string]$lock.sillyTavern.revision
if ($RollbackDrill) {
    if ([string]::IsNullOrWhiteSpace($DrillRevision)) {
        $desiredRevision = ([string](& git -C $liveActiveRoot rev-parse 'HEAD^')).Trim()
    } else {
        $desiredRevision = $DrillRevision.Trim()
    }
    & git -C $liveActiveRoot cat-file -e "$desiredRevision^{commit}" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Rollback drill revision is not available locally: $desiredRevision" }
    $desiredRevision = ([string](& git -C $liveActiveRoot rev-parse $desiredRevision)).Trim()
    if ($desiredRevision -eq $liveRevisionBefore) {
        throw 'Rollback drill candidate must differ from the live pinned revision.'
    }
    $lock.sillyTavern.revision = $desiredRevision
}

Invoke-Checked 'Node policy' { & node (Join-Path $projectRoot 'tools\check-node-version.mjs') }
if ($RollbackDrill) {
    $backup = [pscustomobject]@{ id = 'isolated-drill-no-campaign-mutation'; availability = 'available' }
    Write-Host 'Rollback drill is isolated from Campaign data; no live backup or mutation is performed.'
} else {
    $backupBody = @{ label = "Before compatibility verification $(Get-Date -Format 'yyyy-MM-dd HH-mm-ss')" } | ConvertTo-Json -Compress
    $backup = Invoke-RestMethod -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:8002/api/operations/backups' `
        -ContentType 'application/json' -Body $backupBody -TimeoutSec 60
    if ($backup.availability -ne 'available' -or -not $backup.verification.verified) {
        throw 'Companion did not return a verified pre-update backup. Runtime was not changed.'
    }
    Write-Host "Verified pre-update backup: $($backup.id)"
}

Remove-StageSafely
Invoke-Checked 'Clone staged runtime' { & git clone --no-hardlinks --no-checkout $activeRoot $stageRoot }
if (-not $RollbackDrill) {
    Invoke-Checked 'Pin staged runtime remote' { & git -C $stageRoot remote set-url origin ([string]$lock.sillyTavern.repository) }
}
& git -C $stageRoot cat-file -e "$desiredRevision^{commit}" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Invoke-Checked 'Fetch reviewed SillyTavern pin' { & git -C $stageRoot fetch --depth 1 origin $desiredRevision }
}
Invoke-Checked 'Checkout reviewed SillyTavern pin' { & git -C $stageRoot checkout --detach $desiredRevision }
Invoke-Checked 'Install staged SillyTavern dependencies' { & npm ci --omit=dev --no-audit --no-fund --prefix $stageRoot }
& $fallbackInstaller -TargetRoot $stageRoot -SkipBundleBuild
& $bridgeInstaller -TargetRoot $stageRoot
foreach ($command in @($lock.checks)) {
    Invoke-Checked "Compatibility check: $command" { & cmd.exe /d /s /c ([string]$command) }
}
Test-StagedRuntime $stageRoot $lock

$activeRevision = ([string](& git -C $activeRoot rev-parse HEAD)).Trim()
$activeMatches = $activeRevision -eq $desiredRevision -and (Test-BridgeMatches $activeRoot $lock)
if ($activeMatches) {
    Write-Host 'Active runtime already matches the reviewed compatibility lock. No switch was needed.'
    if (-not $KeepStage) { Remove-StageSafely }
    exit 0
}

if (-not $RollbackDrill -and @(Get-NetTCPConnection -LocalPort ([int]$lock.sillyTavern.port) -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'Staging passed, but active SillyTavern is still running. Use Wayfinder.cmd stop, then run update-compatibility again. No switch occurred.'
}

$archiveRoot = $null
if (Test-Path -LiteralPath $previousRoot) {
    $archiveRoot = Join-Path $runtimeRoot ("SillyTavern.previous-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Assert-ChildPath $runtimeRoot $archiveRoot | Out-Null
    Move-Item -LiteralPath $previousRoot -Destination $archiveRoot
}

$switched = $false
$postSwitchVerified = $false
$failedRoot = $null
try {
    Move-Item -LiteralPath $activeRoot -Destination $previousRoot
    Move-Item -LiteralPath $stageRoot -Destination $activeRoot
    Move-PersistentState $previousRoot $activeRoot
    & $fallbackInstaller -TargetRoot $activeRoot -SkipBundleBuild
    & $bridgeInstaller -TargetRoot $activeRoot
    Test-StagedRuntime $activeRoot $lock
    $postSwitchVerified = $true
    if ($RollbackDrill) {
        throw 'Injected rollback-drill failure after the changed revision passed post-switch verification.'
    }
    $switched = $true
    [ordered]@{
        schema = 'st-rpg.compatibility-switch'
        version = '1.0'
        switchedAt = (Get-Date).ToUniversalTime().ToString('o')
        activeRevision = $desiredRevision
        previousRevision = $activeRevision
        backupId = [string]$backup.id
        previousRoot = $previousRoot
        archivedPreviousRoot = $archiveRoot
    } | ConvertTo-Json | Set-Content -LiteralPath $switchReceipt -Encoding UTF8
    Write-Host "Compatibility runtime switched to $desiredRevision."
    Write-Host 'Run Wayfinder.cmd start to start the verified active runtime.'
}
catch {
    Write-Warning "Post-switch verification failed; rolling back. $($_.Exception.Message)"
    if (Test-Path -LiteralPath $activeRoot) {
        try { Move-PersistentState $activeRoot $previousRoot } catch { Write-Warning "State rollback warning: $($_.Exception.Message)" }
        $failedRoot = Join-Path $runtimeRoot ("SillyTavern.failed-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Assert-ChildPath $runtimeRoot $failedRoot | Out-Null
        Move-Item -LiteralPath $activeRoot -Destination $failedRoot
    }
    if (Test-Path -LiteralPath $previousRoot) { Move-Item -LiteralPath $previousRoot -Destination $activeRoot }
    if ($RollbackDrill) {
        $restoredRevision = Get-GitRevision $activeRoot
        $liveRevisionAfter = Get-GitRevision $liveActiveRoot
        $sentinelRestored = Test-Path -LiteralPath $drillSentinelPath -PathType Leaf
        $sentinelHashAfter = if ($sentinelRestored) { Get-FileHashHex $drillSentinelPath } else { '' }
        $failedRevision = if ($null -ne $failedRoot -and (Test-Path -LiteralPath (Join-Path $failedRoot '.git'))) {
            Get-GitRevision $failedRoot
        } else { '' }
        $passed = (
            $postSwitchVerified -and
            $desiredRevision -ne $activeRevision -and
            $failedRevision -eq $desiredRevision -and
            $restoredRevision -eq $activeRevision -and
            $liveRevisionBefore -eq $liveRevisionAfter -and
            $sentinelRestored -and
            $drillSentinelHashBefore -eq $sentinelHashAfter
        )
        $evidence = [ordered]@{
            schema = 'st-rpg.compatibility-rollback-drill'
            version = 1
            generatedAt = (Get-Date).ToUniversalTime().ToString('o')
            liveRuntimeRoot = $liveActiveRoot
            liveRevisionBefore = $liveRevisionBefore
            liveRevisionAfter = $liveRevisionAfter
            liveRuntimeUnchanged = $liveRevisionBefore -eq $liveRevisionAfter
            isolatedRuntimeRoot = $runtimeRoot
            originalRevision = $activeRevision
            candidateRevision = $desiredRevision
            changedRevisionSwitched = $desiredRevision -ne $activeRevision
            candidatePassedPostSwitchVerification = $postSwitchVerified
            injectedFailure = 'after-post-switch-verification'
            failedCandidateRevision = $failedRevision
            restoredRevision = $restoredRevision
            originalRevisionRestored = $restoredRevision -eq $activeRevision
            persistentStateSentinelRestored = $sentinelRestored -and $drillSentinelHashBefore -eq $sentinelHashAfter
            campaignDataTouched = $false
            passed = $passed
        }
        $evidenceJson = $evidence | ConvertTo-Json -Depth 8
        $evidencePath = if ([string]::IsNullOrWhiteSpace($PublishEvidence)) {
            Join-Path $stateRoot 'compatibility-rollback-drill.json'
        } else {
            Resolve-PublishedEvidencePath $PublishEvidence
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $evidencePath) -Force | Out-Null
        $evidenceJson | Set-Content -LiteralPath $evidencePath -Encoding UTF8
        $evidenceJson
        Write-Host "Rollback drill evidence: $evidencePath"
        if (-not $passed) { throw 'Rollback drill did not restore the isolated runtime exactly.' }
        exit 0
    }
    throw 'Compatibility switch failed and the previous runtime was restored. Inspect Wayfinder compatibility logs before retrying.'
}
finally {
    if (-not $switched -and -not (Test-Path -LiteralPath $activeRoot) -and (Test-Path -LiteralPath $previousRoot)) {
        Move-Item -LiteralPath $previousRoot -Destination $activeRoot
    }
}
