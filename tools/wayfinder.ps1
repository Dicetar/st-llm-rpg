param(
    [Parameter(Position = 0)]
    [string]$Command = 'start',

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$CommandArguments = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$legacyLauncher = Join-Path $PSScriptRoot 'start-local-sillytavern.ps1'
$statusTool = Join-Path $PSScriptRoot 'wayfinder-status.mjs'
$stateRoot = Join-Path $projectRoot '.runtime\wayfinder'
$companionRecordPath = Join-Path $stateRoot 'companion-process.json'
$sillyTavernRecordPath = Join-Path $stateRoot 'sillytavern-process.json'
$compatibilityUpdater = Join-Path $PSScriptRoot 'update-sillytavern-compatibility.ps1'
$modeTool = Join-Path $PSScriptRoot 'wayfinder-mode.mjs'
$companionUrl = 'http://127.0.0.1:8002'
$companionPort = 8002
$sillyTavernPort = 8001

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

function Get-LiveProcessIdentity([int]$ProcessId) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $process -or -not $owner) { return $null }
    $executablePath = if ($owner.ExecutablePath) { [IO.Path]::GetFullPath([string]$owner.ExecutablePath) } else { '' }
    $commandLine = if ($owner.CommandLine) { [string]$owner.CommandLine } else { '' }
    return [pscustomobject]@{
        process = $process
        processId = $ProcessId
        startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o')
        executablePath = $executablePath
        commandLine = $commandLine
        commandHash = Get-CommandHash $commandLine
    }
}

function Read-ProcessRecord([string]$Path, [string]$Role) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        $record = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    }
    catch {
        throw "Wayfinder cannot parse the $Role ownership record at $Path. Nothing was stopped."
    }
    if ([string]$record.schema -ne 'st-rpg.wayfinder-process' -or [string]$record.version -ne '1.0' -or [string]$record.role -ne $Role) {
        throw "Wayfinder does not recognize the $Role ownership record at $Path. Nothing was stopped."
    }
    return $record
}

function Assert-OwnedProcess([object]$Record, [string]$Role) {
    $identity = Get-LiveProcessIdentity ([int]$Record.processId)
    if (-not $identity) { return $null }
    $sameStart = [string]$identity.startTimeUtc -eq [string]$Record.startTimeUtc
    $sameExecutable = [string]$identity.executablePath -ieq [string]$Record.executablePath
    $sameCommand = [string]$identity.commandHash -eq [string]$Record.commandHash
    if (-not $sameStart -or -not $sameExecutable -or -not $sameCommand) {
        throw "Refusing to stop PID $($Record.processId): live identity no longer matches the recorded $Role process. Record preserved."
    }
    return $identity
}

function Wait-ForExit([int]$ProcessId, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        Start-Sleep -Milliseconds 100
    }
    return -not [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Remove-MatchingRecord([string]$Path, [int]$ProcessId) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $record = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    if ([int]$record.processId -eq $ProcessId) { Remove-Item -LiteralPath $Path -Force }
}

function Stop-OwnedProcess([string]$Role, [string]$RecordPath, [int]$Port) {
    $record = Read-ProcessRecord $RecordPath $Role
    if (-not $record) {
        $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            Write-Warning "Port $Port is active, but Wayfinder has no $Role ownership record. The listener was left untouched."
        }
        else {
            Write-Host "$Role is not running under Wayfinder ownership."
        }
        return
    }
    $identity = Assert-OwnedProcess $record $Role
    if (-not $identity) {
        Write-Host "Removing stale $Role ownership record for exited PID $($record.processId)."
        Remove-MatchingRecord $RecordPath ([int]$record.processId)
        return
    }

    if ($Role -eq 'companion') {
        try {
            Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$companionUrl/api/operations/shutdown" `
                -Headers @{ 'x-wayfinder-run-id' = [string]$record.runId } `
                -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null
            Write-Host "Draining Wayfinder-owned RPG Companion PID $($record.processId)..."
        }
        catch {
            Write-Warning "Graceful Companion shutdown was unavailable; exact owned PID will be stopped after identity recheck. $($_.Exception.Message)"
        }
        if (-not (Wait-ForExit ([int]$record.processId) 15)) {
            $identity = Assert-OwnedProcess $record $Role
            if (-not $identity) { throw "Companion identity disappeared during shutdown; record preserved." }
            Stop-Process -Id ([int]$record.processId) -ErrorAction Stop
            if (-not (Wait-ForExit ([int]$record.processId) 10)) {
                throw "Exact owned Companion PID $($record.processId) did not exit. Record preserved."
            }
        }
    }
    else {
        Write-Host "Stopping Wayfinder-owned pinned SillyTavern PID $($record.processId)..."
        Stop-Process -Id ([int]$record.processId) -ErrorAction Stop
        if (-not (Wait-ForExit ([int]$record.processId) 10)) {
            throw "Exact owned SillyTavern PID $($record.processId) did not exit. Record preserved."
        }
    }
    Remove-MatchingRecord $RecordPath ([int]$record.processId)
    Write-Host "$Role stopped."
}

function Invoke-Start([string[]]$Arguments) {
    $launcherArguments = @()
    foreach ($argument in $Arguments) {
        if ($argument -ieq '--no-browser' -or $argument -ieq '-NoBrowser') { $launcherArguments += '-NoBrowser' }
        else { throw "Unknown start argument: $argument" }
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $legacyLauncher @launcherArguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Invoke-Status {
    & node $statusTool
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Invoke-Backup([string[]]$Arguments) {
    $label = if ($Arguments.Count -gt 0) { $Arguments -join ' ' } else { "Wayfinder manual backup $(Get-Date -Format 'yyyy-MM-dd HH-mm-ss')" }
    $body = @{ label = $label } | ConvertTo-Json -Compress
    $backup = Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$companionUrl/api/operations/backups" `
        -ContentType 'application/json' -Body $body -TimeoutSec 60
    Write-Host "Verified backup created: $($backup.id)"
    Write-Host "  $($backup.label)"
    Write-Host "  $($backup.sizeBytes) bytes | SHA-256 $($backup.sha256)"
}

function Invoke-Restore([string[]]$Arguments) {
    $backupId = @($Arguments | Where-Object { $_ -ne '--confirm' }) | Select-Object -First 1
    $confirmed = $Arguments -contains '--confirm'
    if (-not $backupId) {
        $catalog = Invoke-RestMethod -UseBasicParsing -Uri "$companionUrl/api/operations/backups" -TimeoutSec 10
        Write-Host 'Available verified backups:'
        foreach ($backup in @($catalog.backups | Where-Object availability -eq 'available')) {
            Write-Host "  $($backup.id) | $($backup.kind) | $($backup.createdAt) | $($backup.label)"
        }
        throw 'Choose one with: Wayfinder.cmd restore <backup-id>'
    }
    $encodedId = [Uri]::EscapeDataString([string]$backupId)
    $preview = Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$companionUrl/api/operations/backups/$encodedId/restore-preview" -TimeoutSec 60
    Write-Host "Restore preview verified: $($preview.backup.id)"
    Write-Host "  Campaigns in backup: $($preview.backup.verification.campaignCount)"
    Write-Host "  Current Campaigns: $($preview.currentAuthority.campaignCount)"
    Write-Warning 'Restore replaces current SQLite authority after creating another verified safety backup.'
    if (-not $confirmed) {
        $answer = Read-Host "Type RESTORE $backupId to continue"
        if ($answer -cne "RESTORE $backupId") { throw 'Restore cancelled; Campaign authority was not changed.' }
    }
    $body = @{ restoreToken = [string]$preview.restoreToken } | ConvertTo-Json -Compress
    $receipt = Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$companionUrl/api/operations/backups/$encodedId/restore" `
        -ContentType 'application/json' -Body $body -TimeoutSec 120
    Write-Host "Restore complete: $($receipt.backupId)"
    Write-Host "Safety backup: $($receipt.safetyBackupId)"
    Write-Host 'Reload Campaign Book on every open device/tab.'
}

function Invoke-ModeTool([string[]]$Arguments) {
    $output = @(& node $modeTool @Arguments)
    if ($LASTEXITCODE -ne 0) { throw "Wayfinder mode command failed. No further mode transition was attempted." }
    if ($output.Count -ne 1) { throw 'Wayfinder mode command returned an invalid receipt.' }
    try { return ([string]$output[0] | ConvertFrom-Json) }
    catch { throw "Wayfinder mode command returned invalid JSON. $($_.Exception.Message)" }
}

function Invoke-FallbackMode([string[]]$Arguments) {
    $confirmed = $Arguments -contains '--confirm'
    $emergency = $Arguments -contains '--emergency'
    $noBrowser = $Arguments -contains '--no-browser' -or $Arguments -contains '-NoBrowser'
    $unknown = @($Arguments | Where-Object { $_ -notin @('--confirm', '--emergency', '--no-browser', '-NoBrowser') })
    if ($unknown.Count -gt 0) { throw "Unknown fallback argument: $($unknown -join ' ')" }

    Write-Warning 'Fallback uses retained legacy chat metadata. Any further fallback play diverges from SQLite Campaign history and is never merged automatically.'
    if ($emergency) {
        Write-Warning 'Emergency override permits switching only if verified backup/export fails. Existing SQLite files are still preserved.'
    }
    if (-not $confirmed) {
        $answer = Read-Host 'Type FALLBACK to create safety evidence and switch extension authority'
        if ($answer -cne 'FALLBACK') { throw 'Fallback cancelled; runtime mode was not changed.' }
    }

    $modeArguments = @('fallback', '--root', $projectRoot, '--companion-url', $companionUrl)
    if ($emergency) { $modeArguments += '--emergency' }
    $receipt = Invoke-ModeTool $modeArguments
    Write-Host "Fallback extension authority activated. Divergence report: $($receipt.mode.divergenceReport)"
    if ($receipt.mode.backupId) { Write-Host "Verified backup: $($receipt.mode.backupId)" }
    if ($receipt.mode.exportPath) { Write-Host "Companion JSON export: $($receipt.mode.exportPath)" }
    Stop-OwnedProcess 'companion' $companionRecordPath $companionPort
    Write-Host 'In SillyTavern, select a direct LM Studio OpenAI-compatible endpoint such as http://127.0.0.1:1234/v1, refresh the page, then open the gold R Workspace.'
    $startArguments = if ($noBrowser) { @('-NoBrowser') } else { @() }
    Invoke-Start $startArguments
}

function Invoke-CompanionMode([string[]]$Arguments) {
    $launcherArguments = @()
    foreach ($argument in $Arguments) {
        if ($argument -ieq '--no-browser' -or $argument -ieq '-NoBrowser') { $launcherArguments += '-NoBrowser' }
        else { throw "Unknown companion argument: $argument" }
    }
    $receipt = Invoke-ModeTool @('companion', '--root', $projectRoot)
    Write-Host "Companion extension authority activated with $($receipt.mode.verifiedBindingCount) verified Chat Binding(s)."
    Write-Warning $receipt.mode.warning
    Invoke-Start $launcherArguments
}

$normalizedCommand = if ([string]::IsNullOrWhiteSpace($Command)) { 'start' } else { $Command.Trim().ToLowerInvariant() }
switch ($normalizedCommand) {
    'start' { Invoke-Start $CommandArguments }
    'companion' { Invoke-CompanionMode $CommandArguments }
    'status' { Invoke-Status }
    'stop' {
        Stop-OwnedProcess 'companion' $companionRecordPath $companionPort
        Stop-OwnedProcess 'sillytavern' $sillyTavernRecordPath $sillyTavernPort
    }
    'backup' { Invoke-Backup $CommandArguments }
    'restore' { Invoke-Restore $CommandArguments }
    'fallback' { Invoke-FallbackMode $CommandArguments }
    'update-compatibility' {
        if ($CommandArguments.Count -gt 0) { throw "Unknown update-compatibility argument: $($CommandArguments -join ' ')" }
        & powershell -NoProfile -ExecutionPolicy Bypass -File $compatibilityUpdater
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    'help' {
        Write-Host 'Wayfinder.cmd [start|status|stop|companion|backup [label]|restore <backup-id> [--confirm]|fallback|update-compatibility]'
        Write-Host 'fallback requires typed confirmation (or --confirm); --emergency only bypasses failed safety backup/export.'
    }
    default { throw "Unknown Wayfinder command: $Command" }
}
