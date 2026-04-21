param(
    [string]$RepoRoot = "D:\Projects\st-llm-rpg",
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 8014,
    [string]$RepositoryBackend = "sqlite",
    [string]$LMStudioBaseUrl = "http://127.0.0.1:1234",
    [string]$LMStudioModel = "current",
    [string]$LMStudioExtractorModel = "current",
    [string]$LMStudioApiKey = "",
    [switch]$UseEnvironmentApiKey,
    [double]$LMStudioTimeoutSeconds = 120,
    [int]$LMStudioNarrationMaxTokens = 220,
    [int]$LMStudioExtractorMaxTokens = 220,
    [int]$LMStudioSummaryMaxTokens = 420
)

$backendRoot = Join-Path $RepoRoot "backend"
$pythonExe = Join-Path $backendRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
    Write-Error "Backend Python executable not found: $pythonExe"
    exit 1
}

$env:ST_LLM_RPG_REPOSITORY = $RepositoryBackend
$env:LM_STUDIO_BASE_URL = $LMStudioBaseUrl
$env:LM_STUDIO_MODEL = $LMStudioModel
$env:LM_STUDIO_EXTRACTOR_MODEL = $LMStudioExtractorModel
$env:LM_STUDIO_TIMEOUT_SECONDS = [string]$LMStudioTimeoutSeconds
$env:LM_STUDIO_NARRATION_MAX_TOKENS = [string]$LMStudioNarrationMaxTokens
$env:LM_STUDIO_EXTRACTOR_MAX_TOKENS = [string]$LMStudioExtractorMaxTokens
$env:LM_STUDIO_SUMMARY_MAX_TOKENS = [string]$LMStudioSummaryMaxTokens

$resolvedApiKey = $null
$authMode = "no LM Studio auth header"

if ($LMStudioApiKey) {
    $env:LM_STUDIO_API_KEY = $LMStudioApiKey
    Remove-Item Env:LM_API_TOKEN -ErrorAction SilentlyContinue
    $authMode = "explicit textbox key"
} elseif ($UseEnvironmentApiKey) {
    foreach ($candidate in @(
        [Environment]::GetEnvironmentVariable("LM_STUDIO_API_KEY", "Process"),
        [Environment]::GetEnvironmentVariable("LM_STUDIO_API_KEY", "User"),
        [Environment]::GetEnvironmentVariable("LM_STUDIO_API_KEY", "Machine"),
        [Environment]::GetEnvironmentVariable("LM_API_TOKEN", "Process"),
        [Environment]::GetEnvironmentVariable("LM_API_TOKEN", "User"),
        [Environment]::GetEnvironmentVariable("LM_API_TOKEN", "Machine")
    )) {
        if ($candidate) {
            $resolvedApiKey = $candidate
            break
        }
    }

    if ($resolvedApiKey) {
        $env:LM_STUDIO_API_KEY = $resolvedApiKey
        Remove-Item Env:LM_API_TOKEN -ErrorAction SilentlyContinue
        $authMode = "environment key"
    } else {
        Remove-Item Env:LM_STUDIO_API_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:LM_API_TOKEN -ErrorAction SilentlyContinue
        $authMode = "environment key requested, but none found"
    }
} else {
    Remove-Item Env:LM_STUDIO_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:LM_API_TOKEN -ErrorAction SilentlyContinue
}

Push-Location $backendRoot
try {
    Write-Host "Starting backend in this visible console on http://$BindHost`:$Port"
    Write-Host "LM Studio auth mode: $authMode"
    Write-Host "LM Studio max tokens: narration=$LMStudioNarrationMaxTokens extractor=$LMStudioExtractorMaxTokens summary=$LMStudioSummaryMaxTokens"
    Write-Host "Press Ctrl+C in this window to stop the backend."
    & $pythonExe -m uvicorn app.main:app --host $BindHost --port $Port
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
