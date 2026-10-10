// Windows host integration. No writes, elevation, or app-bundle patches.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function windowsPaths(env = process.env, home = os.homedir()) {
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const root = path.join(local, "Programs", "Codex Theme");
  return { root, profile: path.join(root, "profile"), local };
}

function isFile(filename) {
  try { return fs.statSync(filename).isFile(); } catch { return false; }
}

export function packageAppCandidates(location) {
  // Current Store builds ship a small Codex.exe activation stub; ChatGPT.exe
  // is the actual Chromium/Owl runtime and must own the inherited CDP pipes.
  return ["app/ChatGPT.exe", "app/Codex.exe", "ChatGPT.exe", "Codex.exe"]
    .map((relative) => path.join(location, relative));
}

// FSUTIL reads an APPEXECLINK's metadata without activating the alias. The
// hex dump is language independent; do not depend on localized field labels.
export function appExecutionAliasTarget(output) {
  const bytes = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[0-9a-f]{4,8}:\s+((?:[0-9a-f]{2}\s+){1,16})/i);
    if (match) bytes.push(...match[1].trim().split(/\s+/).map((hex) => parseInt(hex, 16)));
  }
  return Buffer.from(bytes).subarray(4).toString("utf16le").split("\0")
    .find((value) => /^[a-z]:\\/i.test(value) && /\\WindowsApps\\OpenAI\.(Codex|ChatGPT)_[^\\]+\\/i.test(value)) ?? null;
}

export function storeLocations(env = process.env, run = spawnSync) {
  const system = env.SystemRoot || "C:\\Windows";
  const result = run(path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "Get-AppxPackage | Where-Object { $_.Name -in @('OpenAI.Codex', 'OpenAI.ChatGPT') } | Sort-Object @{Expression={if ($_.Name -eq 'OpenAI.Codex') {0} else {1}}}, Version -Descending:$false | ForEach-Object { $_.InstallLocation }"
  ], { encoding: "utf8", timeout: 15000, windowsHide: true });
  if (!result.error && result.status === 0) {
    const locations = (result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (locations.length) return locations;
  }
  // Package Manager queries can be unavailable in a restricted session. Read
  // the current user's published helper alias instead of enumerating the
  // protected WindowsApps directory or changing its ownership/permissions.
  const localRoots = new Set([windowsPaths(env).local, path.join(os.homedir(), "AppData", "Local")]);
  for (const local of localRoots) {
    const alias = path.join(local, "Microsoft", "WindowsApps", "codex-core-command-runner.exe");
    const metadata = run(path.join(system, "System32", "fsutil.exe"), ["reparsepoint", "query", alias],
      { encoding: "utf8", timeout: 5000, windowsHide: true });
    if (metadata.error || metadata.status !== 0) continue;
    const target = appExecutionAliasTarget(metadata.stdout || "");
    const match = target?.match(/^(.*\\WindowsApps\\OpenAI\.(?:Codex|ChatGPT)_[^\\]+)\\/i);
    if (match) return [match[1]];
  }
  return [];
}

export function findWindowsAppExecutable(explicit, { env = process.env, locations = storeLocations, fileExists = isFile } = {}) {
  const override = explicit || env.CODEX_THEME_APP;
  if (override) {
    const filename = path.resolve(override);
    if (!/\.exe$/i.test(filename) || !fileExists(filename)) {
      throw new Error(`Codex executable does not exist or is not an .exe: ${filename}`);
    }
    return filename;
  }
  const { local } = windowsPaths(env);
  const candidates = [
    path.join(local, "Programs", "Codex", "Codex.exe"),
    path.join(local, "Programs", "codex", "Codex.exe"),
    path.join(local, "Programs", "ChatGPT", "ChatGPT.exe"),
    path.join(env.ProgramFiles || "C:\\Program Files", "Codex", "Codex.exe"),
    path.join(env.ProgramFiles || "C:\\Program Files", "ChatGPT", "ChatGPT.exe")
  ];
  const direct = candidates.find(fileExists);
  if (direct) return direct;
  return locations(env).flatMap(packageAppCandidates).find(fileExists) ?? null;
}

export function windowsCliCandidates(appExecutable) {
  const resources = path.join(path.dirname(appExecutable), "resources");
  return [
    path.join(resources, "codex.exe"),
    path.join(resources, "codex-cli", "bin", "codex.exe"),
    path.join(resources, "app.asar.unpacked", "codex.exe")
  ];
}

export function findWindowsCodexExecutable(appExecutable) {
  return windowsCliCandidates(appExecutable).find(isFile) ?? null;
}
