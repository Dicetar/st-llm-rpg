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

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $scriptRoot "stop_backend.ps1") -Port $Port
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& (Join-Path $scriptRoot "start_backend_visible.ps1") `
    -RepoRoot $RepoRoot `
    -BindHost $BindHost `
    -Port $Port `
    -RepositoryBackend $RepositoryBackend `
    -LMStudioBaseUrl $LMStudioBaseUrl `
    -LMStudioModel $LMStudioModel `
    -LMStudioExtractorModel $LMStudioExtractorModel `
    -LMStudioApiKey $LMStudioApiKey `
    -UseEnvironmentApiKey:$UseEnvironmentApiKey `
    -LMStudioTimeoutSeconds $LMStudioTimeoutSeconds `
    -LMStudioNarrationMaxTokens $LMStudioNarrationMaxTokens `
    -LMStudioExtractorMaxTokens $LMStudioExtractorMaxTokens `
    -LMStudioSummaryMaxTokens $LMStudioSummaryMaxTokens

exit $LASTEXITCODE
