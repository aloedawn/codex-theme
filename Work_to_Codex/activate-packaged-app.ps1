[CmdletBinding()]
param(
    [string]$AppExecutable,
    [string]$ArgumentsJson,
    [int]$InspectProcessId,
    [switch]$CheckRunningOnly
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace ThemePackageActivation {
    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IApplicationActivationManager {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string args, uint options, out uint pid);
        [PreserveSig] int ActivateForFile(IntPtr items, string verb, out uint pid);
        [PreserveSig] int ActivateForProtocol(IntPtr items, out uint pid);
    }
    public static class Native {
        [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetPackageFamilyName(IntPtr process, ref uint length, StringBuilder name);
        public static string Family(uint pid) {
            IntPtr handle = OpenProcess(0x1000, false, pid);
            if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            try {
                uint length=0; int result=GetPackageFamilyName(handle, ref length, null);
                if (result==15700) return null;
                if (result!=122) throw new System.ComponentModel.Win32Exception(result);
                var name=new StringBuilder((int)length);
                result=GetPackageFamilyName(handle, ref length, name);
                if (result!=0) throw new System.ComponentModel.Win32Exception(result);
                return name.ToString();
            } finally { CloseHandle(handle); }
        }
        public static uint Activate(string id, string args) {
            object instance=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c")));
            try {
                uint pid; int result=((IApplicationActivationManager)instance).ActivateApplication(id, args, 2, out pid);
                Marshal.ThrowExceptionForHR(result); return pid;
            } finally { Marshal.ReleaseComObject(instance); }
        }
    }
}
'@
if ($InspectProcessId) {
    @{ ProcessId=$InspectProcessId; PackageFamilyName=[ThemePackageActivation.Native]::Family($InspectProcessId) } | ConvertTo-Json -Compress
    return
}
function Quote-NativeArgument([string]$Value) {
    '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
$taskExecutable = [IO.Path]::GetFullPath($AppExecutable)
$taskPackage = Get-AppxPackage | Where-Object {
    $_.Name -in @('OpenAI.Codex', 'OpenAI.ChatGPT') -and
    $taskExecutable.StartsWith($_.InstallLocation.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
} | Select-Object -First 1
if (-not $taskPackage) { throw 'The selected app is not a registered OpenAI Windows package.' }
# Separate Chromium profiles still share the Codex installation ID. A second
# app-server cannot register remote control while the first one owns it (409).
$taskRunningApps = @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe' OR Name='Codex.exe'" | Where-Object {
    $_.CommandLine -notmatch '(?:^|\s)--type=' -and
    $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith($taskPackage.InstallLocation.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
})
if ($taskRunningApps.Count -gt 0) {
    throw 'Codex/ChatGPT is already running. After its tasks finish, fully quit it before starting Codex Theme. Running both apps causes remote control to fail with HTTP 409 (Remote app server already online).'
}
if ($CheckRunningOnly) { return }
[xml]$taskManifest = Get-Content -LiteralPath (Join-Path $taskPackage.InstallLocation 'AppxManifest.xml') -Raw
$taskApplication = @($taskManifest.Package.Applications.Application) | Where-Object {
    $_.Executable -and [IO.Path]::GetFullPath((Join-Path $taskPackage.InstallLocation $_.Executable)) -eq $taskExecutable
} | Select-Object -First 1
if (-not $taskApplication) { throw 'The app executable is not a registered package entry point.' }
$taskAppId = $taskPackage.PackageFamilyName + '!' + $taskApplication.Id
$taskArgs = Get-Content -LiteralPath $ArgumentsJson -Raw | ConvertFrom-Json
$taskArgumentLine = ($taskArgs | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join ' '
$taskActivatedPid = [ThemePackageActivation.Native]::Activate($taskAppId, $taskArgumentLine)
$taskFamily = [ThemePackageActivation.Native]::Family($taskActivatedPid)
if ($taskFamily -ne $taskPackage.PackageFamilyName) {
    throw 'A previously running unpackaged app was reused. Fully quit ChatGPT before launching the theme again.'
}
@{ ProcessId=$taskActivatedPid; PackageFamilyName=$taskFamily; AppId=$taskAppId } | ConvertTo-Json -Compress
