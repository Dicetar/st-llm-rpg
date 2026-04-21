param(
    [string]$RepoRoot = "D:\Projects\st-llm-rpg"
)

$resolvedRepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedRepoRoot "backend\runtime"))
$expectedBackendRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedRepoRoot "backend"))

if (-not $runtimeRoot.StartsWith($expectedBackendRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Error "Refusing to reset runtime outside backend root: $runtimeRoot"
    exit 1
}

if (Test-Path $runtimeRoot) {
    Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
}

New-Item -ItemType Directory -Path (Join-Path $runtimeRoot "data") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $runtimeRoot "storage") -Force | Out-Null

Write-Host "Reset backend runtime at: $runtimeRoot"
Write-Host "The backend will bootstrap fresh runtime state from backend/data/seed/ on next start."
