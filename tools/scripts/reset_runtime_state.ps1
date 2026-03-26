param(
    [string]$RepoRoot = "D:\Projects\st-llm-rpg"
)

$paths = @(
    "backend\data\character_state.safe.json",
    "backend\data\item_registry.json",
    "backend\data\spell_registry.json",
    "backend\storage\event_log.jsonl",
    "backend\storage\journal_entries.jsonl"
)

Push-Location $RepoRoot
try {
    foreach ($relativePath in $paths) {
        git restore --source=HEAD -- $relativePath
    }
    Write-Host "Runtime state reset to HEAD for tracked backend files."
} finally {
    Pop-Location
}
