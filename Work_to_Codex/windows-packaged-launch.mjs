// Launch through Windows package activation, retaining the official app identity.
// Adapt the loopback CDP WebSocket to the theme's existing framed pipe transport.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function isWindowsPackageExecutable(executable) {
  return /[\\/]WindowsApps[\\/]OpenAI\.(?:Codex|ChatGPT)_[^\\/]+[\\/]/i.test(executable);
}

async function unusedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function launchWindowsPackagedApp(executable, profilePath, env = process.env) {
  if (typeof WebSocket !== 'function') throw new Error('This Windows launcher requires Node.js 22 or later.');
  const port = await unusedLoopbackPort();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-theme-activation-'));
  let activation;
  try {
    const argumentsFile = path.join(temporary, 'arguments.json');
    fs.writeFileSync(argumentsFile, JSON.stringify([
      '--codex-browser-background-networking-disabled',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profilePath}`,
      '--no-first-run'
    ]));
    const helper = fileURLToPath(new URL('./activate-packaged-app.ps1', import.meta.url));
    const powershell = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', helper, '-AppExecutable', executable, '-ArgumentsJson', argumentsFile
    ], { env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    if (result.error || result.status !== 0) {
      throw new Error(`Windows package activation failed. Fully quit ChatGPT and retry. ${result.error?.message || result.stderr?.trim()}`);
    }
    activation = JSON.parse(result.stdout.trim());
    console.log(`[wallpaper] Windows package identity: ${activation.PackageFamilyName}`);
  } finally {
    fs.rmSync(path.join(temporary, 'arguments.json'), { force: true });
    fs.rmdirSync(temporary);
  }
  let socketUrl;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
      socketUrl = (await response.json()).webSocketDebuggerUrl;
      if (socketUrl) break;
    } catch { /* Package activation may return before Chromium is ready. */ }
    await delay(200);
  }
  if (!socketUrl) throw new Error('The packaged app did not open the theme connection. Fully quit ChatGPT and retry.');
  const socketAddress = new URL(socketUrl);
  if (!['127.0.0.1', 'localhost'].includes(socketAddress.hostname) || socketAddress.port !== String(port)) {
    throw new Error('The theme connection must remain on its selected loopback port.');
  }
  const socket = new WebSocket(socketUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Theme WebSocket connection timed out.')); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Theme WebSocket connection failed.')); }, { once: true });
  });
  const child = new EventEmitter();
  Object.assign(child, { pid: activation.ProcessId, attached: true, exitCode: null, signalCode: null, killed: false });
  const input = new PassThrough();
  const output = new PassThrough();
  child.stdio = [null, null, null, input, output];
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    let separator;
    while ((separator = buffer.indexOf('\0')) >= 0) {
      const message = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 1);
      if (message && socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  });
  socket.addEventListener('message', event => output.write(`${event.data}\0`));
  socket.addEventListener('close', () => {
    if (child.exitCode != null) return;
    child.exitCode = 0;
    output.end();
    child.emit('exit', 0, null);
  });
  socket.addEventListener('error', () => child.emit('error', new Error('Theme WebSocket connection was interrupted.')));
  input.once('close', () => socket.close());
  // Ending the theme worker must not terminate the user's native app.
  child.kill = () => { socket.close(); return false; };
  return child;
}
