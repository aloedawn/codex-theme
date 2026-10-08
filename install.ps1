[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Codex Theme'),
    [string]$AppExecutable,
    [string]$NodeExecutable,
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Work_to_Codex\install.ps1') @PSBoundParameters
