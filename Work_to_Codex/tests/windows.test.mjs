import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { appExecutionAliasTarget, findWindowsAppExecutable, packageAppCandidates, storeLocations, windowsPaths, findWindowsCodexExecutable } from "../windows-host.mjs";
import { parseArguments, CdpPipe, ThemeSession, createPageSource } from "../codex-theme.mjs";

const packageRoot = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3.0_x64__example";
const aliasTarget = packageRoot + "\\app\\resources\\codex-command-runner.exe";
function hexDump(target) {
  const data = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.from(`family\0family!App\0${target}\0`, "utf16le")]);
  const lines = [];
  for (let i = 0; i < data.length; i += 16) {
    lines.push(i.toString(16).padStart(4, "0") + ":  " + [...data.subarray(i, i + 16)].map(b => b.toString(16).padStart(2, "0")).join(" ") + "   ignored ascii");
  }
  return "Localized heading\r\n" + lines.join("\r\n");
}

test("profile is per-user and overrides the macOS default on Windows", () => {
  assert.equal(windowsPaths({ LOCALAPPDATA: "D:/User/Local" }).profile, path.join("D:/User/Local", "Codex Theme", "profile"));
  assert.equal(windowsPaths({}, "D:/User").local, path.join("D:/User", "AppData", "Local"));
});
test("APPEXECLINK hex parsing works independently of localized headings", () => {
  assert.equal(appExecutionAliasTarget(hexDump(aliasTarget)), aliasTarget);
  assert.equal(appExecutionAliasTarget("garbage"), null);
  assert.equal(appExecutionAliasTarget(hexDump("C:\\unrelated\\application.exe")), null);
});
test("Store Package Manager discovery avoids the protected root directory", () => {
  const calls = [];
  const run = (exe, args) => { calls.push([exe, args]); return { status: 0, stdout: packageRoot + "\r\n" }; };
  assert.deepEqual(storeLocations({}, run), [packageRoot]);
  assert.equal(calls.length, 1);
});
test("restricted package discovery falls back to the user's execution alias", () => {
  let count = 0;
  const run = () => ++count === 1 ? { status: 1, stdout: "", stderr: "Access denied" } : { status: 0, stdout: hexDump(aliasTarget) };
  assert.deepEqual(storeLocations({}, run), [packageRoot]);
});
test("current Store runtime is preferred over the Codex activation stub", () => {
  const candidates = packageAppCandidates(packageRoot);
  const result = findWindowsAppExecutable(null, { env: {}, locations: () => [packageRoot], fileExists: f => candidates.includes(f) });
  assert.equal(result, path.join(packageRoot, "app", "ChatGPT.exe"));
});
test("explicit missing executable reports an error instead of selecting another app", () => {
  assert.throws(() => findWindowsAppExecutable("missing.exe", { fileExists: () => false }), /does not exist/);
  assert.throws(() => findWindowsAppExecutable("application.cmd", { fileExists: () => true }), /not an .exe/);
});
test("bundled Windows CLI discovery selects resources/codex.exe", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "codex-theme-"));
  try {
    mkdirSync(path.join(fixture, "resources"));
    writeFileSync(path.join(fixture, "resources", "codex.exe"), "fixture");
    assert.equal(findWindowsCodexExecutable(path.join(fixture, "ChatGPT.exe")), path.join(fixture, "resources", "codex.exe"));
    assert.equal(findWindowsCodexExecutable(path.join(fixture, "absent", "Codex.exe")), null);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
test("CLI rejects missing values before launch", () => {
  for (const flag of ["--app", "--profile", "--image", "--fire", "--screenshot", "--attach-app"]) {
    assert.throws(() => parseArguments([flag], "."), /Missing value/);
    assert.throws(() => parseArguments([flag, "--dry-run"], "."), /Missing value/);
  }
  assert.equal(parseArguments(["--app", "app.exe", "--dry-run"], ".").appPath, path.resolve("app.exe"));
});
test("CDP transport handles fragmented responses and rejects pending work on close", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const cdp = new CdpPipe({ stdio: [null, null, null, input, output] });
  let message;
  input.on("data", data => { message = JSON.parse(data.toString().replace(/\0$/, "")); });
  const pending = cdp.send("Target.getTargets");
  const response = JSON.stringify({ id: message.id, result: { targetInfos: [] } }) + "\0";
  output.write(response.slice(0, 13)); output.write(response.slice(13));
  assert.deepEqual(await pending, { targetInfos: [] });
  const incomplete = cdp.send("Runtime.evaluate");
  cdp.close();
  await assert.rejects(incomplete, /closed|닫혔/);
  await assert.rejects(cdp.send("Target.getTargets"), /closed|닫혔/);
});
test("session cleanup terminates only its owned app and usage worker once", () => {
  const child = new EventEmitter();
  let appKills = 0, cliCloses = 0, cdpCloses = 0;
  Object.assign(child, { exitCode: null, signalCode: null, killed: false, kill() { ++appKills; this.killed = true; } });
  const fakeProcess = new EventEmitter();
  const session = new ThemeSession({ child, usageClient: { close() { ++cliCloses; } }, processObject: fakeProcess });
  session.cdp = { close() { ++cdpCloses; } };
  session.stop(); session.stop();
  assert.equal(appKills, 1); assert.equal(cliCloses, 1); assert.equal(cdpCloses, 1);
  assert.equal(fakeProcess.listenerCount("exit"), 0);
});
test("shared page runtime still produces valid JavaScript", () => {
  const source = createPageSource("data:image/jpeg;base64,AA==", "data:image/gif;base64,AA==");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /installPageRuntime/);
});
