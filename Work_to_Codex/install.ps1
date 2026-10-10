[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\Codex Theme'),
    [string]$AppExecutable,
    [string]$NodeExecutable,
    [string]$SourceProfileDirectory,
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This installer requires Windows.' }
if (-not $NodeExecutable) { $NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source }
$NodeExecutable = (Resolve-Path -LiteralPath $NodeExecutable).Path
& $NodeExecutable -e 'process.exit(parseInt(process.versions.node)>=22?0:1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or later is required.' }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$runtimeDirectory = Join-Path $InstallDirectory 'runtime'
$profileDirectory = Join-Path $InstallDirectory 'profile'
$requiredFiles = @('codex-theme.mjs', 'windows-host.mjs', 'windows-packaged-launch.mjs', 'activate-packaged-app.ps1', 'migrate-profile.ps1', 'Codex.ico', 'image.jpg', 'fire.gif', 'Launch Codex Theme.ps1', 'Launch Codex Theme.cmd')
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
# Keep the Node runtime inside the installation rather than relying on a
# development checkout or a cache owned by another application.
$nodeVersion = & $NodeExecutable -p 'process.versions.node'
$nodeHash = (Get-FileHash -LiteralPath $NodeExecutable -Algorithm SHA256).Hash.Substring(0, 12)
$installedNode = Join-Path $runtimeDirectory ("node-$nodeVersion-$nodeHash.exe")
if (-not (Test-Path -LiteralPath $installedNode)) { Copy-Item -LiteralPath $NodeExecutable -Destination $installedNode }
$NodeExecutable = $installedNode
$existingSettingsPath = Join-Path $runtimeDirectory 'windows-settings.json'
if (-not $SourceProfileDirectory -and (Test-Path -LiteralPath $existingSettingsPath)) {
    $existingSettings = Get-Content -LiteralPath $existingSettingsPath -Raw | ConvertFrom-Json
    $SourceProfileDirectory = $existingSettings.SourceProfileDirectory
}
if (-not $SourceProfileDirectory -and -not (Test-Path -LiteralPath $profileDirectory)) {
    $legacyProfile = Join-Path $env:LOCALAPPDATA 'Codex Theme\profile'
    if (Test-Path -LiteralPath $legacyProfile -PathType Container) { $SourceProfileDirectory = $legacyProfile }
}
if ($SourceProfileDirectory) {
    $SourceProfileDirectory = (Resolve-Path -LiteralPath $SourceProfileDirectory).Path
    & (Join-Path $runtimeDirectory 'migrate-profile.ps1') -SourceDirectory $SourceProfileDirectory -DestinationDirectory $profileDirectory -AllowRunningSnapshot
}
# Machine-specific settings stay outside the repository. AppExecutable is unset
# by default so Store package updates are resolved on every launch.
$machineSettings = @{
    NodeExecutable = $NodeExecutable
    AppExecutable = $AppExecutable
    ProfileDirectory = $profileDirectory
}
if ($SourceProfileDirectory) { $machineSettings.SourceProfileDirectory = $SourceProfileDirectory }
$machineSettings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'windows-settings.json') -Encoding UTF8
if ($SourceProfileDirectory) {
    $migrationScript = Join-Path $runtimeDirectory 'migrate-profile.ps1'
    $migrationSettings = Join-Path $runtimeDirectory 'windows-settings.json'
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -WindowStyle Hidden -ArgumentList @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $migrationScript + '"'),
        '-SettingsPath', ('"' + $migrationSettings + '"'), '-Watch'
    ) -RedirectStandardOutput (Join-Path $runtimeDirectory 'profile-migration.log') -RedirectStandardError (Join-Path $runtimeDirectory 'profile-migration-error.log') | Out-Null
}
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
    $shortcut.IconLocation = (Join-Path $runtimeDirectory 'Codex.ico') + ',0'
    $shortcut.Save()
}
Write-Output "Installed Codex Theme: $runtimeDirectory"
Write-Output "Launch: $runtimeDirectory\Launch Codex Theme.cmd"
if ($SourceProfileDirectory) { Write-Output 'Your previous profile will finish copying after the running app closes.' }
else { Write-Output 'The separate theme profile requires sign-in on first launch.' }
