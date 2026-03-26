param(
    [string]$RepoRoot = "D:\Projects\st-llm-rpg",
    [string]$SillyTavernExtensionDir = "D:\Ollama\STavern\SillyTavern\data\default-user\extensions\llm-rpg-bridge"
)

$source = Join-Path $RepoRoot "frontend-extension\llm-rpg-bridge"
$destination = $SillyTavernExtensionDir

if (-not (Test-Path $source)) {
    Write-Error "Source extension folder not found: $source"
    exit 1
}

if (-not (Test-Path $destination)) {
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
}

robocopy $source $destination /MIR /NFL /NDL /NJH /NJS /NP | Out-Null

if ($LASTEXITCODE -gt 7) {
    Write-Error "robocopy failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "SillyTavern extension synced to: $destination"
