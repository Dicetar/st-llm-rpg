param(
    [string]$RepoRoot = "D:\Projects\st-llm-rpg",
    [string]$SillyTavernRoot = "D:\Ollama\STavern\SillyTavern",
    [string]$SillyTavernExtensionDir = "",
    [string]$BackendBindHost = "127.0.0.1",
    [int]$BackendPort = 8014,
    [int]$SillyTavernPort = 8000,
    [string]$RepositoryBackend = "sqlite",
    [string]$LMStudioBaseUrl = "http://127.0.0.1:1234",
    [string]$LMStudioModel = "current",
    [string]$LMStudioExtractorModel = "current",
    [double]$LMStudioTimeoutSeconds = 120,
    [int]$LMStudioNarrationMaxTokens = 220,
    [int]$LMStudioExtractorMaxTokens = 220,
    [int]$LMStudioSummaryMaxTokens = 420
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not $SillyTavernExtensionDir) {
    $SillyTavernExtensionDir = Join-Path $SillyTavernRoot "public\scripts\extensions\third-party\llm-rpg-bridge"
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$powershellExe = (Get-Command powershell.exe).Source
$script:logBox = $null
$script:statusLabels = @{}
$script:controls = @{}

function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )

    $timestamp = Get-Date -Format "HH:mm:ss"
    $line = "[{0}] [{1}] {2}" -f $timestamp, $Level, $Message
    if ($script:logBox) {
        $script:logBox.AppendText($line + [Environment]::NewLine)
        $script:logBox.SelectionStart = $script:logBox.TextLength
        $script:logBox.ScrollToCaret()
    } else {
        Write-Host $line
    }
}

function Get-EnvApiKey {
    $candidates = @(
        [Environment]::GetEnvironmentVariable("LM_STUDIO_API_KEY", "Process"),
        [Environment]::GetEnvironmentVariable("LM_STUDIO_API_KEY", "User"),
        [Environment]::GetEnvironmentVariable("LM_STUDIO_API_KEY", "Machine"),
        [Environment]::GetEnvironmentVariable("LM_API_TOKEN", "Process"),
        [Environment]::GetEnvironmentVariable("LM_API_TOKEN", "User"),
        [Environment]::GetEnvironmentVariable("LM_API_TOKEN", "Machine")
    )

    foreach ($candidate in $candidates) {
        if ($candidate) {
            return [string]$candidate
        }
    }

    return ""
}

function Save-UserEnvApiKey {
    param([string]$Value)

    if ($Value) {
        [Environment]::SetEnvironmentVariable("LM_STUDIO_API_KEY", $Value, "User")
        [Environment]::SetEnvironmentVariable("LM_API_TOKEN", $null, "User")
        $env:LM_STUDIO_API_KEY = $Value
    } else {
        [Environment]::SetEnvironmentVariable("LM_STUDIO_API_KEY", $null, "User")
        [Environment]::SetEnvironmentVariable("LM_API_TOKEN", $null, "User")
        Remove-Item Env:LM_STUDIO_API_KEY -ErrorAction SilentlyContinue
    }
    Remove-Item Env:LM_API_TOKEN -ErrorAction SilentlyContinue
}

function Clear-UserEnvApiKey {
    [Environment]::SetEnvironmentVariable("LM_STUDIO_API_KEY", $null, "User")
    [Environment]::SetEnvironmentVariable("LM_API_TOKEN", $null, "User")
    Remove-Item Env:LM_STUDIO_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:LM_API_TOKEN -ErrorAction SilentlyContinue
}

function Get-PortListenerInfo {
    param([int]$Port)

    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if (-not $connection) {
        return [pscustomobject]@{
            Listening  = $false
            Port       = $Port
            ProcessId  = $null
            ProcessName = $null
        }
    }

    $processName = $null
    try {
        $processName = (Get-Process -Id $connection.OwningProcess -ErrorAction Stop).ProcessName
    } catch {
        $processName = "unknown"
    }

    return [pscustomobject]@{
        Listening   = $true
        Port        = $Port
        ProcessId   = $connection.OwningProcess
        ProcessName = $processName
    }
}

function Stop-ListeningProcess {
    param([int]$Port)

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique

    if (-not $listeners) {
        Write-Log "No listener found on port $Port." "INFO"
        return
    }

    foreach ($procId in $listeners) {
        $processName = "unknown"
        try {
            $processName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName
        } catch {
            $processName = "unknown"
        }
        Stop-Process -Id $procId -Force
        Write-Log "Stopped PID $procId ($processName) on port $Port." "INFO"
    }
}

function Invoke-RepoScript {
    param(
        [string]$ScriptName,
        [hashtable]$Arguments
    )

    $scriptPath = Join-Path $scriptRoot $ScriptName
    $output = & $scriptPath @Arguments *>&1
    foreach ($line in $output) {
        Write-Log ([string]$line) "INFO"
    }
}

function Start-VisibleRepoScript {
    param(
        [string]$ScriptName,
        [hashtable]$Arguments,
        [string]$WorkingDirectory
    )

    $scriptPath = Join-Path $scriptRoot $ScriptName
    $argumentList = @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        $scriptPath
    )

    foreach ($key in $Arguments.Keys) {
        $value = $Arguments[$key]
        if ($value -is [bool]) {
            if ($value) {
                $argumentList += "-$key"
            }
            continue
        }
        if ($value -is [System.Management.Automation.SwitchParameter]) {
            if ($value.IsPresent) {
                $argumentList += "-$key"
            }
            continue
        }
        if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
            continue
        }
        $argumentList += "-$key"
        $argumentList += [string]$value
    }

    Start-Process -FilePath $powershellExe -ArgumentList $argumentList -WorkingDirectory $WorkingDirectory | Out-Null
    Write-Log "Launched $ScriptName in a visible console." "INFO"
}

function Get-BackendArguments {
    $args = @{
        RepoRoot               = $script:controls.RepoRoot.Text.Trim()
        BindHost               = $script:controls.BackendBindHost.Text.Trim()
        Port                   = [int]$script:controls.BackendPort.Value
        RepositoryBackend      = $script:controls.RepositoryBackend.Text
        LMStudioBaseUrl        = $script:controls.LMStudioBaseUrl.Text.Trim()
        LMStudioModel          = $script:controls.LMStudioModel.Text.Trim()
        LMStudioExtractorModel = $script:controls.LMStudioExtractorModel.Text.Trim()
        LMStudioTimeoutSeconds = [double]$script:controls.LMStudioTimeoutSeconds.Value
        LMStudioNarrationMaxTokens = [int]$script:controls.LMStudioNarrationMaxTokens.Value
        LMStudioExtractorMaxTokens = [int]$script:controls.LMStudioExtractorMaxTokens.Value
        LMStudioSummaryMaxTokens   = [int]$LMStudioSummaryMaxTokens
    }

    $explicitApiKey = $script:controls.LMStudioApiKey.Text
    if ($script:controls.UseEnvironmentApiKey.Checked) {
        $args.UseEnvironmentApiKey = $true
    } elseif (-not [string]::IsNullOrWhiteSpace($explicitApiKey)) {
        $args.LMStudioApiKey = $explicitApiKey
    }

    return $args
}

function Update-AuthControls {
    $envApiKey = Get-EnvApiKey
    $usingEnv = [bool]$script:controls.UseEnvironmentApiKey.Checked
    $explicitApiKey = $script:controls.LMStudioApiKey.Text.Trim()

    $script:controls.LMStudioApiKey.Enabled = -not $usingEnv
    $script:controls.LoadEnv.Enabled = -not $usingEnv
    $script:controls.SaveEnv.Enabled = -not $usingEnv

    $script:statusLabels.EnvKey.Text = if ($envApiKey) {
        "LM env key: user/process env is set"
    } else {
        "LM env key: user/process env is not set"
    }

    $script:statusLabels.AuthMode.Text = if ($usingEnv) {
        if ($envApiKey) {
            "Launch auth: environment key"
        } else {
            "Launch auth: environment key selected, but no env key is set"
        }
    } elseif ($explicitApiKey) {
        "Launch auth: explicit textbox key"
    } else {
        "Launch auth: no LM Studio auth header"
    }
}

function Refresh-Statuses {
    $backendInfo = Get-PortListenerInfo -Port ([int]$script:controls.BackendPort.Value)
    $stInfo = Get-PortListenerInfo -Port ([int]$script:controls.SillyTavernPort.Value)

    $script:statusLabels.Backend.Text = if ($backendInfo.Listening) {
        "Backend: listening on {0} (PID {1}, {2})" -f $backendInfo.Port, $backendInfo.ProcessId, $backendInfo.ProcessName
    } else {
        "Backend: not listening on {0}" -f $backendInfo.Port
    }

    $script:statusLabels.SillyTavern.Text = if ($stInfo.Listening) {
        "SillyTavern: listening on {0} (PID {1}, {2})" -f $stInfo.Port, $stInfo.ProcessId, $stInfo.ProcessName
    } else {
        "SillyTavern: not listening on {0}" -f $stInfo.Port
    }

    Update-AuthControls
}

function Invoke-UiAction {
    param([scriptblock]$Action)

    try {
        & $Action
        Refresh-Statuses
    } catch {
        Write-Log $_.Exception.Message "ERROR"
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            "LLM RPG Control Panel",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "ST LLM RPG Control Panel"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(980, 830)
$form.MinimumSize = New-Object System.Drawing.Size(980, 830)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$mainPanel = New-Object System.Windows.Forms.TableLayoutPanel
$mainPanel.Dock = "Fill"
$mainPanel.Padding = New-Object System.Windows.Forms.Padding(10)
$mainPanel.ColumnCount = 1
$mainPanel.RowCount = 5
$mainPanel.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 130)))
$mainPanel.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 230)))
$mainPanel.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 140)))
$mainPanel.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 120)))
$mainPanel.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$form.Controls.Add($mainPanel)

$pathsGroup = New-Object System.Windows.Forms.GroupBox
$pathsGroup.Text = "Paths"
$pathsGroup.Dock = "Fill"
$pathsLayout = New-Object System.Windows.Forms.TableLayoutPanel
$pathsLayout.Dock = "Fill"
$pathsLayout.Padding = New-Object System.Windows.Forms.Padding(8)
$pathsLayout.ColumnCount = 2
$pathsLayout.RowCount = 3
$pathsLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 190)))
$pathsLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$pathsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 30)))
$pathsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 30)))
$pathsLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 30)))
$pathsGroup.Controls.Add($pathsLayout)

foreach ($labelText in @("Repo root", "SillyTavern root", "Extension runtime dir")) {
    $rowIndex = $pathsLayout.Controls.Count / 2
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $labelText
    $label.AutoSize = $true
    $label.Anchor = "Left"
    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Dock = "Fill"
    $pathsLayout.Controls.Add($label, 0, [int]$rowIndex)
    $pathsLayout.Controls.Add($textBox, 1, [int]$rowIndex)

    switch ($labelText) {
        "Repo root" { $script:controls.RepoRoot = $textBox; $textBox.Text = $RepoRoot }
        "SillyTavern root" { $script:controls.SillyTavernRoot = $textBox; $textBox.Text = $SillyTavernRoot }
        "Extension runtime dir" { $script:controls.SillyTavernExtensionDir = $textBox; $textBox.Text = $SillyTavernExtensionDir }
    }
}
$mainPanel.Controls.Add($pathsGroup, 0, 0)

$backendGroup = New-Object System.Windows.Forms.GroupBox
$backendGroup.Text = "Backend and LM Studio"
$backendGroup.Dock = "Fill"
$backendLayout = New-Object System.Windows.Forms.TableLayoutPanel
$backendLayout.Dock = "Fill"
$backendLayout.Padding = New-Object System.Windows.Forms.Padding(8)
$backendLayout.ColumnCount = 4
$backendLayout.RowCount = 5
foreach ($width in @(150, 280, 150, 280)) {
    $backendLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, $width)))
}
$backendGroup.Controls.Add($backendLayout)

function Add-TextField {
    param(
        [int]$Row,
        [int]$Column,
        [string]$LabelText,
        [string]$InitialValue,
        [string]$Key
    )

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $LabelText
    $label.AutoSize = $true
    $label.Anchor = "Left"
    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Dock = "Fill"
    $textBox.Text = $InitialValue
    $backendLayout.Controls.Add($label, $Column, $Row)
    $backendLayout.Controls.Add($textBox, $Column + 1, $Row)
    $script:controls[$Key] = $textBox
}

Add-TextField -Row 0 -Column 0 -LabelText "Bind host" -InitialValue $BackendBindHost -Key "BackendBindHost"
Add-TextField -Row 1 -Column 0 -LabelText "LM base URL" -InitialValue $LMStudioBaseUrl -Key "LMStudioBaseUrl"
Add-TextField -Row 2 -Column 0 -LabelText "Narrator model" -InitialValue $LMStudioModel -Key "LMStudioModel"
Add-TextField -Row 3 -Column 0 -LabelText "Extractor model" -InitialValue $LMStudioExtractorModel -Key "LMStudioExtractorModel"

$backendPortLabel = New-Object System.Windows.Forms.Label
$backendPortLabel.Text = "Backend port"
$backendPortLabel.AutoSize = $true
$backendPortLabel.Anchor = "Left"
$backendPortNumeric = New-Object System.Windows.Forms.NumericUpDown
$backendPortNumeric.Minimum = 1
$backendPortNumeric.Maximum = 65535
$backendPortNumeric.Value = $BackendPort
$backendPortNumeric.Dock = "Left"
$backendPortNumeric.Width = 120
$backendLayout.Controls.Add($backendPortLabel, 2, 0)
$backendLayout.Controls.Add($backendPortNumeric, 3, 0)
$script:controls.BackendPort = $backendPortNumeric

$repoBackendLabel = New-Object System.Windows.Forms.Label
$repoBackendLabel.Text = "Repository backend"
$repoBackendLabel.AutoSize = $true
$repoBackendLabel.Anchor = "Left"
$repoBackendCombo = New-Object System.Windows.Forms.ComboBox
$repoBackendCombo.DropDownStyle = "DropDownList"
[void]$repoBackendCombo.Items.AddRange(@("sqlite", "json"))
$repoBackendCombo.SelectedItem = if ($RepositoryBackend -eq "json") { "json" } else { "sqlite" }
$backendLayout.Controls.Add($repoBackendLabel, 2, 1)
$backendLayout.Controls.Add($repoBackendCombo, 3, 1)
$script:controls.RepositoryBackend = $repoBackendCombo

$timeoutLabel = New-Object System.Windows.Forms.Label
$timeoutLabel.Text = "LM timeout seconds"
$timeoutLabel.AutoSize = $true
$timeoutLabel.Anchor = "Left"
$timeoutNumeric = New-Object System.Windows.Forms.NumericUpDown
$timeoutNumeric.Minimum = 5
$timeoutNumeric.Maximum = 600
$timeoutNumeric.DecimalPlaces = 0
$timeoutNumeric.Value = [decimal]$LMStudioTimeoutSeconds
$timeoutNumeric.Dock = "Left"
$timeoutNumeric.Width = 120
$backendLayout.Controls.Add($timeoutLabel, 2, 2)
$backendLayout.Controls.Add($timeoutNumeric, 3, 2)
$script:controls.LMStudioTimeoutSeconds = $timeoutNumeric

$stPortLabel = New-Object System.Windows.Forms.Label
$stPortLabel.Text = "SillyTavern port"
$stPortLabel.AutoSize = $true
$stPortLabel.Anchor = "Left"
$stPortNumeric = New-Object System.Windows.Forms.NumericUpDown
$stPortNumeric.Minimum = 1
$stPortNumeric.Maximum = 65535
$stPortNumeric.Value = $SillyTavernPort
$stPortNumeric.Dock = "Left"
$stPortNumeric.Width = 120
$backendLayout.Controls.Add($stPortLabel, 2, 3)
$backendLayout.Controls.Add($stPortNumeric, 3, 3)
$script:controls.SillyTavernPort = $stPortNumeric

$narrationMaxLabel = New-Object System.Windows.Forms.Label
$narrationMaxLabel.Text = "Narrator max tokens"
$narrationMaxLabel.AutoSize = $true
$narrationMaxLabel.Anchor = "Left"
$narrationMaxNumeric = New-Object System.Windows.Forms.NumericUpDown
$narrationMaxNumeric.Minimum = 0
$narrationMaxNumeric.Maximum = 4096
$narrationMaxNumeric.Value = $LMStudioNarrationMaxTokens
$narrationMaxNumeric.Dock = "Left"
$narrationMaxNumeric.Width = 120
$backendLayout.Controls.Add($narrationMaxLabel, 0, 4)
$backendLayout.Controls.Add($narrationMaxNumeric, 1, 4)
$script:controls.LMStudioNarrationMaxTokens = $narrationMaxNumeric

$extractorMaxLabel = New-Object System.Windows.Forms.Label
$extractorMaxLabel.Text = "Extractor max tokens"
$extractorMaxLabel.AutoSize = $true
$extractorMaxLabel.Anchor = "Left"
$extractorMaxNumeric = New-Object System.Windows.Forms.NumericUpDown
$extractorMaxNumeric.Minimum = 0
$extractorMaxNumeric.Maximum = 4096
$extractorMaxNumeric.Value = $LMStudioExtractorMaxTokens
$extractorMaxNumeric.Dock = "Left"
$extractorMaxNumeric.Width = 120
$backendLayout.Controls.Add($extractorMaxLabel, 2, 4)
$backendLayout.Controls.Add($extractorMaxNumeric, 3, 4)
$script:controls.LMStudioExtractorMaxTokens = $extractorMaxNumeric

$mainPanel.Controls.Add($backendGroup, 0, 1)

$authGroup = New-Object System.Windows.Forms.GroupBox
$authGroup.Text = "LM Studio Authentication"
$authGroup.Dock = "Fill"
$authLayout = New-Object System.Windows.Forms.TableLayoutPanel
$authLayout.Dock = "Fill"
$authLayout.Padding = New-Object System.Windows.Forms.Padding(8)
$authLayout.ColumnCount = 4
$authLayout.RowCount = 3
$authLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 190)))
$authLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$authLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 140)))
$authLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 140)))
$authGroup.Controls.Add($authLayout)

$apiKeyLabel = New-Object System.Windows.Forms.Label
$apiKeyLabel.Text = "Explicit LM API key"
$apiKeyLabel.AutoSize = $true
$apiKeyLabel.Anchor = "Left"
$apiKeyBox = New-Object System.Windows.Forms.TextBox
$apiKeyBox.Dock = "Fill"
$apiKeyBox.UseSystemPasswordChar = $true
$apiKeyBox.Text = ""
$authLayout.Controls.Add($apiKeyLabel, 0, 0)
$authLayout.Controls.Add($apiKeyBox, 1, 0)
$script:controls.LMStudioApiKey = $apiKeyBox

$showKeyCheck = New-Object System.Windows.Forms.CheckBox
$showKeyCheck.Text = "Show key"
$showKeyCheck.AutoSize = $true
$showKeyCheck.Anchor = "Left"
$showKeyCheck.add_CheckedChanged({
    $script:controls.LMStudioApiKey.UseSystemPasswordChar = -not $showKeyCheck.Checked
})
$authLayout.Controls.Add($showKeyCheck, 2, 0)

$useEnvCheck = New-Object System.Windows.Forms.CheckBox
$useEnvCheck.Text = "Use environment key"
$useEnvCheck.AutoSize = $true
$useEnvCheck.Checked = $false
$useEnvCheck.Anchor = "Left"
$authLayout.Controls.Add($useEnvCheck, 3, 0)
$script:controls.UseEnvironmentApiKey = $useEnvCheck

$envButtonsPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$envButtonsPanel.FlowDirection = "LeftToRight"
$envButtonsPanel.AutoSize = $true
$envButtonsPanel.WrapContents = $false
$envButtonsPanel.Dock = "Fill"

foreach ($buttonSpec in @(
    @{ Name = "Load Env"; Key = "LoadEnv" },
    @{ Name = "Save To User Env"; Key = "SaveEnv" },
    @{ Name = "Clear User Env"; Key = "ClearEnv" }
)) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $buttonSpec.Name
    $button.AutoSize = $true
    $envButtonsPanel.Controls.Add($button)
    $script:controls[$buttonSpec.Key] = $button
}

$authLayout.Controls.Add((New-Object System.Windows.Forms.Label -Property @{ Text = "Env actions"; AutoSize = $true; Anchor = "Left" }), 0, 1)
$authLayout.Controls.Add($envButtonsPanel, 1, 1)

$authHint = New-Object System.Windows.Forms.Label
$authHint.Text = "Checked = backend start/reset will deliberately load LM_STUDIO_API_KEY from env. Unchecked = use textbox or no auth."
$authHint.AutoSize = $true
$authHint.MaximumSize = New-Object System.Drawing.Size(880, 0)
$authLayout.Controls.Add($authHint, 0, 2)
$authLayout.SetColumnSpan($authHint, 4)

$mainPanel.Controls.Add($authGroup, 0, 2)

$actionsGroup = New-Object System.Windows.Forms.GroupBox
$actionsGroup.Text = "Actions"
$actionsGroup.Dock = "Fill"
$actionsLayout = New-Object System.Windows.Forms.FlowLayoutPanel
$actionsLayout.Dock = "Fill"
$actionsLayout.Padding = New-Object System.Windows.Forms.Padding(8)
$actionsLayout.AutoScroll = $true
$actionsGroup.Controls.Add($actionsLayout)

foreach ($buttonName in @(
    "Refresh Status",
    "Start Backend",
    "Reset Backend",
    "Stop Backend",
    "Reset Runtime",
    "Sync Extension",
    "Start SillyTavern",
    "Stop SillyTavern"
)) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $buttonName
    $button.AutoSize = $true
    $button.Margin = New-Object System.Windows.Forms.Padding(6)
    $actionsLayout.Controls.Add($button)
    $script:controls[$buttonName] = $button
}

$statusPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$statusPanel.FlowDirection = "TopDown"
$statusPanel.WrapContents = $false
$statusPanel.AutoSize = $true
$statusPanel.Margin = New-Object System.Windows.Forms.Padding(20, 6, 6, 6)
$actionsLayout.Controls.Add($statusPanel)

foreach ($name in @("Backend", "SillyTavern", "EnvKey", "AuthMode")) {
    $label = New-Object System.Windows.Forms.Label
    $label.AutoSize = $true
    $statusPanel.Controls.Add($label)
    $script:statusLabels[$name] = $label
}

$mainPanel.Controls.Add($actionsGroup, 0, 3)

$logGroup = New-Object System.Windows.Forms.GroupBox
$logGroup.Text = "Log"
$logGroup.Dock = "Fill"
$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = "Vertical"
$logBox.Dock = "Fill"
$logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$logGroup.Controls.Add($logBox)
$script:logBox = $logBox
$mainPanel.Controls.Add($logGroup, 0, 4)

$script:controls.LoadEnv.add_Click({
    Invoke-UiAction {
        $script:controls.LMStudioApiKey.Text = Get-EnvApiKey
        Write-Log "Loaded LM API key from environment into textbox."
    }
})

$script:controls.SaveEnv.add_Click({
    Invoke-UiAction {
        Save-UserEnvApiKey -Value $script:controls.LMStudioApiKey.Text
        Write-Log "Saved LM_STUDIO_API_KEY to user environment."
    }
})

$script:controls.ClearEnv.add_Click({
    Invoke-UiAction {
        Clear-UserEnvApiKey
        $script:controls.LMStudioApiKey.Text = ""
        $script:controls.UseEnvironmentApiKey.Checked = $false
        Write-Log "Cleared LM_STUDIO_API_KEY and LM_API_TOKEN from user/process environment."
    }
})

$script:controls.UseEnvironmentApiKey.add_CheckedChanged({
    Refresh-Statuses
})

$script:controls.LMStudioApiKey.add_TextChanged({
    Refresh-Statuses
})

$script:controls."Refresh Status".add_Click({
    Invoke-UiAction {
        Write-Log "Refreshed port and env status."
    }
})

$script:controls."Start Backend".add_Click({
    Invoke-UiAction {
        Start-VisibleRepoScript -ScriptName "start_backend_visible.ps1" -Arguments (Get-BackendArguments) -WorkingDirectory $script:controls.RepoRoot.Text.Trim()
    }
})

$script:controls."Reset Backend".add_Click({
    Invoke-UiAction {
        Start-VisibleRepoScript -ScriptName "reset_backend_visible.ps1" -Arguments (Get-BackendArguments) -WorkingDirectory $script:controls.RepoRoot.Text.Trim()
    }
})

$script:controls."Stop Backend".add_Click({
    Invoke-UiAction {
        Invoke-RepoScript -ScriptName "stop_backend.ps1" -Arguments @{ Port = [int]$script:controls.BackendPort.Value }
    }
})

$script:controls."Reset Runtime".add_Click({
    Invoke-UiAction {
        $confirmed = [System.Windows.Forms.MessageBox]::Show(
            "Reset backend/runtime now? This deletes current runtime state and all named saves under backend/runtime.",
            "Confirm runtime reset",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($confirmed -ne [System.Windows.Forms.DialogResult]::Yes) {
            Write-Log "Runtime reset cancelled."
            return
        }

        Invoke-RepoScript -ScriptName "reset_runtime_state.ps1" -Arguments @{ RepoRoot = $script:controls.RepoRoot.Text.Trim() }
    }
})

$script:controls."Sync Extension".add_Click({
    Invoke-UiAction {
        Invoke-RepoScript -ScriptName "sync_st_extension.ps1" -Arguments @{
            RepoRoot               = $script:controls.RepoRoot.Text.Trim()
            SillyTavernExtensionDir = $script:controls.SillyTavernExtensionDir.Text.Trim()
        }
    }
})

$script:controls."Start SillyTavern".add_Click({
    Invoke-UiAction {
        $stRoot = $script:controls.SillyTavernRoot.Text.Trim()
        $startBat = Join-Path $stRoot "Start.bat"
        if (-not (Test-Path $startBat)) {
            throw "SillyTavern launcher not found: $startBat"
        }
        Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", "Start.bat") -WorkingDirectory $stRoot | Out-Null
        Write-Log "Launched SillyTavern Start.bat in a visible console."
    }
})

$script:controls."Stop SillyTavern".add_Click({
    Invoke-UiAction {
        Stop-ListeningProcess -Port ([int]$script:controls.SillyTavernPort.Value)
    }
})

$statusTimer = New-Object System.Windows.Forms.Timer
$statusTimer.Interval = 3000
$statusTimer.add_Tick({ Refresh-Statuses })
$statusTimer.Start()

$form.add_Shown({
    Refresh-Statuses
    Write-Log "Control panel ready."
})

[void]$form.ShowDialog()
