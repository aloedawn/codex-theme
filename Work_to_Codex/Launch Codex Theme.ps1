[CmdletBinding()]
param(
    [string]$AppExecutable,
    [string]$ProfileDirectory,
    [switch]$Console
)
$ErrorActionPreference = 'Stop'

function ConvertTo-NativeArgument([string]$Value) {
    # Quote according to CommandLineToArgvW/CRT rules, including trailing slashes.
    '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

$settingsPath = Join-Path $PSScriptRoot 'windows-settings.json'
$settings = if (Test-Path -LiteralPath $settingsPath) {
    Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
} else { $null }
if ($settings -and $settings.SourceProfileDirectory) {
    try { & (Join-Path $PSScriptRoot 'migrate-profile.ps1') -SettingsPath $settingsPath }
    catch {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Codex Theme', 'OK', 'Warning') | Out-Null
        throw
    }
}
$nodePath = if ($settings -and $settings.NodeExecutable -and (Test-Path -LiteralPath $settings.NodeExecutable)) {
    $settings.NodeExecutable
} else { (Get-Command node.exe -ErrorAction Stop).Source }
if (-not $AppExecutable -and $settings) { $AppExecutable = $settings.AppExecutable }
if (-not $ProfileDirectory -and $settings) { $ProfileDirectory = $settings.ProfileDirectory }
$arguments = @((Join-Path $PSScriptRoot 'codex-theme.mjs'))
if ($AppExecutable) { $arguments += @('--app', $AppExecutable) }
if ($ProfileDirectory) { $arguments += @('--profile', $ProfileDirectory) }

if ($Console) {
    & $nodePath @arguments
    if ($LASTEXITCODE -ne 0) { throw "Codex Theme exited with code $LASTEXITCODE" }
    return
}
$logDirectory = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
# Keep separate logs for each launch attempt.
$logId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$stdoutPath = Join-Path $logDirectory "$logId.log"
$stderrPath = Join-Path $logDirectory "$logId-error.log"
$worker = Start-Process -FilePath $nodePath -ArgumentList (($arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ') `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Milliseconds 2000
$worker.Refresh()
if ($worker.HasExited -and $worker.ExitCode -ne 0) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "Codex Theme did not start. If Codex/ChatGPT is already open, finish its tasks and fully quit it before launching the theme. Running both apps can prevent remote control from connecting.`n`nDetails: $stderrPath",
        'Codex Theme', 'OK', 'Warning'
    ) | Out-Null
    throw "Codex Theme did not start. See $stderrPath"
}
Write-Output "Codex Theme worker: $($worker.Id). Logs: $stdoutPath"
