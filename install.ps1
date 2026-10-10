[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\Codex Theme'),
    [string]$AppExecutable,
    [string]$NodeExecutable,
    [string]$SourceProfileDirectory,
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Work_to_Codex\install.ps1') @PSBoundParameters
