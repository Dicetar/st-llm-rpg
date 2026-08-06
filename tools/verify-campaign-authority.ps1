param(
    [int]$Port = 18002,
    [int]$Iterations = 100,
    [switch]$RunFullSuite,
    [switch]$AllowSillyTavernOffline
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime\verification'
$databasePath = Join-Path $runtimeRoot 'campaign-authority-milestone.sqlite'
$evidencePath = Join-Path $runtimeRoot 'campaign-authority-milestone.json'
$stdoutPath = Join-Path $runtimeRoot 'campaign-authority.stdout.log'
$stderrPath = Join-Path $runtimeRoot 'campaign-authority.stderr.log'
$baseUrl = "http://127.0.0.1:$Port"
$runId = [Guid]::NewGuid().ToString('N')
$process = $null

function Remove-DatabaseArtifacts([string]$Path) {
    Remove-Item $Path, "$Path-wal", "$Path-shm" -Force -ErrorAction SilentlyContinue
}

function Test-TcpPort([string]$HostName, [int]$TargetPort, [int]$TimeoutMs = 700) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync($HostName, $TargetPort)
        return $task.Wait($TimeoutMs) -and $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Invoke-Json([string]$Method, [string]$Path, $Body = $null) {
    $parameters = @{
        Method = $Method
        Uri = "$baseUrl$Path"
        Headers = @{ Accept = 'application/json' }
        TimeoutSec = 15
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = ($Body | ConvertTo-Json -Depth 12 -Compress)
    }
    return Invoke-RestMethod @parameters
}

function Start-CompanionProcess {
    $node = (Get-Command node -ErrorAction Stop).Source
    $env:RPG_COMPANION_HOST = '127.0.0.1'
    $env:RPG_COMPANION_PORT = [string]$Port
    $env:RPG_DATABASE_PATH = $databasePath
    $env:RPG_WORKSPACE_DIST = (Join-Path $projectRoot 'apps\workspace\dist')
    $env:RPG_LOG_LEVEL = 'info'
    return Start-Process -FilePath $node `
        -ArgumentList 'apps/companion/dist/main.js' `
        -WorkingDirectory $projectRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
}

function Wait-Companion($Child) {
    for ($attempt = 0; $attempt -lt 80; $attempt += 1) {
        $Child.Refresh()
        if ($Child.HasExited) {
            $stderr = Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue
            throw "Companion exited before health became available. $stderr"
        }
        try {
            $health = Invoke-Json 'GET' '/health'
            if ($health.status -eq 'alive') { return $health }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    throw "Companion did not become healthy at $baseUrl within 20 seconds."
}

function Stop-CompanionProcess($Child) {
    if ($null -eq $Child) { return }
    $Child.Refresh()
    if (-not $Child.HasExited) {
        Stop-Process -Id $Child.Id -Force
        $Child.WaitForExit()
    }
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Remove-DatabaseArtifacts $databasePath
Remove-Item $evidencePath, $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

$fallbackBefore = Test-TcpPort '127.0.0.1' 8001
if (-not $fallbackBefore -and -not $AllowSillyTavernOffline) {
    throw 'SillyTavern is not reachable on port 8001. Start the fallback stack or rerun with -AllowSillyTavernOffline.'
}

try {
    Push-Location $projectRoot
    if ($RunFullSuite) {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        & npm run typecheck
        if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
        & npm test
        if ($LASTEXITCODE -ne 0) { throw 'Full test suite failed.' }
    }
    else {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    }

    $process = Start-CompanionProcess
    $null = Wait-Companion $process

    $created = Invoke-Json 'POST' '/api/campaigns' @{
        requestId = "milestone-create-$runId"
        title = 'Campaign Authority Milestone'
    }
    $actorCommit = Invoke-Json 'POST' "/api/campaigns/$($created.campaignId)/operations" @{
        requestId = "milestone-actor-$runId"
        expectedRevision = 1
        operation = @{
            kind = 'create_actor'
            actor = @{ name = 'Milestone Actor' }
        }
    }
    $actorId = [string]$actorCommit.affectedIds[0]
    $revision = [int]$actorCommit.revision
    $finalName = 'Milestone Actor'

    for ($index = 1; $index -le $Iterations; $index += 1) {
        $finalName = 'Milestone Actor {0:D3}' -f $index
        $commit = Invoke-Json 'POST' "/api/campaigns/$($created.campaignId)/operations" @{
            requestId = "milestone-rename-$runId-$index"
            expectedRevision = $revision
            operation = @{
                kind = 'rename_actor'
                actorId = $actorId
                name = $finalName
            }
        }
        $revision = [int]$commit.revision
    }

    $history = @(Invoke-Json 'GET' "/api/campaigns/$($created.campaignId)/history")
    $performance = Invoke-Json 'GET' '/api/campaign-authority/performance'
    $verification = Invoke-Json 'POST' '/api/campaign-authority/verify'
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    $workingSetMiB = [Math]::Round($process.WorkingSet64 / 1MB, 2)

    Stop-CompanionProcess $process
    $process = Start-CompanionProcess
    $null = Wait-Companion $process
    $reloaded = Invoke-Json 'GET' "/api/campaigns/$($created.campaignId)"
    $persisted = (
        [int]$reloaded.campaign.revision -eq $revision -and
        [string]$reloaded.actors[0].name -eq $finalName
    )
    $fallbackAfter = Test-TcpPort '127.0.0.1' 8001

    $memoryTargetMet = $workingSetMiB -lt 250
    $memoryInvestigationRequired = $workingSetMiB -ge 400
    $latencyTargetMet = (
        [double]$performance.p95Ms -lt 50 -and
        [double]$performance.maxMs -lt 200
    )
    $fallbackPreserved = if ($fallbackBefore) { $fallbackAfter } else { $true }
    $passed = (
        $persisted -and
        [bool]$verification.verified -and
        $latencyTargetMet -and
        -not $memoryInvestigationRequired -and
        $fallbackPreserved
    )

    $evidence = [ordered]@{
        schema = 'st-rpg.campaign-authority-milestone'
        version = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        nodeVersion = (& node --version)
        port = $Port
        iterations = $Iterations
        campaignId = [string]$created.campaignId
        finalRevision = $revision
        historyEntries = $history.Count
        actorId = $actorId
        actorNameAfterRestart = [string]$reloaded.actors[0].name
        persistedAfterRestart = $persisted
        verification = $verification
        performance = $performance
        latencyTargetMet = $latencyTargetMet
        workingSetMiB = $workingSetMiB
        memoryTargetMiB = 250
        memoryTargetMet = $memoryTargetMet
        memoryInvestigationMiB = 400
        memoryInvestigationRequired = $memoryInvestigationRequired
        sillyTavernReachableBefore = $fallbackBefore
        sillyTavernReachableAfter = $fallbackAfter
        fallbackPreserved = $fallbackPreserved
        passed = $passed
    }
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -Path $evidencePath -Encoding UTF8
    $evidence | ConvertTo-Json -Depth 12
    Write-Host "Milestone evidence: $evidencePath"

    if (-not $passed) {
        throw 'Campaign authority milestone failed. Inspect the evidence JSON and companion logs.'
    }
    if (-not $memoryTargetMet) {
        Write-Warning "Working set is above the 250 MiB target but below the 400 MiB investigation gate: $workingSetMiB MiB."
    }
}
finally {
    Stop-CompanionProcess $process
    Pop-Location -ErrorAction SilentlyContinue
}
