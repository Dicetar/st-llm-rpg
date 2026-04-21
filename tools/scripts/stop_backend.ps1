param(
    [int]$Port = 8014
)

$processIds = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

if (-not $processIds) {
    Write-Host "No process is listening on port $Port."
    exit 0
}

foreach ($procId in $processIds) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.Name } else { "unknown" }
    Write-Host "Stopping PID $procId ($name) on port $Port"
    Stop-Process -Id $procId -Force
}

Start-Sleep -Milliseconds 250

$remaining = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Error "Port $Port is still in use after stop request."
    exit 1
}

Write-Host "Port $Port is clear."
