[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Codex Theme'),
    [string]$AppExecutable,
    [string]$NodeExecutable,
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This installer requires Windows.' }
if (-not $NodeExecutable) { $NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source }
$NodeExecutable = (Resolve-Path -LiteralPath $NodeExecutable).Path
& $NodeExecutable -e 'process.exit(parseInt(process.versions.node)>=20?0:1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 20 or later is required.' }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$runtimeDirectory = Join-Path $InstallDirectory 'runtime'
$profileDirectory = Join-Path $InstallDirectory 'profile'
$requiredFiles = @('codex-theme.mjs', 'windows-host.mjs', 'image.jpg', 'fire.gif', 'Launch Codex Theme.ps1', 'Launch Codex Theme.cmd')
foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $file) -PathType Leaf)) { throw "Missing file: $file" }
}
# Validate the source and app detection before changing an existing installation.
$checkArguments = @((Join-Path $PSScriptRoot 'codex-theme.mjs'), '--dry-run', '--profile', $profileDirectory)
if ($AppExecutable) { $checkArguments += @('--app', $AppExecutable) }
& $NodeExecutable @checkArguments
if ($LASTEXITCODE -ne 0) { throw 'App or theme validation failed; installation was not changed.' }
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
foreach ($file in $requiredFiles) {
    $source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot $file)).Path
    $destination = Join-Path $runtimeDirectory $file
    if ($source -ne $destination) { Copy-Item -LiteralPath $source -Destination $destination -Force }
}
# Machine-specific settings stay outside the repository. AppExecutable is unset
# by default so Store package updates are resolved on every launch.
@{
    NodeExecutable = $NodeExecutable
    AppExecutable = $AppExecutable
    ProfileDirectory = $profileDirectory
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'windows-settings.json') -Encoding UTF8
if (-not $NoShortcut) {
    $programs = [Environment]::GetFolderPath('Programs')
    if (-not $programs) { throw 'The current user Start Menu location is unavailable. Use -NoShortcut.' }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $programs 'Codex Theme.lnk'))
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $launcher = Join-Path $runtimeDirectory 'Launch Codex Theme.ps1'
    $shortcut.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
    $shortcut.WorkingDirectory = $runtimeDirectory
    $shortcut.Description = 'Codex with the custom wallpaper and UI theme'
    $shortcut.Save()
}
Write-Output "Installed Codex Theme: $runtimeDirectory"
Write-Output "Launch: $runtimeDirectory\Launch Codex Theme.cmd"
Write-Output 'The separate theme profile requires sign-in on first launch.'
