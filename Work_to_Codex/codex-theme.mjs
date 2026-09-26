#!/usr/bin/env node

// src/main.mjs
import { spawn as spawn2 } from "node:child_process";
import fs4 from "node:fs";
import path3 from "node:path";
import { fileURLToPath } from "node:url";

// src/host/rate-limit-client.mjs
import { spawn } from "node:child_process";

// src/host/support.mjs
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
var DEFAULT_PROFILE_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Codex Theme"
);
var SSH_CONFIG_PATH = path.join(os.homedir(), ".ssh", "config");
var PINNED_SSH_ALIASES = /* @__PURE__ */ new Set([
  "VPN",
  "Proxmox",
  "Homelab",
  "Oracle_seoul",
  "Oracle_osaka",
  "Oracle_chuncheon"
]);
var LATENCY_REFRESH_MS = 15e3;
var LATENCY_TIMEOUT_MS = 2e3;
var APP_CANDIDATES = [
  "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
  "/Applications/Codex.app/Contents/MacOS/Codex"
];
function parseArguments(argv, projectPath2) {
  const options = {
    imagePath: path.join(projectPath2, "image.jpg"),
    firePath: path.join(projectPath2, "fire.gif"),
    profilePath: DEFAULT_PROFILE_PATH,
    skipRemoteSshBoot: false,
    dryRun: false,
    screenshotPath: void 0,
    exitAfterScreenshot: false,
    inspectUi: false,
    attachedAppPid: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--attach-app") {
      options.attachedAppPid = Number(argv[++index]);
      if (!Number.isSafeInteger(options.attachedAppPid) || options.attachedAppPid < 2) {
        throw new Error("Invalid attached app PID");
      }
    } else if (argument === "--image") {
      options.imagePath = path.resolve(argv[++index] ?? "");
    } else if (argument === "--fire") {
      options.firePath = path.resolve(argv[++index] ?? "");
    } else if (argument === "--profile") {
      options.profilePath = path.resolve(argv[++index] ?? "");
    } else if (argument === "--skip-remote-ssh-boot") {
      options.skipRemoteSshBoot = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--screenshot") {
      options.screenshotPath = path.resolve(argv[++index] ?? "");
    } else if (argument === "--exit-after-screenshot") {
      options.exitAfterScreenshot = true;
    } else if (argument === "--inspect-ui") {
      options.inspectUi = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  return options;
}
function printHelp() {
  console.log(`Codex Theme

사용법:
  node codex-theme.mjs [옵션]

옵션:
  --image <경로>              배경 JPEG/PNG 경로
  --fire <경로>               투명 불꽃 GIF 경로
  --profile <경로>            전용 Electron 프로필 경로
  --skip-remote-ssh-boot      검증용: 원격 SSH 앱 서버 부팅 생략
  --dry-run                   파일만 검사하고 앱은 실행하지 않음
  --screenshot <경로>         검증용: 주입 후 화면을 PNG로 저장
  --exit-after-screenshot     검증용: 화면 저장 뒤 앱 종료
  --inspect-ui                검증용: 테마 런타임과 사이드바 상태 출력
  -h, --help                  도움말 표시`);
}
function findAppExecutable() {
  return APP_CANDIDATES.find((candidate) => fs.existsSync(candidate));
}
function validateAssets(options) {
  if (!fs.existsSync(options.imagePath)) {
    throw new Error(`배경 사진이 없습니다: ${options.imagePath}`);
  }
  if (!fs.statSync(options.imagePath).isFile()) {
    throw new Error(`배경 경로가 파일이 아닙니다: ${options.imagePath}`);
  }
  if (!fs.existsSync(options.firePath)) {
    throw new Error(`불꽃 GIF가 없습니다: ${options.firePath}`);
  }
  if (!fs.statSync(options.firePath).isFile()) {
    throw new Error(`불꽃 경로가 파일이 아닙니다: ${options.firePath}`);
  }
  const imageExtension = path.extname(options.imagePath).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(imageExtension)) {
    throw new Error("배경은 JPEG 또는 PNG 파일이어야 합니다.");
  }
  if (path.extname(options.firePath).toLowerCase() !== ".gif") {
    throw new Error("불꽃은 GIF 파일이어야 합니다.");
  }
}
function assetDataUrl(assetPath) {
  const extension = path.extname(assetPath).toLowerCase();
  const mimeTypes = {
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png"
  };
  const mimeType = mimeTypes[extension];
  if (mimeType == null) throw new Error(`지원하지 않는 이미지 형식입니다: ${extension}`);
  return `data:${mimeType};base64,${fs.readFileSync(assetPath).toString("base64")}`;
}
function parsePinnedSshHosts(configPath) {
  if (!fs.existsSync(configPath)) return {};
  const hosts = {};
  let activeAliases = [];
  for (const rawLine of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const [keyword = "", ...parts] = line.split(/\s+/);
    const normalizedKeyword = keyword.toLowerCase();
    if (normalizedKeyword === "host") {
      activeAliases = parts.filter(
        (alias) => PINNED_SSH_ALIASES.has(alias) && !/[*!?]/.test(alias)
      );
      for (const alias of activeAliases) {
        hosts[alias] = { alias, hostname: alias, port: 22 };
      }
      continue;
    }
    for (const alias of activeAliases) {
      if (normalizedKeyword === "hostname" && parts[0]) hosts[alias].hostname = parts[0];
      if (normalizedKeyword === "port" && Number.isInteger(Number(parts[0]))) {
        hosts[alias].port = Number(parts[0]);
      }
    }
  }
  return hosts;
}
function measureTcpLatency({ hostname, port }) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const socket = net.createConnection({ host: hostname, port });
    let settled = false;
    const finish = (latency) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(latency);
    };
    socket.setTimeout(LATENCY_TIMEOUT_MS);
    socket.once("connect", () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      finish(Math.max(1, Math.round(elapsedMs)));
    });
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
  });
}
async function measurePinnedSshLatencies(hosts) {
  const entries = await Promise.all(
    Object.entries(hosts).map(async ([alias, host]) => [alias, await measureTcpLatency(host)])
  );
  return Object.fromEntries(entries);
}
function normalizeUsagePayload(payload, capturedAtMs = Date.now()) {
  const rateLimits = [
    payload?.rate_limit,
    ...Array.isArray(payload?.additional_rate_limits) ? payload.additional_rate_limits.map((limit) => limit?.rate_limit) : []
  ].filter((rateLimit) => rateLimit != null && typeof rateLimit === "object");
  const windows = rateLimits.flatMap((rateLimit) => [rateLimit.primary_window, rateLimit.secondary_window]).filter((window) => window != null && Number.isFinite(Number(window.used_percent))).map((window) => ({
    usedPercent: Number(window.used_percent),
    windowSeconds: Number(window.limit_window_seconds) || 0,
    resetAtSeconds: Number(window.reset_at)
  }));
  if (windows.length === 0) return null;
  const limitingWindow = windows.reduce((current, candidate) => {
    if (candidate.usedPercent > current.usedPercent) return candidate;
    if (candidate.usedPercent === current.usedPercent && candidate.windowSeconds > current.windowSeconds) {
      return candidate;
    }
    return current;
  });
  return {
    remainingPercent: Math.round(
      Math.min(100, Math.max(0, 100 - limitingWindow.usedPercent))
    ),
    resetAtMs: Number.isFinite(limitingWindow.resetAtSeconds) ? limitingWindow.resetAtSeconds * 1e3 : null,
    capturedAtMs
  };
}
function normalizeAppServerRateLimits(payload, capturedAtMs = Date.now()) {
  const snapshot = payload?.rateLimitsByLimitId?.codex ?? payload?.rateLimits;
  if (snapshot == null || typeof snapshot !== "object") return null;
  const windows = [snapshot.primary, snapshot.secondary].filter((window) => window != null && Number.isFinite(Number(window.usedPercent))).map((window) => ({
    usedPercent: Number(window.usedPercent),
    windowMinutes: Number(window.windowDurationMins) || 0,
    resetAtSeconds: Number(window.resetsAt)
  }));
  if (windows.length === 0) return null;
  const limitingWindow = windows.reduce((current, candidate) => {
    if (candidate.usedPercent > current.usedPercent) return candidate;
    if (candidate.usedPercent === current.usedPercent && candidate.windowMinutes > current.windowMinutes) {
      return candidate;
    }
    return current;
  });
  return {
    remainingPercent: Math.round(
      Math.min(100, Math.max(0, 100 - limitingWindow.usedPercent))
    ),
    resetAtMs: Number.isFinite(limitingWindow.resetAtSeconds) ? limitingWindow.resetAtSeconds * 1e3 : null,
    capturedAtMs
  };
}
function readUsageCache(cachePath) {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (!Number.isFinite(cached?.remainingPercent)) return null;
    if (!Number.isFinite(cached?.capturedAtMs)) return null;
    if (Date.now() - cached.capturedAtMs > 6 * 60 * 60 * 1e3) return null;
    if (Number.isFinite(cached.resetAtMs) && cached.resetAtMs <= Date.now()) return null;
    return cached;
  } catch {
    return null;
  }
}
function writeUsageCache(cachePath, usage) {
  try {
    fs.writeFileSync(cachePath, `${JSON.stringify(usage)}
`, { mode: 384 });
  } catch (error) {
    console.error(`[wallpaper] 사용량 캐시를 저장하지 못했습니다: ${error.message}`);
  }
}

// src/host/rate-limit-client.mjs
var DEFAULT_REQUEST_TIMEOUT_MS = 1e4;
var AppServerRateLimitClient = class {
  constructor(executablePath, {
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    spawnProcess = spawn
  } = {}) {
    this.executablePath = executablePath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.spawnProcess = spawnProcess;
    this.child = null;
    this.startPromise = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.nextRequestId = 1;
    this.pendingRequests = /* @__PURE__ */ new Map();
  }
  async read(capturedAtMs = Date.now()) {
    await this.ensureStarted();
    try {
      const response = await this.request("account/rateLimits/read", null);
      const usage = normalizeAppServerRateLimits(response, capturedAtMs);
      if (usage == null) throw new Error("Codex 앱 서버의 한도 응답 형식이 올바르지 않습니다");
      return usage;
    } catch (error) {
      this.close();
      throw error;
    }
  }
  async ensureStarted() {
    if (this.child != null && this.child.exitCode == null) return;
    if (this.startPromise != null) return this.startPromise;
    this.startPromise = this.start().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }
  async start() {
    const child = this.spawnProcess(
      this.executablePath,
      ["app-server", "--listen", "stdio://"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    this.child = child;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-4e3);
    });
    child.once("error", (error) => this.handleTermination(error));
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      const detail = this.stderrBuffer.trim();
      const reason = signal ? `Codex 앱 서버가 ${signal} 신호로 종료되었습니다` : `Codex 앱 서버가 종료되었습니다. 코드=${code ?? "unknown"}`;
      this.handleTermination(new Error(detail ? `${reason}: ${detail}` : reason));
    });
    try {
      await this.request("initialize", {
        clientInfo: {
          name: "codex-theme",
          title: "Codex Theme",
          version: "2.0.0"
        }
      });
      this.notify("initialized");
    } catch (error) {
      this.close();
      throw error;
    }
  }
  request(method, params) {
    const child = this.child;
    if (child == null || child.exitCode != null || !child.stdin.writable) {
      return Promise.reject(new Error("Codex 앱 서버 연결이 열려 있지 않습니다"));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex 앱 서버 요청 시간이 초과되었습니다: ${method}`));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(id, { method, reject, resolve, timeout });
      child.stdin.write(`${JSON.stringify({ id, method, params })}
`, (error) => {
        if (error == null) return;
        const pending = this.pendingRequests.get(id);
        if (pending == null) return;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(id);
        pending.reject(error);
      });
    });
  }
  notify(method, params) {
    const child = this.child;
    if (child == null || child.exitCode != null || !child.stdin.writable) return false;
    child.stdin.write(`${JSON.stringify(params === void 0 ? { method } : { method, params })}
`);
    return true;
  }
  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = this.pendingRequests.get(message?.id);
      if (pending == null) continue;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      if (message.error != null) {
        pending.reject(new Error(
          message.error.message || `Codex 앱 서버 요청이 실패했습니다: ${pending.method}`
        ));
      } else {
        pending.resolve(message.result);
      }
    }
  }
  handleTermination(error) {
    this.child = null;
    this.stdoutBuffer = "";
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
  close() {
    const child = this.child;
    this.child = null;
    this.startPromise = null;
    this.stdoutBuffer = "";
    const error = new Error("Codex 앱 서버 연결을 닫았습니다");
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    if (child != null && child.exitCode == null && !child.killed) child.kill("SIGTERM");
  }
};

// src/host/app-launcher.mjs
import { spawnSync } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";
function findAppLauncher(projectPath2) {
  const candidates = ["Codex.app", "Codex.app.noindex"].map((bundle) => path2.join(projectPath2, bundle, "Contents", "MacOS", "CodexAppLauncher"));
  for (const candidate of candidates) {
    try {
      fs2.accessSync(candidate, fs2.constants.X_OK);
      return candidate;
    } catch {
    }
  }
  throw new Error("앱 실행 보조 파일이 없습니다. ./install.sh로 Codex Theme를 다시 설치하십시오.");
}
function validateAppLauncher(launcherPath) {
  const result = spawnSync(launcherPath, ["--check"], { encoding: "utf8", timeout: 5e3 });
  if (result.error || result.status !== 0 || result.stdout.trim() !== "codex-theme-app-launcher 2") {
    throw new Error(`앱 실행 보조 파일을 사용할 수 없습니다: ${result.error?.message || result.stderr?.trim() || "호환되지 않는 버전"}`);
  }
}

// src/host/cdp-pipe.mjs
var CdpPipe = class {
  constructor(child, { requestTimeoutMs = 15e3 } = {}) {
    this.child = child;
    this.input = child.stdio[3];
    this.output = child.stdio[4];
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.buffer = "";
    this.eventHandler = void 0;
    this.closed = false;
    this.closeError = null;
    this.onData = (chunk) => this.handleChunk(chunk);
    this.output.setEncoding("utf8");
    this.output.on("data", this.onData);
    for (const stream of [this.input, this.output]) {
      stream.on("error", (error) => this.close(error));
      stream.once("close", () => this.close());
    }
  }
  handleChunk(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    while (true) {
      const separator = this.buffer.indexOf("\0");
      if (separator < 0) break;
      const raw = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 1);
      if (!raw) continue;
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        console.error("[wallpaper] CDP 메시지를 해석하지 못했습니다:", error.message);
        continue;
      }
      if (message.id != null) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result ?? {});
      } else if (this.eventHandler) {
        void Promise.resolve().then(() => this.eventHandler?.(message)).catch((error) => {
          console.error("[wallpaper] CDP 이벤트 처리에 실패했습니다:", error.message);
        });
      }
    }
  }
  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
  close(error = new Error("디버깅 파이프가 닫혔습니다.")) {
    if (this.closed) return;
    this.closed = true;
    this.closeError = error;
    this.eventHandler = void 0;
    this.buffer = "";
    this.output.off("data", this.onData);
    this.failAll(error);
    this.input.destroy();
    this.output.destroy();
  }
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(this.closeError);
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 응답 시간이 초과되었습니다.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      const fail = (error) => {
        if (!error || !this.pending.has(id)) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      };
      try {
        this.input.write(`${JSON.stringify(message)}\0`, fail);
      } catch (error) {
        fail(error);
      }
    });
  }
};

// src/host/theme-session.mjs
var ThemeSession = class {
  constructor({
    child,
    usageClient = null,
    createCdp = (childProcess) => new CdpPipe(childProcess),
    processObject = process,
    logger = console,
    timers = { setInterval, clearInterval, setTimeout, clearTimeout }
  }) {
    this.child = child;
    this.usageClient = usageClient;
    this.createCdp = createCdp;
    this.processObject = processObject;
    this.logger = logger;
    this.timers = timers;
    this.cdp = null;
    this.controller = null;
    this.pendingTimers = /* @__PURE__ */ new Map();
    this.stopped = false;
    this.onTerminate = () => this.stop();
    for (const event of ["SIGINT", "SIGTERM", "exit"]) {
      processObject.once(event, this.onTerminate);
    }
    child.once("error", (error) => {
      if (this.stopped) return;
      logger.error("[wallpaper] 앱을 실행하지 못했습니다:", error.message);
      processObject.exitCode = 1;
      this.stop();
    });
    child.once("exit", (code, signal) => {
      this.stop();
      if (child.attached) logger.log("[wallpaper] Codex 디버깅 파이프가 닫혔습니다.");
      else if (signal) logger.log(`[wallpaper] Codex가 ${signal} 신호로 종료되었습니다.`);
      else logger.log(`[wallpaper] Codex가 종료되었습니다. 코드=${code ?? "unknown"}`);
      processObject.exitCode = processObject.exitCode || code || 0;
    });
  }
  async start(initialize) {
    if (this.stopped) return;
    try {
      this.cdp = this.createCdp(this.child);
      await initialize(this.cdp);
    } catch (error) {
      if (this.stopped) return;
      this.processObject.exitCode = 1;
      this.stop();
      throw error;
    }
  }
  setController(controller) {
    if (this.stopped) controller.dispose();
    else this.controller = controller;
  }
  setInterval(callback, delayMs) {
    if (this.stopped) return null;
    const timer = this.timers.setInterval(() => {
      void Promise.resolve().then(() => {
        if (!this.stopped) return callback();
      }).catch((error) => {
        if (!this.stopped) this.logger.error(`[wallpaper] 주기 갱신에 실패했습니다: ${error.message}`);
      });
    }, delayMs);
    this.pendingTimers.set(timer, () => this.timers.clearInterval(timer));
    return timer;
  }
  setTimeout(callback, delayMs) {
    if (this.stopped) return null;
    const timer = this.timers.setTimeout(() => {
      this.pendingTimers.delete(timer);
      if (!this.stopped) callback();
    }, delayMs);
    this.pendingTimers.set(timer, () => this.timers.clearTimeout(timer));
    return timer;
  }
  delay(delayMs) {
    if (this.stopped) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = this.timers.setTimeout(() => {
        this.pendingTimers.delete(timer);
        resolve(true);
      }, delayMs);
      this.pendingTimers.set(timer, () => {
        this.timers.clearTimeout(timer);
        resolve(false);
      });
    });
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const event of ["SIGINT", "SIGTERM", "exit"]) {
      this.processObject.off(event, this.onTerminate);
    }
    const cleanups = [
      ...this.pendingTimers.values(),
      () => this.controller?.dispose(),
      () => this.cdp?.close(),
      () => {
        for (const stream of this.child.stdio?.slice(3, 5) ?? []) stream?.destroy();
      },
      () => this.usageClient?.close(),
      () => {
        if (this.child.exitCode == null && this.child.signalCode == null && !this.child.killed) {
          this.child.kill("SIGTERM");
        }
      }
    ];
    this.pendingTimers.clear();
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        this.logger.error(`[wallpaper] 종료 정리에 실패했습니다: ${error.message}`);
      }
    }
  }
};

// src/host/attached-app.mjs
import { EventEmitter } from "node:events";
import fs3 from "node:fs";
import net2 from "node:net";
var AttachedApp = class extends EventEmitter {
  constructor(pid) {
    super();
    if (!Number.isSafeInteger(pid) || pid < 2 || pid !== process.ppid) {
      throw new Error("The attached app must be the theme worker's parent process");
    }
    for (const fd of [3, 4]) {
      const stat = fs3.fstatSync(fd);
      if (!stat.isFIFO() && !stat.isSocket()) throw new Error("Inherited CDP pipes were not found");
    }
    this.pid = pid;
    this.attached = true;
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
    this.stdio = [
      null,
      null,
      null,
      new net2.Socket({ fd: 3, readable: false, writable: true }),
      new net2.Socket({ fd: 4, readable: true, writable: false })
    ];
    const closed = () => {
      if (this.exitCode != null) return;
      this.exitCode = 0;
      this.emit("exit", null, null);
    };
    this.stdio[4].once("end", closed);
    this.stdio[4].once("close", closed);
  }
  kill(signal = "SIGTERM") {
    if (this.killed || this.exitCode != null || process.ppid !== this.pid) return false;
    try {
      process.kill(this.pid, signal);
      this.killed = true;
      return true;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      return false;
    }
  }
};

// src/host/target-controller.mjs
function isCodexPage(targetInfo) {
  if (targetInfo?.type !== "page") return false;
  const url = targetInfo.url ?? "";
  const title = targetInfo.title ?? "";
  if (/avatar-overlay|devtools:|chrome-extension:|web-sandbox/i.test(url)) return false;
  return /webview\/index\.html|app:\/\/|codex:\/\//i.test(url) || /^(Codex|ChatGPT)$/i.test(title);
}
var TargetController = class {
  constructor({
    cdp,
    source,
    pushUiState,
    onReady = async () => {
    },
    eligible = isCodexPage,
    logger = console,
    retryDelaysMs = [250, 1e3, 3e3],
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  }) {
    this.cdp = cdp;
    this.source = source;
    this.pushUiState = pushUiState;
    this.onReady = onReady;
    this.eligible = eligible;
    this.logger = logger;
    this.retryDelaysMs = retryDelaysMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.records = /* @__PURE__ */ new Map();
    this.sessionTargets = /* @__PURE__ */ new Map();
    this.disposed = false;
  }
  sessionIds() {
    return Array.from(this.records.values()).map((record) => record.sessionId).filter(Boolean);
  }
  targetIdForSession(sessionId) {
    return this.sessionTargets.get(sessionId) ?? null;
  }
  targetInfo(targetId) {
    return this.records.get(targetId)?.targetInfo ?? null;
  }
  async handleTargetInfo(targetInfo) {
    if (this.disposed || !targetInfo?.targetId) return;
    let record = this.records.get(targetInfo.targetId);
    if (!record) {
      record = {
        targetInfo,
        generation: 1,
        sessionId: null,
        attachPromise: null,
        retryTimer: null,
        retryCount: 0,
        state: "idle"
      };
      this.records.set(targetInfo.targetId, record);
    } else {
      const wasEligible = this.eligible(record.targetInfo);
      record.targetInfo = targetInfo;
      if (!wasEligible && this.eligible(targetInfo)) {
        record.retryCount = 0;
        if (record.state === "exhausted") record.state = "idle";
      }
    }
    if (!this.eligible(targetInfo)) {
      this.#cancelRetry(record);
      return;
    }
    await this.#ensureAttached(targetInfo.targetId, record);
  }
  handleTargetDestroyed(targetId) {
    const record = this.records.get(targetId);
    if (!record) return;
    record.generation += 1;
    this.#cancelRetry(record);
    record.state = "disposed";
    if (record.sessionId) this.sessionTargets.delete(record.sessionId);
    this.records.delete(targetId);
  }
  handleSessionDetached(sessionId, targetId) {
    const resolvedTargetId = targetId || this.sessionTargets.get(sessionId);
    if (!resolvedTargetId) return;
    const record = this.records.get(resolvedTargetId);
    this.sessionTargets.delete(sessionId);
    if (!record || record.sessionId !== sessionId) return;
    record.sessionId = null;
    record.generation += 1;
    record.retryCount = 0;
    record.state = "idle";
    if (this.eligible(record.targetInfo)) this.#scheduleRetry(resolvedTargetId, record);
  }
  dispose() {
    this.disposed = true;
    for (const record of this.records.values()) {
      record.generation += 1;
      this.#cancelRetry(record);
      record.state = "disposed";
    }
    this.records.clear();
    this.sessionTargets.clear();
  }
  async #ensureAttached(targetId, record) {
    if (this.disposed || this.records.get(targetId) !== record || !this.eligible(record.targetInfo) || record.state !== "idle" || record.attachPromise) {
      return;
    }
    record.state = "attaching";
    const attachPromise = this.#attach(targetId, record);
    record.attachPromise = attachPromise;
    try {
      await attachPromise;
    } finally {
      if (this.records.get(targetId) === record && record.attachPromise === attachPromise) {
        record.attachPromise = null;
        if (record.state === "idle") void this.#ensureAttached(targetId, record);
      }
    }
  }
  async #attach(targetId, record) {
    const generation = record.generation;
    let sessionId = null;
    try {
      const attached = await this.cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true
      });
      sessionId = attached.sessionId;
      if (!sessionId) throw new Error("CDP 세션 ID를 받지 못했습니다.");
      if (!this.#isCurrent(targetId, record, generation)) {
        await this.#detachQuietly(sessionId);
        return;
      }
      record.sessionId = sessionId;
      this.sessionTargets.set(sessionId, targetId);
      await Promise.all([
        this.cdp.send("Page.enable", {}, sessionId),
        this.cdp.send("Runtime.enable", {}, sessionId),
        this.cdp.send("Network.enable", {}, sessionId)
      ]);
      if (!this.#isCurrent(targetId, record, generation)) return;
      await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: this.source }, sessionId);
      const result = await this.cdp.send(
        "Runtime.evaluate",
        {
          expression: this.source,
          awaitPromise: true,
          returnByValue: true
        },
        sessionId
      );
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "주입 중 예외가 발생했습니다.");
      }
      if (!this.#isCurrent(targetId, record, generation)) return;
      await this.pushUiState(sessionId);
      if (!this.#isCurrent(targetId, record, generation)) return;
      record.retryCount = 0;
      record.state = "attached";
      this.logger.log(
        `[wallpaper] 적용 완료: ${record.targetInfo.title || record.targetInfo.url || targetId}`
      );
      try {
        await this.onReady({ targetId, sessionId, targetInfo: record.targetInfo });
      } catch (error) {
        this.logger.error(`[wallpaper] 적용 후 진단에 실패했습니다: ${error.message}`);
      }
    } catch (error) {
      if (sessionId) this.sessionTargets.delete(sessionId);
      if (!this.#isCurrent(targetId, record, generation)) return;
      if (record.sessionId === sessionId) record.sessionId = null;
      record.state = "idle";
      const willRetry = this.#scheduleRetry(targetId, record);
      const prefix = willRetry ? "적용 재시도 예정" : "적용 중단";
      this.logger.error(`[wallpaper] ${prefix}: ${error.message}`);
      if (sessionId) await this.#detachQuietly(sessionId);
    }
  }
  #isCurrent(targetId, record, generation) {
    return !this.disposed && this.records.get(targetId) === record && record.generation === generation;
  }
  #scheduleRetry(targetId, record) {
    if (this.disposed || this.records.get(targetId) !== record || !this.eligible(record.targetInfo) || record.retryTimer != null) {
      return false;
    }
    if (record.retryCount >= this.retryDelaysMs.length) {
      record.state = "exhausted";
      return false;
    }
    const delayMs = this.retryDelaysMs[record.retryCount];
    record.retryCount += 1;
    const generation = record.generation;
    record.state = "retry-wait";
    record.retryTimer = this.setTimeoutFn(() => {
      if (!this.#isCurrent(targetId, record, generation)) return;
      record.retryTimer = null;
      record.state = "idle";
      void this.#ensureAttached(targetId, record);
    }, delayMs);
    return true;
  }
  #cancelRetry(record) {
    if (record.retryTimer == null) return;
    this.clearTimeoutFn(record.retryTimer);
    record.retryTimer = null;
    if (record.state === "retry-wait") record.state = "idle";
  }
  async #detachQuietly(sessionId) {
    try {
      await this.cdp.send("Target.detachFromTarget", { sessionId });
    } catch {
    }
  }
};

// embedded-page-runtime:page-runtime
function getPageRuntimeBundle() {
  return 'var __codexThemePage = (() => {\n  var __defProp = Object.defineProperty;\n  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;\n  var __getOwnPropNames = Object.getOwnPropertyNames;\n  var __hasOwnProp = Object.prototype.hasOwnProperty;\n  var __export = (target, all) => {\n    for (var name in all)\n      __defProp(target, name, { get: all[name], enumerable: true });\n  };\n  var __copyProps = (to, from, except, desc) => {\n    if (from && typeof from === "object" || typeof from === "function") {\n      for (let key of __getOwnPropNames(from))\n        if (!__hasOwnProp.call(to, key) && key !== except)\n          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\n    }\n    return to;\n  };\n  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);\n\n  // src/page/browser-entry.mjs\n  var browser_entry_exports = {};\n  __export(browser_entry_exports, {\n    installPageRuntime: () => installPageRuntime\n  });\n\n  // src/page/dom.mjs\n  var STYLE_ID = "codex-theme-style";\n  var OWNED_ATTRIBUTE = "data-codex-theme-owned";\n  function isVisible(element) {\n    if (!(element instanceof HTMLElement)) return false;\n    const rect = element.getBoundingClientRect();\n    return rect.width > 0 && rect.height > 0;\n  }\n  function isOwnedNode(node) {\n    const element = node instanceof Element ? node : node?.parentElement;\n    if (!(element instanceof Element)) return false;\n    return element.id === STYLE_ID || element.hasAttribute(OWNED_ATTRIBUTE) || element.closest(`[${OWNED_ATTRIBUTE}="true"]`) != null;\n  }\n  function markOwned(element) {\n    if (element.getAttribute(OWNED_ATTRIBUTE) !== "true") {\n      element.setAttribute(OWNED_ATTRIBUTE, "true");\n    }\n    return element;\n  }\n  function setAttributeIfChanged(element, name, value) {\n    if (element.getAttribute(name) !== value) element.setAttribute(name, value);\n  }\n  function removeAttributeIfPresent(element, name) {\n    if (element.hasAttribute(name)) element.removeAttribute(name);\n  }\n  function setStylePropertyIfChanged(element, name, value) {\n    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);\n  }\n  function shallowEqualObject(left, right) {\n    if (left === right) return true;\n    const leftKeys = Object.keys(left || {});\n    const rightKeys = Object.keys(right || {});\n    if (leftKeys.length !== rightKeys.length) return false;\n    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key]));\n  }\n  function findMainSurface() {\n    const visibleSurfaces = (selector) => Array.from(document.querySelectorAll(selector)).filter((surface) => surface instanceof HTMLElement && isVisible(surface));\n    const currentSurfaces = visibleSurfaces("[data-app-shell-main-surface]");\n    const candidates = currentSurfaces.length > 0 ? currentSurfaces : visibleSurfaces(\'[class*="_MainContentSurface_"]\');\n    return candidates.sort((left, right) => {\n      const leftRect = left.getBoundingClientRect();\n      const rightRect = right.getBoundingClientRect();\n      return rightRect.width * rightRect.height - leftRect.width * leftRect.height;\n    })[0] ?? null;\n  }\n\n  // src/page/home-mode.mjs\n  function createHomeModeSupport() {\n    const identifier = "[A-Za-z_$][\\\\w$]*";\n    const escape = (text) => text.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");\n    function exportName(source, name) {\n      const block = source.slice(source.lastIndexOf("export{"));\n      const match = block.match(new RegExp(`(?:\\\\{|,)${escape(name)} as (${identifier})(?=,|})`));\n      if (!match) throw new Error(`Unsupported app build: ${name} is not exported`);\n      return match[1];\n    }\n    function bindingReference(source, name) {\n      for (const clause of source.matchAll(/import\\{([^}]+)\\}from["\'](\\.\\/[^"\']+\\.js)["\'];/g)) {\n        for (const binding of clause[1].split(",")) {\n          const [exported, local = exported] = binding.trim().split(/\\s+as\\s+/);\n          if (local === name) return { name: exported, path: clause[2] };\n        }\n      }\n      return exportName(source, name);\n    }\n    function importedReactDom(source) {\n      const factories = /* @__PURE__ */ new Set();\n      for (const call of source.matchAll(new RegExp(`(${identifier})\\\\.flushSync(?:\\\\(|\\\\)\\\\()`, "g"))) {\n        const assignment = source.match(new RegExp(\n          `(?:^|[^\\\\w$])${escape(call[1])}=(?:${identifier}\\\\()?(${identifier})\\\\(\\\\)(?:,1)?\\\\)?(?=[,;)\\\\n]|$)`\n        ));\n        if (assignment) factories.add(assignment[1]);\n      }\n      const candidates = /* @__PURE__ */ new Map();\n      for (const clause of source.matchAll(/import\\{([^}]+)\\}from["\'](\\.\\/[^"\']+\\.js)["\'];/g)) {\n        for (const binding of clause[1].split(",")) {\n          const [name, local = name] = binding.trim().split(/\\s+as\\s+/);\n          if (factories.has(local)) candidates.set(`${clause[2]}:${name}`, { name, path: clause[2] });\n        }\n      }\n      return candidates.size === 1 ? [...candidates.values()][0] : null;\n    }\n    function discover(source) {\n      const legacySetter = source.match(new RegExp(\n        `function\\\\s+(${identifier})\\\\(e,t\\\\)\\\\{t===([\\`\'"])chat\\\\2&&e\\\\.get\\\\((${identifier})\\\\)\\\\|\\\\|e\\\\.set\\\\((${identifier}),t\\\\)\\\\}`\n      ));\n      const scopedSetter = source.match(new RegExp(\n        `function\\\\s+(${identifier})\\\\(e,t\\\\)\\\\{t===([\\`\'"])chat\\\\2&&e\\\\.get\\\\((${identifier})\\\\)\\\\|\\\\|\\\\(e\\\\.get\\\\((${identifier})\\\\)!=null&&e\\\\.set\\\\(\\\\4,t\\\\),e\\\\.set\\\\((${identifier}),t\\\\)\\\\)\\\\}`\n      ));\n      const setter = legacySetter ?? scopedSetter;\n      if (!setter) throw new Error("Unsupported app build: Home mode setter was not found");\n      const persisted = source.match(new RegExp(\n        `(${identifier})=${identifier}\\\\(${identifier},\\\\(\\\\{get:(${identifier})\\\\}\\\\)=>\\\\2\\\\(${escape(legacySetter ? setter[4] : setter[5])}\\\\)\\\\?\\\\?`\n      ));\n      let preference = persisted;\n      if (!legacySetter && persisted) {\n        const override = source.match(new RegExp(\n          `(${identifier})=${identifier}\\\\(${identifier},\\\\(\\\\{get:(${identifier})\\\\}\\\\)=>\\\\2\\\\(${escape(setter[4])}\\\\)\\\\)`\n        ));\n        preference = override && source.match(new RegExp(\n          `(${identifier})=${identifier}\\\\(${identifier},\\\\(\\\\{get:(${identifier})\\\\}\\\\)=>\\\\2\\\\(${escape(override[1])}\\\\)\\\\?\\\\?\\\\2\\\\(${escape(persisted[1])}\\\\)\\\\?\\\\?`\n        ));\n      }\n      const effective = [...source.matchAll(new RegExp(\n        `(?<name>${identifier})=${identifier}\\\\(${identifier},\\\\(\\\\{get:(?<get>${identifier})\\\\}\\\\)=>(?:\\\\{let ${identifier}=\\\\k<get>\\\\(${escape(preference?.[1] ?? "")}\\\\);return )?${identifier}\\\\(\\\\{chatGptProductAccess:\\\\k<get>\\\\((?<access>${identifier}),\\\\{name:[\\`\'"]chatgpt[\\`\'"]\\\\}\\\\),(?:chatSeatAccess:\\\\k<get>\\\\((?<seatAccess>${identifier}),\\\\{name:[\\`\'"]chatgpt\\\\.seat-access[\\`\'"]\\\\}\\\\),)?persistedMode:`,\n        "g"\n      ))];\n      const flushAt = source.indexOf(".flushSync=function");\n      const domFactory = flushAt < 0 ? null : source.slice(flushAt, flushAt + 6e3).match(\n        /\\}\\)\\),([A-Za-z_$][\\w$]*)=[A-Za-z_$][\\w$]*\\(\\(\\(/\n      );\n      const domImport = source.match(new RegExp(\n        `import\\\\{(${identifier}) as ${identifier}\\\\}from[\\`\'"](\\\\./react-dom-[\\\\w-]+\\\\.js)[\\`\'"];`\n      ));\n      const reactDomImport = domImport ? { name: domImport[1], path: domImport[2] } : !domFactory ? importedReactDom(source) : null;\n      if (!preference || !effective.length || !domFactory && !reactDomImport) {\n        throw new Error("Unsupported app build: Home mode subscriptions or ReactDOM were not found");\n      }\n      return {\n        setMode: exportName(source, setter[1]),\n        blocked: bindingReference(source, setter[3]),\n        preference: exportName(source, preference[1]),\n        effective: effective.map((match) => exportName(source, match.groups.name)),\n        access: bindingReference(source, effective[0].groups.access),\n        ...effective[0].groups.seatAccess ? { seatAccess: bindingReference(source, effective[0].groups.seatAccess) } : {},\n        ...domFactory ? { reactDom: exportName(source, domFactory[1]) } : {\n          reactDomImport\n        }\n      };\n    }\n    function load(source, namespace, reactDomModule, names = discover(source), modules = {}) {\n      const resolve = (reference) => typeof reference === "string" ? namespace[reference] : modules[reference?.path]?.[reference?.name];\n      const setMode = namespace[names.setMode];\n      const reactDom = names.reactDomImport ? reactDomModule?.[names.reactDomImport.name] : namespace[names.reactDom];\n      const flushSync = typeof reactDom === "function" ? reactDom()?.flushSync : null;\n      const descriptors = names.effective.map((name) => namespace[name]);\n      if (typeof setMode !== "function" || typeof flushSync !== "function" || [names.blocked, names.preference, names.access, names.seatAccess].filter(Boolean).some((name) => resolve(name) == null) || descriptors.some((value) => typeof value?.resolve !== "function")) {\n        throw new Error("Unsupported app build: Home mode runtime has an unexpected shape");\n      }\n      return {\n        names,\n        setMode,\n        flushSync,\n        readPreference: (store) => store.get(resolve(names.preference)),\n        canChat: (store) => !store.get(resolve(names.blocked)) && (store.get(resolve(names.access), { name: "chatgpt" })?.isCapable === true || names.seatAccess != null && store.get(resolve(names.seatAccess), { name: "chatgpt.seat-access" })?.isCapable === true),\n        subscriptionAtoms(store) {\n          return descriptors.map((descriptor) => {\n            const node = store.chain?.get(descriptor.scope.id);\n            if (!node) throw new Error("The Home mode scope was not found");\n            return descriptor.resolve(node, store.chain);\n          });\n        }\n      };\n    }\n    function createBridge(native, store) {\n      const records = /* @__PURE__ */ new Map();\n      const queues = /* @__PURE__ */ new Map();\n      const atomReads = /* @__PURE__ */ new Map();\n      let desired = null;\n      let disposed = false;\n      let previousPreference = null;\n      let writes = 0;\n      function selectedMode(value) {\n        if (disposed || desired == null || value == null) return value;\n        if (desired === "chat" && !native.canChat(store)) return value;\n        return desired;\n      }\n      function bind(route) {\n        if (disposed) throw new Error("The Home mode bridge has been disposed");\n        const atoms = new Set(native.subscriptionAtoms(store));\n        const activeSubscribers = /* @__PURE__ */ new Set();\n        const activeQueues = /* @__PURE__ */ new Set();\n        const activeAtoms = /* @__PURE__ */ new Set();\n        let matched = 0;\n        for (const fiber of new Set([route, route?.alternate].filter(Boolean))) {\n          const seen = /* @__PURE__ */ new Set();\n          for (let hook = fiber.memoizedState; hook && !seen.has(hook); hook = hook.next) {\n            seen.add(hook);\n            const memo = hook.memoizedState;\n            if (!Array.isArray(memo) || !atoms.has(memo[1]?.[1])) continue;\n            const subscriber = memo[0];\n            const snapshot = hook.next;\n            if (typeof subscriber?.getSnapshot !== "function" || typeof subscriber?.subscribe !== "function" || typeof snapshot?.queue?.getSnapshot !== "function") continue;\n            if (subscriber.createRender?.() != null) {\n              throw new Error("Unsupported app build: Home mode is not a primitive subscription");\n            }\n            const atom = memo[1][1];\n            if (typeof atom.read === "function") {\n              if (!atomReads.has(atom)) {\n                const original = atom.read;\n                const read = function(...args) {\n                  return selectedMode(original.apply(this, args));\n                };\n                atomReads.set(atom, { original, read });\n                atom.read = read;\n              }\n              activeAtoms.add(atom);\n            }\n            let record = records.get(subscriber);\n            if (!record) {\n              const original = subscriber.getSnapshot;\n              const read = () => selectedMode(original());\n              record = { original, read };\n              records.set(subscriber, record);\n              subscriber.getSnapshot = read;\n            }\n            if (!queues.has(snapshot.queue)) queues.set(snapshot.queue, {\n              original: snapshot.queue.getSnapshot,\n              read: record.read\n            });\n            snapshot.queue.getSnapshot = record.read;\n            activeSubscribers.add(subscriber);\n            activeQueues.add(snapshot.queue);\n            matched += 1;\n          }\n        }\n        if (!matched) throw new Error("The native Home mode subscription was not found");\n        for (const [subscriber, record] of records) {\n          if (activeSubscribers.has(subscriber)) continue;\n          if (subscriber.getSnapshot === record.read) subscriber.getSnapshot = record.original;\n          records.delete(subscriber);\n        }\n        for (const [queue, record] of queues) {\n          if (activeQueues.has(queue)) continue;\n          if (queue.getSnapshot === record.read) queue.getSnapshot = record.original;\n          queues.delete(queue);\n        }\n        for (const [atom, record] of atomReads) {\n          if (activeAtoms.has(atom)) continue;\n          if (atom.read === record.read) atom.read = record.original;\n          atomReads.delete(atom);\n        }\n        return matched;\n      }\n      function write(mode) {\n        native.setMode(store, mode);\n        writes += 1;\n      }\n      function writeAndInvalidate(mode) {\n        if (native.readPreference(store) === mode) write(mode === "chat" ? "work" : "chat");\n        write(mode);\n      }\n      function request(mode) {\n        if (disposed) throw new Error("The Home mode bridge has been disposed");\n        if (mode !== "chat" && mode !== "work") throw new Error("Invalid Home mode");\n        if (mode === "chat" && !native.canChat(store)) {\n          throw new Error("Chat is unavailable for the current account or workspace");\n        }\n        if (!records.size) throw new Error("The Home mode bridge is not connected");\n        previousPreference = native.readPreference(store);\n        const previousDesired = desired;\n        desired = mode;\n        try {\n          native.flushSync(() => {\n            writeAndInvalidate(mode);\n          });\n          if (native.readPreference(store) !== mode) throw new Error("The app rejected the requested Home mode");\n        } catch (error) {\n          desired = previousDesired;\n          try {\n            native.flushSync(() => writeAndInvalidate(previousPreference));\n          } catch {\n          }\n          throw error;\n        }\n      }\n      function cancel() {\n        desired = null;\n        if (previousPreference === "chat" || previousPreference === "work") {\n          native.flushSync(() => writeAndInvalidate(previousPreference));\n        }\n        previousPreference = null;\n      }\n      function dispose() {\n        if (disposed) return;\n        disposed = true;\n        for (const [subscriber, record] of records) {\n          if (subscriber.getSnapshot === record.read) subscriber.getSnapshot = record.original;\n        }\n        for (const [queue, record] of queues) {\n          if (queue.getSnapshot === record.read) queue.getSnapshot = record.original;\n        }\n        for (const [atom, record] of atomReads) {\n          if (atom.read === record.read) atom.read = record.original;\n        }\n        records.clear();\n        queues.clear();\n        atomReads.clear();\n      }\n      return { bind, request, cancel, dispose, inspect: () => ({ desired, writes, subscriptions: records.size }) };\n    }\n    return { discover, load, createBridge };\n  }\n\n  // src/page/chat-composer.mjs\n  function createChatComposerSupport() {\n    const changes = /* @__PURE__ */ new Map();\n    function isRecoverable(props) {\n      return props?.showComposer === false && props.hasRenderableTurns === true && props.hasLoadError === false && props.isConversationLoading === false && props.isSubmitDisabled === true && props.sharedConversationId == null && props.archivedPreviewFooter == null;\n    }\n    function repair(fiber) {\n      const props = fiber?.memoizedProps;\n      if (!isRecoverable(props)) return false;\n      let dispatch = null;\n      const seen = /* @__PURE__ */ new Set();\n      for (let hook = fiber.memoizedState; hook && !seen.has(hook); hook = hook.next) {\n        seen.add(hook);\n        const state = hook.memoizedState;\n        if (state != null && Object.getPrototypeOf(state) === Object.prototype && typeof state.getHeightPx === "function" && typeof state.place === "function" && typeof state.clear === "function" && typeof hook.queue?.dispatch === "function") {\n          dispatch = hook.queue.dispatch;\n          break;\n        }\n      }\n      if (dispatch == null) return false;\n      const patched = { ...props, showComposer: true };\n      for (const current of [fiber, fiber.alternate].filter(Boolean)) {\n        if (current.memoizedProps !== props) continue;\n        changes.set(current, { original: props, patched, pending: current.pendingProps });\n        current.memoizedProps = patched;\n        current.pendingProps = patched;\n      }\n      dispatch((state) => state != null && typeof state.getHeightPx === "function" ? { ...state } : state);\n      return true;\n    }\n    function retain(fibers) {\n      for (const fiber of changes.keys()) if (!fibers.has(fiber)) changes.delete(fiber);\n    }\n    function dispose() {\n      for (const [fiber, change] of changes) {\n        if (fiber.memoizedProps === change.patched) fiber.memoizedProps = change.original;\n        if (fiber.pendingProps === change.patched) fiber.pendingProps = change.pending;\n      }\n      changes.clear();\n    }\n    return { isRecoverable, repair, retain, dispose };\n  }\n\n  // src/page/queued-follow-ups.mjs\n  function createQueuedFollowUpSupport() {\n    const records = /* @__PURE__ */ new Map();\n    let recoveries = 0;\n    function attach(queue) {\n      if (records.has(queue)) return true;\n      if (!["read", "enqueue", "remove", "restore", "isEnabled"].every(\n        (key) => typeof queue?.[key] === "function"\n      )) return false;\n      const source = Function.prototype.toString.call(queue.enqueue);\n      if (!source.includes("App-server queued follow-up no longer exists") || !source.includes("thread/queue/add") || !source.includes("thread/queue/update")) return false;\n      if (["enqueue", "remove", "restore"].some(\n        (key) => Object.getOwnPropertyDescriptor(queue, key)?.writable !== true\n      )) return false;\n      const original = { enqueue: queue.enqueue, remove: queue.remove, restore: queue.restore };\n      const removed = /* @__PURE__ */ new Map();\n      const keyFor = (threadId, messageId) => JSON.stringify([threadId, messageId]);\n      const record = { queue, original, removed, active: true };\n      const remove = async function(threadId, messageId, ...rest) {\n        const result = await original.remove.call(this, threadId, messageId, ...rest);\n        if (record.active && result?.message?.id === messageId && result.serverSubmission?.id === messageId) {\n          removed.set(keyFor(threadId, messageId), { pending: false });\n          while (removed.size > 256) removed.delete(removed.keys().next().value);\n        }\n        return result;\n      };\n      const restore = async function(threadId, snapshot, ...rest) {\n        const key = keyFor(threadId, snapshot?.message?.id);\n        removed.delete(key);\n        return original.restore.call(this, threadId, snapshot, ...rest);\n      };\n      const enqueue = async function(threadId, message, position, ...rest) {\n        const key = keyFor(threadId, position?.messageId);\n        const proof = removed.get(key);\n        const items = proof == null ? null : queue.read(threadId);\n        if (!record.active || proof == null || !queue.isEnabled() || !Array.isArray(items) || items.some((item) => item.id === position.messageId)) {\n          return original.enqueue.call(this, threadId, message, position, ...rest);\n        }\n        if (proof.pending) throw new Error("This edited queued message is already being submitted");\n        proof.pending = true;\n        const { messageId: _removedId, ...insertionPosition } = position;\n        try {\n          const result = await original.enqueue.call(this, threadId, message, insertionPosition, ...rest);\n          recoveries += 1;\n          return result;\n        } finally {\n          removed.delete(key);\n        }\n      };\n      record.wrapped = { enqueue, remove, restore };\n      Object.assign(queue, record.wrapped);\n      records.set(queue, record);\n      return true;\n    }\n    function dispose() {\n      for (const record of records.values()) {\n        record.active = false;\n        for (const key of Object.keys(record.original)) {\n          if (record.queue[key] === record.wrapped[key]) record.queue[key] = record.original[key];\n        }\n        record.removed.clear();\n      }\n      records.clear();\n    }\n    return { attach, dispose, inspect: () => ({ attachedQueues: records.size, recoveries }) };\n  }\n  function discoverQueueManagerExport(source) {\n    const identifier = "[A-Za-z_$][\\\\w$]*";\n    const match = source.match(new RegExp(\n      `function (${identifier})\\\\(e,t\\\\)\\\\{if\\\\(t==null\\\\)return null;let n=${identifier}\\\\(e\\\\.get,t\\\\);return\\\\(n==null\\\\?null:e\\\\.get\\\\(${identifier},n\\\\)\\\\)\\\\?\\\\?e\\\\.get\\\\(${identifier}\\\\)\\\\.find\\\\(e=>e\\\\.getConversation\\\\(t\\\\)!=null\\\\)\\\\?\\\\?null\\\\}`\n    ));\n    const exports = source.slice(source.lastIndexOf("export{"));\n    const name = match?.[1]?.replace(/[$]/g, "\\\\$");\n    const exported = name && exports.match(new RegExp(`(?:\\\\{|,)${name} as (${identifier})(?=,|})`));\n    if (!exported) throw new Error("Unsupported app build: queued-message manager lookup was not found");\n    return exported[1];\n  }\n\n  // src/page/native-compat.mjs\n  function createNativeCompatibility({ diagnostics }) {\n    let unifiedSidebarActive = false;\n    let unifiedSidebarLastError = null;\n    let composerLastError = null;\n    const nativeUnifiedSidebarTypes = /* @__PURE__ */ new WeakMap();\n    const unifiedSidebarFibers = /* @__PURE__ */ new Set();\n    const nativeCodexHomeTypes = /* @__PURE__ */ new WeakMap();\n    const nativeHomeRouteTypes = /* @__PURE__ */ new WeakMap();\n    const homeModeSupport = createHomeModeSupport();\n    const chatComposerSupport = createChatComposerSupport();\n    const queuedFollowUpSupport = createQueuedFollowUpSupport();\n    let queuedFollowUpLastError = null;\n    return {\n      reconcileSidebar() {\n        try {\n          reconcileUnifiedSidebarMode();\n        } catch (error) {\n          unifiedSidebarActive = false;\n          unifiedSidebarLastError = String(error?.stack || error);\n          diagnostics.unifiedSidebarRenderErrors += 1;\n        }\n      },\n      reconcileComposer() {\n        try {\n          reconcileChatComposer();\n          composerLastError = null;\n        } catch (error) {\n          composerLastError = String(error?.stack || error);\n          diagnostics.chatComposerRecoveryErrors = (diagnostics.chatComposerRecoveryErrors ?? 0) + 1;\n        }\n      },\n      reconcileQueuedFollowUps(managerForThread) {\n        try {\n          reconcileQueuedFollowUps(managerForThread);\n          queuedFollowUpLastError = null;\n        } catch (error) {\n          queuedFollowUpLastError = String(error?.message || error);\n        }\n      },\n      inspectQueuedFollowUps: () => ({ ...queuedFollowUpSupport.inspect(), lastError: queuedFollowUpLastError }),\n      findHome: nativeCodexHomeFiber,\n      homeStore: homeComposerStoreForFiber,\n      homeMode: (home) => fiberProps(home)?.homeComposerMode === "chat" ? "chat" : "work",\n      discoverHomeRuntime: homeModeSupport.discover,\n      loadHomeRuntime: homeModeSupport.load,\n      createHomeBridge: homeModeSupport.createBridge,\n      bindHomeBridge: (bridge, home) => bridge.bind(nativeHomeRouteFiber(home)),\n      inspectSidebar: () => ({\n        active: unifiedSidebarActive,\n        trackedFiberCount: unifiedSidebarFibers.size,\n        lastError: unifiedSidebarLastError\n      }),\n      inspectComposer: () => ({ lastError: composerLastError }),\n      dispose() {\n        queuedFollowUpSupport.dispose();\n        try {\n          chatComposerSupport.dispose();\n        } finally {\n          restoreUnifiedSidebarMode();\n        }\n      }\n    };\n    function rootProductMode(root) {\n      const stack = [root];\n      const visited = /* @__PURE__ */ new Set();\n      const modes = /* @__PURE__ */ new Set();\n      while (stack.length && visited.size < 1e5) {\n        const fiber = stack.pop();\n        if (fiber == null || visited.has(fiber)) continue;\n        visited.add(fiber);\n        const mode = fiberProps(fiber)?.sidebarMode;\n        if (fiber.sibling) stack.push(fiber.sibling);\n        if (mode === "codex" || mode === "chatgpt") modes.add(mode);\n        else if (fiber.child) stack.push(fiber.child);\n      }\n      return modes.size === 1 ? [...modes][0] : null;\n    }\n    function reactFiberForElement(element) {\n      if (!(element instanceof Element)) return null;\n      for (const key of Object.getOwnPropertyNames(element)) {\n        if (key.startsWith("__reactFiber$")) return element[key] ?? null;\n        if (key.startsWith("__reactContainer$")) {\n          return element[key]?.current ?? element[key] ?? null;\n        }\n      }\n      return null;\n    }\n    function currentReactFiberRoot() {\n      const candidates = [\n        ...document.querySelectorAll(\n          \'[data-app-shell-main-surface], [class*="_MainContentSurface_"]\'\n        ),\n        document.body\n      ];\n      for (const candidate of candidates) {\n        let fiber = reactFiberForElement(candidate);\n        if (fiber == null) continue;\n        while (fiber.return != null) fiber = fiber.return;\n        return fiber.stateNode?.current ?? fiber.current ?? fiber;\n      }\n      return null;\n    }\n    function fiberProps(fiber) {\n      const props = fiber?.memoizedProps ?? fiber?.pendingProps;\n      return props != null && typeof props === "object" ? props : null;\n    }\n    function reconcileQueuedFollowUps(managerForThread) {\n      const root = currentReactFiberRoot();\n      if (root == null) return;\n      const scopes = /* @__PURE__ */ new Set();\n      const threadIds = /* @__PURE__ */ new Set();\n      const activeRow = document.querySelector(\n        \'[data-app-action-sidebar-thread-active="true"][data-app-action-sidebar-thread-id],[data-app-action-sidebar-thread-id][aria-current="page"]\'\n      );\n      if (activeRow?.dataset.appActionSidebarThreadId) threadIds.add(activeRow.dataset.appActionSidebarThreadId);\n      const addScope = (value) => {\n        if (value != null && typeof value.get === "function" && typeof value.set === "function" && value.scope != null) scopes.add(value);\n      };\n      const stack = [root];\n      const visited = /* @__PURE__ */ new Set();\n      while (stack.length && visited.size < 1e5) {\n        const fiber = stack.pop();\n        if (fiber == null || visited.has(fiber)) continue;\n        visited.add(fiber);\n        const followUp = fiberProps(fiber)?.followUp;\n        if (followUp?.type === "local" && typeof followUp.localConversationId === "string") {\n          threadIds.add(followUp.localConversationId);\n        }\n        const contexts = /* @__PURE__ */ new Set();\n        for (let context = fiber.dependencies?.firstContext; context && !contexts.has(context); context = context.next) {\n          contexts.add(context);\n          addScope(context.memoizedValue);\n        }\n        const hooks = /* @__PURE__ */ new Set();\n        for (let hook = fiber.memoizedState; hook && !hooks.has(hook); hook = hook.next) {\n          hooks.add(hook);\n          addScope(hook.memoizedState?.current);\n        }\n        if (fiber.sibling) stack.push(fiber.sibling);\n        if (fiber.child) stack.push(fiber.child);\n      }\n      for (const threadId of threadIds) {\n        for (const scope of scopes) {\n          let manager;\n          try {\n            manager = managerForThread(scope, threadId);\n          } catch {\n            continue;\n          }\n          if (manager?.getHostId?.() !== "local" || manager.getConversation?.(threadId) == null) continue;\n          const queue = manager.turnCoordinator?.serverQueue;\n          if (queue == null) continue;\n          if (!queuedFollowUpSupport.attach(queue)) {\n            throw new Error("Unsupported app build: server queue methods do not match");\n          }\n          break;\n        }\n      }\n    }\n    function reconcileChatComposer() {\n      const root = currentReactFiberRoot();\n      if (root == null) return;\n      const stack = [[root, null]];\n      const visited = /* @__PURE__ */ new Set();\n      const visibleViews = /* @__PURE__ */ new Set();\n      const retained = /* @__PURE__ */ new Set();\n      while (stack.length && visited.size < 1e5) {\n        const [fiber, parentView] = stack.pop();\n        if (fiber == null || visited.has(fiber)) continue;\n        visited.add(fiber);\n        const props = fiberProps(fiber);\n        const view = props != null && "composerConversationId" in props && "scrollStateConversationId" in props && "showComposer" in props && "hasRenderableTurns" in props ? fiber : parentView;\n        if (view != null) {\n          retained.add(view);\n          if (view.alternate) retained.add(view.alternate);\n          const node = fiber.stateNode;\n          if (node instanceof HTMLElement && node.hasAttribute("data-chatgpt-conversation-selection-target") && isVisible(node)) visibleViews.add(view);\n        }\n        if (fiber.sibling) stack.push([fiber.sibling, parentView]);\n        if (fiber.child) stack.push([fiber.child, view]);\n      }\n      chatComposerSupport.retain(retained);\n      for (const view of visibleViews) {\n        if (chatComposerSupport.repair(view)) diagnostics.chatComposerRecoveries += 1;\n      }\n    }\n    function isNativeUnifiedSidebarType(type) {\n      if (typeof type !== "function") return false;\n      if (nativeUnifiedSidebarTypes.has(type)) return nativeUnifiedSidebarTypes.get(type);\n      let matches = false;\n      try {\n        const source = Function.prototype.toString.call(type);\n        const projectSource = source.includes("includeChatGptProjects") || source.includes("chatGptSource") && source.includes("orderedPinnedProjectGroups") && source.includes("chatGptProjectTargets");\n        matches = source.includes("workCloudSidebarContentVisible") && source.includes("workLocalSidebarContentVisible") && projectSource && source.includes("sidebarElectron.chatGptWork.recents");\n      } catch {\n      }\n      nativeUnifiedSidebarTypes.set(type, matches);\n      return matches;\n    }\n    function nativeUnifiedSidebarFiber() {\n      const root = currentReactFiberRoot();\n      if (root == null) return null;\n      const stack = [root];\n      const visited = /* @__PURE__ */ new Set();\n      while (stack.length > 0 && visited.size < 1e5) {\n        const fiber = stack.pop();\n        if (fiber == null || visited.has(fiber)) continue;\n        visited.add(fiber);\n        if (isNativeUnifiedSidebarType(fiber.type ?? fiber.elementType)) return fiber;\n        if (fiber.sibling != null) stack.push(fiber.sibling);\n        if (fiber.child != null) stack.push(fiber.child);\n      }\n      return null;\n    }\n    function ancestorSidebarMode(fiber) {\n      for (let current = fiber?.return; current != null; current = current.return) {\n        const mode = fiberProps(current)?.sidebarMode;\n        if (mode === "codex" || mode === "chatgpt") return mode;\n      }\n      return null;\n    }\n    function trackUnifiedSidebarFiber(fiber) {\n      unifiedSidebarFibers.clear();\n      if (fiber != null) unifiedSidebarFibers.add(fiber);\n    }\n    function setFiberSidebarMode(fiber, mode) {\n      let changed = false;\n      const candidates = [fiber, fiber?.alternate].filter(Boolean);\n      for (const candidate of new Set(candidates)) {\n        for (const key of ["memoizedProps", "pendingProps"]) {\n          const props = candidate[key];\n          if (props == null || typeof props !== "object" || props.sidebarMode === mode) continue;\n          let updatedInPlace = false;\n          try {\n            props.sidebarMode = mode;\n            updatedInPlace = props.sidebarMode === mode;\n          } catch {\n          }\n          if (!updatedInPlace) candidate[key] = { ...props, sidebarMode: mode };\n          changed = true;\n        }\n      }\n      return changed;\n    }\n    function looksLikeBasicStateReducer(reducer) {\n      if (typeof reducer !== "function") return false;\n      try {\n        const source = Function.prototype.toString.call(reducer);\n        return source.includes("typeof") && source.includes("function") && source.includes("?") && source.includes(":");\n      } catch {\n        return false;\n      }\n    }\n    function requestFiberRender(fiber) {\n      let fallback = null;\n      for (const candidate of new Set([fiber, fiber?.alternate].filter(Boolean))) {\n        let hook = candidate.memoizedState;\n        const visitedHooks = /* @__PURE__ */ new Set();\n        while (hook != null && typeof hook === "object" && visitedHooks.size < 1e3) {\n          if (visitedHooks.has(hook)) break;\n          visitedHooks.add(hook);\n          const state = hook.memoizedState;\n          const queue = hook.queue;\n          if (state instanceof Map && typeof queue?.dispatch === "function") {\n            const record = { dispatch: queue.dispatch, state };\n            if (looksLikeBasicStateReducer(queue.lastRenderedReducer)) {\n              queue.dispatch(new Map(state));\n              return true;\n            }\n            fallback ??= record;\n          }\n          hook = hook.next;\n        }\n      }\n      if (fallback != null) {\n        fallback.dispatch(new Map(fallback.state));\n        return true;\n      }\n      return false;\n    }\n    function reconcileUnifiedSidebarMode() {\n      const fiber = nativeUnifiedSidebarFiber();\n      if (fiber == null) {\n        unifiedSidebarActive = false;\n        unifiedSidebarLastError = rootProductMode(currentReactFiberRoot()) === "codex" ? "The native unified sidebar component was not found" : null;\n        return;\n      }\n      const props = fiberProps(fiber);\n      const parentMode = ancestorSidebarMode(fiber);\n      if (props?.sidebarMode === "chatgpt") {\n        unifiedSidebarActive = parentMode === "codex";\n        if (unifiedSidebarActive) trackUnifiedSidebarFiber(fiber);\n        return;\n      }\n      if (props?.sidebarMode !== "codex") {\n        unifiedSidebarActive = false;\n        return;\n      }\n      try {\n        trackUnifiedSidebarFiber(fiber);\n        setFiberSidebarMode(fiber, "chatgpt");\n        diagnostics.unifiedSidebarPatches += 1;\n        if (requestFiberRender(fiber)) {\n          diagnostics.unifiedSidebarRenderRequests += 1;\n          unifiedSidebarLastError = null;\n        } else {\n          diagnostics.unifiedSidebarRenderErrors += 1;\n          unifiedSidebarLastError = "The native unified sidebar render queue was not found";\n        }\n        unifiedSidebarActive = true;\n      } catch (error) {\n        unifiedSidebarActive = false;\n        unifiedSidebarLastError = String(error?.stack || error);\n        diagnostics.unifiedSidebarRenderErrors += 1;\n      }\n    }\n    function restoreUnifiedSidebarMode() {\n      const liveFiber = nativeUnifiedSidebarFiber();\n      const candidates = new Set(unifiedSidebarFibers);\n      if (liveFiber != null) candidates.add(liveFiber);\n      for (const fiber of candidates) {\n        if (ancestorSidebarMode(fiber) !== "codex") continue;\n        if (fiberProps(fiber)?.sidebarMode !== "chatgpt") continue;\n        try {\n          setFiberSidebarMode(fiber, "codex");\n          requestFiberRender(fiber);\n          diagnostics.unifiedSidebarRestores += 1;\n        } catch {\n        }\n      }\n      unifiedSidebarFibers.clear();\n      unifiedSidebarActive = false;\n    }\n    function nativeCodexHomeTypePriority(type) {\n      if (typeof type !== "function") return 0;\n      if (nativeCodexHomeTypes.has(type)) {\n        return nativeCodexHomeTypes.get(type);\n      }\n      let priority = 0;\n      try {\n        const source = Function.prototype.toString.call(type);\n        const commonHomeProps = source.includes("homeComposerModeToggle") && source.includes("homeComposerController") && source.includes("showHomeUtilityBar");\n        if (commonHomeProps && source.includes("fileDropTarget") && source.includes("followUpSuggestionsPlacement")) {\n          priority = 2;\n        } else if (commonHomeProps && source.includes("home-main-content")) {\n          priority = 1;\n        }\n      } catch {\n      }\n      nativeCodexHomeTypes.set(type, priority);\n      return priority;\n    }\n    function nativeCodexHomeFiber() {\n      const root = currentReactFiberRoot();\n      if (root == null || rootProductMode(root) !== "codex") return null;\n      const stack = [root];\n      const visited = /* @__PURE__ */ new Set();\n      let fallback = null;\n      while (stack.length > 0 && visited.size < 1e5) {\n        const fiber = stack.pop();\n        if (fiber == null || visited.has(fiber)) continue;\n        visited.add(fiber);\n        const priority = nativeCodexHomeTypePriority(fiber.type ?? fiber.elementType);\n        if (priority >= 2) return fiber;\n        if (priority === 1) fallback ??= fiber;\n        if (fiber.sibling != null) stack.push(fiber.sibling);\n        if (fiber.child != null) stack.push(fiber.child);\n      }\n      return fallback;\n    }\n    function isNativeHomeRouteType(type) {\n      if (typeof type !== "function") return false;\n      if (nativeHomeRouteTypes.has(type)) return nativeHomeRouteTypes.get(type);\n      let matches = false;\n      try {\n        const source = Function.prototype.toString.call(type);\n        const modeControl = source.includes("HomeComposerMode") || source.includes("isModeToggleBlocked") && (source.includes("workModeRequiresUpgrade") || source.includes("workModeUpgradePlan")) && source.includes("onModeChange");\n        const composerInput = source.includes("composerPlainTextMode") || source.includes("getInitialContent") && source.includes("getInitialInput") && source.includes("onDocumentChange");\n        matches = modeControl && composerInput && source.includes("sharedSnapshotId") && source.includes("workOnlyModeEnabled") && source.includes("routeProjectId");\n      } catch {\n      }\n      nativeHomeRouteTypes.set(type, matches);\n      return matches;\n    }\n    function homeComposerStoreForFiber(homeFiber) {\n      function isComposerStore(value) {\n        return value != null && typeof value === "object" && typeof value.get === "function" && typeof value.set === "function" && value.scope != null;\n      }\n      const route = nativeHomeRouteFiber(homeFiber);\n      if (route == null) return null;\n      let fallback = null;\n      for (let current = route; current != null; current = current.return) {\n        const isHomeRoute = isNativeHomeRouteType(current.type ?? current.elementType);\n        for (const candidate of new Set([current, current.alternate].filter(Boolean))) {\n          let context = candidate.dependencies?.firstContext;\n          const visitedContexts = /* @__PURE__ */ new Set();\n          while (context != null && typeof context === "object" && visitedContexts.size < 1e3) {\n            if (visitedContexts.has(context)) break;\n            visitedContexts.add(context);\n            const value = context.memoizedValue;\n            if (isComposerStore(value)) {\n              if (value.value?.entrypoint === "home" && value.value?.kind === "new") {\n                return value;\n              }\n              if (isHomeRoute) fallback ??= value;\n            }\n            context = context.next;\n          }\n          let hook = candidate.memoizedState;\n          const visitedHooks = /* @__PURE__ */ new Set();\n          while (hook != null && typeof hook === "object" && visitedHooks.size < 1e3) {\n            if (visitedHooks.has(hook)) break;\n            visitedHooks.add(hook);\n            const value = hook.memoizedState?.current;\n            if (isComposerStore(value)) {\n              if (value.value?.entrypoint === "home" && value.value?.kind === "new") {\n                return value;\n              }\n              if (isHomeRoute) fallback ??= value;\n            }\n            hook = hook.next;\n          }\n        }\n        if (isHomeRoute) break;\n      }\n      return fallback;\n    }\n    function nativeHomeRouteFiber(homeFiber) {\n      for (let fiber = homeFiber; fiber != null; fiber = fiber.return) {\n        if (isNativeHomeRouteType(fiber.type ?? fiber.elementType)) return fiber;\n      }\n      return null;\n    }\n  }\n\n  // src/page/native-ui.mjs\n  function createNativeUiController({ diagnostics, scheduleStructure, timings, getMainSurface }) {\n    const CHAT_WORK_TRANSITION_GRACE_MS = Number(timings?.chatWorkTransitionGraceMs) || 600;\n    const compatibility = createNativeCompatibility({ diagnostics });\n    let disposed = false;\n    let chatWorkToggleRuntime = null;\n    let chatWorkToggleRuntimePromise = null;\n    let chatWorkToggleRenderInFlight = false;\n    let chatWorkToggleRenderRequested = false;\n    let chatWorkToggleLastError = null;\n    let chatWorkToggleStore = null;\n    let chatWorkModeBridge = null;\n    let chatWorkModePending = null;\n    let chatWorkModeDeadline = 0;\n    let chatWorkToggleClickHandler = null;\n    let chatWorkToggleTransitionMode = null;\n    let chatWorkToggleTransitionTimer = 0;\n    let chatWorkToggleHost = null;\n    let chatWorkToggleMode = null;\n    let queueManagerLookup = null;\n    let queueRuntimePromise = null;\n    let queueRuntimeLastError = null;\n    let queueInteractionHandler = null;\n    let runtimeAsset = null;\n    let chatWorkToggleRetryAfter = 0;\n    return {\n      install() {\n        if (disposed) return;\n        installChatWorkToggleClickBridge();\n        if (queueInteractionHandler == null) {\n          queueInteractionHandler = (event) => {\n            if (event.type === "keydown" && event.key !== "Enter" && event.key !== "ArrowUp") return;\n            reconcileQueuedFollowUps();\n          };\n          document.addEventListener("pointerdown", queueInteractionHandler, true);\n          document.addEventListener("keydown", queueInteractionHandler, true);\n        }\n      },\n      reconcile() {\n        if (disposed) return;\n        compatibility.reconcileSidebar();\n        scheduleChatWorkToggleRender();\n        reconcileQueuedFollowUps();\n      },\n      reconcileHome: scheduleChatWorkToggleRender,\n      reconcileComposer() {\n        if (!disposed) compatibility.reconcileComposer();\n      },\n      hasPendingMode: () => chatWorkModePending != null,\n      inspect,\n      dispose\n    };\n    function inspect() {\n      return {\n        unifiedSidebar: compatibility.inspectSidebar(),\n        chatComposer: compatibility.inspectComposer(),\n        queuedFollowUps: {\n          ...compatibility.inspectQueuedFollowUps(),\n          loaded: queueManagerLookup != null,\n          loadError: queueRuntimeLastError\n        },\n        chatWorkToggle: {\n          loaded: chatWorkToggleRuntime != null,\n          loading: chatWorkToggleRuntimePromise != null && chatWorkToggleRuntime == null && chatWorkToggleLastError == null,\n          mounted: document.querySelector(".codex-theme-native-chat-work-toggle")?.isConnected === true,\n          standaloneMounted: nativeChatWorkToggleNode()?.isConnected === true,\n          mode: chatWorkToggleMode,\n          pendingMode: chatWorkModePending,\n          bridge: chatWorkModeBridge?.inspect() ?? null,\n          nativeExports: chatWorkToggleRuntime?.names ?? null,\n          transitionMode: chatWorkToggleTransitionMode,\n          lastError: chatWorkToggleLastError\n        }\n      };\n    }\n    function dispose() {\n      if (disposed) return;\n      disposed = true;\n      if (queueInteractionHandler != null) {\n        document.removeEventListener("pointerdown", queueInteractionHandler, true);\n        document.removeEventListener("keydown", queueInteractionHandler, true);\n        queueInteractionHandler = null;\n      }\n      if (chatWorkToggleClickHandler != null) {\n        document.removeEventListener("click", chatWorkToggleClickHandler, true);\n        chatWorkToggleClickHandler = null;\n      }\n      finishChatWorkToggleTransition();\n      chatWorkModePending = null;\n      chatWorkModeBridge?.dispose();\n      chatWorkModeBridge = null;\n      chatWorkToggleStore = null;\n      removeChatWorkToggleHost();\n      compatibility.dispose();\n      chatWorkToggleRuntime = null;\n      chatWorkToggleRuntimePromise = null;\n      chatWorkToggleRenderInFlight = false;\n      chatWorkToggleRenderRequested = false;\n      queueManagerLookup = null;\n      runtimeAsset = null;\n    }\n    function reconcileQueuedFollowUps() {\n      if (disposed || /^\\/settings(?:\\/|$)/.test(location.pathname)) return;\n      if (queueManagerLookup != null) {\n        compatibility.reconcileQueuedFollowUps(queueManagerLookup);\n        return;\n      }\n      if (queueRuntimePromise != null || appInitialAssetUrl() == null) return;\n      queueRuntimePromise = chatWorkToggleRuntimeAsset().then(async ({ appInitialSource, appInitialUrl }) => {\n        const name = discoverQueueManagerExport(appInitialSource);\n        const module = await import(appInitialUrl);\n        if (typeof module[name] !== "function") throw new Error("The queued-message manager lookup is unavailable");\n        if (disposed) return;\n        queueManagerLookup = module[name];\n        compatibility.reconcileQueuedFollowUps(queueManagerLookup);\n      }).catch((error) => {\n        if (!disposed) queueRuntimeLastError = String(error?.message || error);\n      });\n    }\n    function resourceAssetUrl(pattern) {\n      try {\n        const entries = performance.getEntriesByType?.("resource") ?? [];\n        for (const entry of entries) {\n          if (typeof entry?.name === "string" && pattern.test(entry.name)) return entry.name;\n        }\n      } catch {\n      }\n      return null;\n    }\n    function linkedAssetUrl(pattern) {\n      try {\n        for (const link of document.querySelectorAll("link[href]")) {\n          const href = typeof link.href === "string" && link.href ? link.href : new URL(link.getAttribute("href"), document.baseURI).href;\n          if (pattern.test(href)) return href;\n        }\n      } catch {\n      }\n      return null;\n    }\n    function appInitialAssetUrl() {\n      const pattern = /\\/app-initial-[^/]+\\.js(?:[?#]|$)/;\n      return resourceAssetUrl(pattern) ?? linkedAssetUrl(pattern);\n    }\n    async function chatWorkToggleRuntimeAsset() {\n      const appInitialUrl = appInitialAssetUrl();\n      if (appInitialUrl == null) {\n        throw new Error("Codex app-initial asset was not found");\n      }\n      if (runtimeAsset?.url !== appInitialUrl) {\n        const record = { url: appInitialUrl, promise: null };\n        record.promise = fetch(appInitialUrl).then(async (response) => {\n          if (!response.ok) throw new Error(`Codex app asset request failed: ${response.status}`);\n          const appInitialSource = await response.text();\n          if (runtimeAsset === record) runtimeAsset = null;\n          return { appInitialSource, appInitialUrl };\n        }).catch((error) => {\n          if (runtimeAsset === record) runtimeAsset = null;\n          throw error;\n        });\n        runtimeAsset = record;\n      }\n      return runtimeAsset.promise;\n    }\n    async function loadChatWorkToggleRuntime() {\n      const testLoader = globalThis.__codexThemeChatWorkToggleLoader;\n      if (typeof testLoader === "function") {\n        const loaded = await testLoader();\n        if (["setMode", "readPreference", "canChat", "subscriptionAtoms", "flushSync"].some((key) => typeof loaded?.[key] !== "function")) {\n          throw new Error("The Chat/Work mode test loader returned an invalid runtime");\n        }\n        return loaded;\n      }\n      const { appInitialSource, appInitialUrl } = await chatWorkToggleRuntimeAsset();\n      const names = compatibility.discoverHomeRuntime(appInitialSource);\n      const paths = [...new Set(Object.values(names).flat().filter((reference) => typeof reference?.path === "string").map((reference) => reference.path))];\n      const [appInitialModule, importedModules] = await Promise.all([\n        import(appInitialUrl),\n        Promise.all(paths.map(async (path) => [path, await import(new URL(path, appInitialUrl).href)]))\n      ]);\n      const modules = Object.fromEntries(importedModules);\n      const reactDomModule = modules[names.reactDomImport?.path];\n      return {\n        ...compatibility.loadHomeRuntime(appInitialSource, appInitialModule, reactDomModule, names, modules),\n        appInitialUrl\n      };\n    }\n    async function ensureChatWorkToggleRuntime() {\n      if (chatWorkToggleRuntime != null) return chatWorkToggleRuntime;\n      if (Date.now() < chatWorkToggleRetryAfter) throw new Error(chatWorkToggleLastError);\n      if (chatWorkToggleRuntimePromise == null) {\n        chatWorkToggleRuntimePromise = loadChatWorkToggleRuntime().then((loaded) => {\n          if (disposed) return loaded;\n          chatWorkToggleRuntime = loaded;\n          chatWorkToggleLastError = null;\n          diagnostics.chatWorkToggleLoads += 1;\n          return loaded;\n        }).catch((error) => {\n          if (disposed) throw error;\n          chatWorkToggleLastError = String(error?.stack || error);\n          diagnostics.chatWorkToggleLoadErrors += 1;\n          if (!String(error?.message).startsWith("Unsupported app build:")) {\n            chatWorkToggleRuntimePromise = null;\n            chatWorkToggleRetryAfter = Date.now() + 5e3;\n          }\n          throw error;\n        });\n      }\n      return chatWorkToggleRuntimePromise;\n    }\n    function finishChatWorkToggleTransition() {\n      chatWorkToggleTransitionMode = null;\n      if (chatWorkToggleTransitionTimer) clearTimeout(chatWorkToggleTransitionTimer);\n      chatWorkToggleTransitionTimer = 0;\n      if (document.documentElement) {\n        removeAttributeIfPresent(\n          document.documentElement,\n          "data-codex-theme-chat-work-transition"\n        );\n      }\n    }\n    function beginChatWorkToggleTransition(mode) {\n      finishChatWorkToggleTransition();\n      chatWorkToggleTransitionMode = mode;\n      if (document.documentElement) {\n        setAttributeIfChanged(\n          document.documentElement,\n          "data-codex-theme-chat-work-transition",\n          mode\n        );\n      }\n      chatWorkToggleTransitionTimer = setTimeout(() => {\n        chatWorkToggleTransitionTimer = 0;\n        chatWorkToggleTransitionMode = null;\n        if (document.documentElement) {\n          removeAttributeIfPresent(\n            document.documentElement,\n            "data-codex-theme-chat-work-transition"\n          );\n        }\n        scheduleStructure("chat-work-transition-timeout");\n      }, CHAT_WORK_TRANSITION_GRACE_MS);\n    }\n    function requestChatWorkMode(mode) {\n      if (mode !== "chat" && mode !== "work") return false;\n      if (chatWorkModePending != null || mode === chatWorkToggleMode) return false;\n      const homeFiber = compatibility.findHome();\n      if (homeFiber == null || chatWorkToggleRuntime == null) {\n        chatWorkToggleLastError = "The live Codex Home component was not found";\n        diagnostics.chatWorkToggleModeSwitchErrors += 1;\n        return false;\n      }\n      const store = compatibility.homeStore(homeFiber) ?? chatWorkToggleStore;\n      if (store == null) {\n        chatWorkToggleLastError = "The live Codex Home composer store was not found";\n        diagnostics.chatWorkToggleModeSwitchErrors += 1;\n        return false;\n      }\n      try {\n        connectChatWorkMode(homeFiber, store);\n        beginChatWorkToggleTransition(mode);\n        chatWorkModePending = mode;\n        chatWorkModeDeadline = Date.now() + 2e3;\n        chatWorkToggleLastError = null;\n        updateChatWorkToggleElementMode(chatWorkToggleHost);\n        chatWorkModeBridge.request(mode);\n        scheduleStructure("chat-work-request");\n        return true;\n      } catch (error) {\n        chatWorkModePending = null;\n        finishChatWorkToggleTransition();\n        chatWorkToggleLastError = String(error?.stack || error);\n        diagnostics.chatWorkToggleModeSwitchErrors += 1;\n        updateChatWorkToggleElementMode(chatWorkToggleHost);\n        return false;\n      }\n    }\n    function connectChatWorkMode(homeFiber, store) {\n      if (chatWorkToggleStore !== store || chatWorkModeBridge == null) {\n        chatWorkModeBridge?.dispose();\n        chatWorkModeBridge = compatibility.createHomeBridge(chatWorkToggleRuntime, store);\n        chatWorkToggleStore = store;\n      }\n      compatibility.bindHomeBridge(chatWorkModeBridge, homeFiber);\n    }\n    function reconcileChatWorkMode(homeFiber) {\n      const actual = compatibility.homeMode(homeFiber);\n      if (chatWorkModePending === actual) {\n        diagnostics.chatWorkToggleModeSwitches += 1;\n        chatWorkModePending = null;\n        chatWorkToggleLastError = null;\n      }\n      chatWorkToggleMode = actual;\n    }\n    function nativeChatWorkToggleNode() {\n      return chatWorkToggleHost?.querySelector(".codex-theme-native-chat-work-toggle") ?? null;\n    }\n    function updateChatWorkToggleElementMode(element, mode = chatWorkToggleMode) {\n      if (!(element instanceof HTMLElement)) return;\n      const buttons = Array.from(element.querySelectorAll("button"));\n      for (let index = 0; index < buttons.length; index += 1) {\n        const buttonMode = index === 0 ? "chat" : index === 1 ? "work" : null;\n        if (buttonMode == null) continue;\n        const active = buttonMode === mode;\n        setAttributeIfChanged(buttons[index], "aria-pressed", String(active));\n        buttons[index].disabled = chatWorkModePending != null;\n        buttons[index].classList.toggle("text-default", active);\n        buttons[index].classList.toggle("text-mode-toggle-inactive", !active);\n        buttons[index].classList.toggle("hover:text-default", !active);\n        buttons[index].classList.toggle("focus-visible:text-default", !active);\n      }\n      setAttributeIfChanged(element, "aria-busy", String(chatWorkModePending != null));\n      if (chatWorkToggleLastError) setAttributeIfChanged(element, "title", chatWorkToggleLastError);\n      else removeAttributeIfPresent(element, "title");\n      const indicator = element.querySelector(".codex-theme-chat-work-indicator");\n      if (indicator instanceof HTMLElement) {\n        indicator.style.transition = "none";\n        indicator.style.transform = mode === "chat" ? "translateX(calc((0% - 0px) * var(--mode-toggle-direction)))" : "translateX(calc((100% - 17px) * var(--mode-toggle-direction)))";\n      }\n    }\n    function removeChatWorkToggleHost() {\n      if (chatWorkToggleHost instanceof HTMLElement) {\n        chatWorkToggleHost.remove();\n        diagnostics.chatWorkToggleRemoves += 1;\n      }\n      chatWorkToggleHost = null;\n    }\n    function createChatWorkToggleButton(mode, label) {\n      const button = document.createElement("button");\n      button.type = "button";\n      button.dataset.mode = mode;\n      button.className = "codex-theme-chat-work-button";\n      button.textContent = label;\n      return button;\n    }\n    function ensureChatWorkToggleHost() {\n      if (!(document.body instanceof HTMLElement)) return null;\n      if (!(chatWorkToggleHost instanceof HTMLElement) || !chatWorkToggleHost.isConnected) {\n        const host = markOwned(document.createElement("div"));\n        host.className = "codex-theme-chat-work-toggle-host";\n        host.setAttribute("data-codex-theme-chat-work-toggle-host", "true");\n        const toggle = document.createElement("div");\n        toggle.className = "codex-theme-native-chat-work-toggle";\n        toggle.setAttribute("role", "group");\n        toggle.setAttribute("aria-label", "Composer mode");\n        const track = document.createElement("span");\n        track.className = "codex-theme-chat-work-track";\n        track.setAttribute("aria-hidden", "true");\n        const indicator = document.createElement("span");\n        indicator.className = "codex-theme-chat-work-indicator";\n        indicator.setAttribute("aria-hidden", "true");\n        toggle.append(\n          track,\n          indicator,\n          createChatWorkToggleButton("chat", "Chat"),\n          createChatWorkToggleButton("work", "Work")\n        );\n        host.append(toggle);\n        document.body.append(host);\n        chatWorkToggleHost = host;\n        diagnostics.chatWorkToggleMounts += 1;\n      }\n      const surface = getMainSurface();\n      if (surface instanceof HTMLElement) {\n        const rect = surface.getBoundingClientRect();\n        setStylePropertyIfChanged(chatWorkToggleHost, "left", `${rect.left}px`);\n        setStylePropertyIfChanged(chatWorkToggleHost, "top", `${rect.top}px`);\n        setStylePropertyIfChanged(chatWorkToggleHost, "width", `${rect.width}px`);\n      }\n      updateChatWorkToggleElementMode(chatWorkToggleHost);\n      return chatWorkToggleHost;\n    }\n    function installChatWorkToggleClickBridge() {\n      if (chatWorkToggleClickHandler != null) return;\n      chatWorkToggleClickHandler = (event) => {\n        const target = event.target instanceof Element ? event.target : null;\n        if (target?.closest(".app-shell-left-panel") != null && !isOwnedNode(target)) {\n          scheduleStructure("sidebar-navigation");\n        }\n        const button = target?.closest(".codex-theme-native-chat-work-toggle button");\n        if (!(button instanceof HTMLButtonElement) || button.disabled) return;\n        const toggle = button.closest(".codex-theme-native-chat-work-toggle");\n        if (!(toggle instanceof HTMLElement)) return;\n        const buttons = Array.from(toggle.querySelectorAll("button"));\n        const index = buttons.indexOf(button);\n        const mode = index === 0 ? "chat" : index === 1 ? "work" : null;\n        if (mode == null || button.getAttribute("aria-pressed") === "true") return;\n        event.preventDefault();\n        event.stopImmediatePropagation();\n        requestChatWorkMode(mode);\n      };\n      document.addEventListener("click", chatWorkToggleClickHandler, true);\n    }\n    function reportChatWorkToggleRenderError(error) {\n      if (disposed) return;\n      chatWorkToggleLastError = String(error?.stack || error);\n      diagnostics.chatWorkToggleRenderErrors += 1;\n    }\n    async function renderNativeChatWorkToggle() {\n      if (disposed || !document.documentElement) return;\n      if (chatWorkModePending != null && Date.now() > chatWorkModeDeadline) {\n        chatWorkModePending = null;\n        try {\n          chatWorkModeBridge?.cancel();\n        } catch {\n        }\n        chatWorkToggleLastError = "The app did not finish switching Home mode";\n        diagnostics.chatWorkToggleModeSwitchErrors += 1;\n        finishChatWorkToggleTransition();\n      }\n      let homeFiber = compatibility.findHome();\n      if (homeFiber == null) {\n        if (chatWorkToggleTransitionMode != null || chatWorkModePending != null) {\n          ensureChatWorkToggleHost();\n          return;\n        }\n        chatWorkToggleStore = null;\n        chatWorkModeBridge?.dispose();\n        chatWorkModeBridge = null;\n        removeChatWorkToggleHost();\n        return;\n      }\n      try {\n        await ensureChatWorkToggleRuntime();\n      } catch {\n        return;\n      }\n      if (disposed) return;\n      homeFiber = compatibility.findHome();\n      if (homeFiber == null) {\n        if (chatWorkToggleTransitionMode != null || chatWorkModePending != null) {\n          ensureChatWorkToggleHost();\n          return;\n        }\n        chatWorkToggleStore = null;\n        chatWorkModeBridge?.dispose();\n        chatWorkModeBridge = null;\n        removeChatWorkToggleHost();\n        return;\n      }\n      const store = compatibility.homeStore(homeFiber);\n      if (store == null) {\n        throw new Error("The live Codex Home composer store was not found");\n      }\n      connectChatWorkMode(homeFiber, store);\n      reconcileChatWorkMode(homeFiber);\n      ensureChatWorkToggleHost();\n    }\n    function scheduleChatWorkToggleRender() {\n      if (disposed) return;\n      if (chatWorkToggleRenderInFlight) {\n        chatWorkToggleRenderRequested = true;\n        return;\n      }\n      chatWorkToggleRenderInFlight = true;\n      void renderNativeChatWorkToggle().catch(reportChatWorkToggleRenderError).finally(() => {\n        chatWorkToggleRenderInFlight = false;\n        if (chatWorkToggleRenderRequested && !disposed) {\n          chatWorkToggleRenderRequested = false;\n          scheduleChatWorkToggleRender();\n        }\n      });\n    }\n  }\n\n  // src/page/usage-panel.mjs\n  var USAGE_PANEL_ID = "codex-theme-usage-panel";\n  function createUsageController({ getConfig, retainedUsage, onUsage, scheduleRender }) {\n    const USAGE_CACHE_KEY = "codex-theme-usage-cache";\n    const USAGE_REFRESH_MS = 60 * 1e3;\n    const uiState = { usage: retainedUsage ?? null, usageError: null };\n    let installed = false;\n    let disposed = false;\n    let usageTimer = 0;\n    let usageFetchInFlight = null;\n    let cancelUsageFetch = null;\n    loadCachedUsage();\n    function configure() {\n      if (!installed || disposed) return;\n      if (getConfig().usageManagedByHost === true) {\n        if (usageTimer) clearInterval(usageTimer);\n        usageTimer = 0;\n        cancelUsageFetch?.();\n      } else if (!usageTimer) {\n        usageTimer = setInterval(refreshUsage, USAGE_REFRESH_MS);\n        void refreshUsage();\n      }\n    }\n    return {\n      configure,\n      install() {\n        installed = true;\n        configure();\n      },\n      render: renderUsagePanel,\n      update(usage) {\n        if (disposed || usage == null || usageEqual(uiState.usage, usage)) return false;\n        uiState.usage = usage;\n        uiState.usageError = null;\n        try {\n          localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(usage));\n        } catch {\n        }\n        return true;\n      },\n      get value() {\n        return uiState.usage;\n      },\n      get running() {\n        return usageTimer !== 0;\n      },\n      inspect() {\n        const panel = document.getElementById(USAGE_PANEL_ID);\n        return {\n          value: uiState.usage,\n          placement: panel?.getAttribute("data-placement") ?? null,\n          remainingPercent: panel?.getAttribute("data-remaining-percent") ?? null\n        };\n      },\n      dispose() {\n        if (disposed) return;\n        disposed = true;\n        if (usageTimer) clearInterval(usageTimer);\n        usageTimer = 0;\n        cancelUsageFetch?.();\n        document.getElementById(USAGE_PANEL_ID)?.remove();\n      }\n    };\n    function loadCachedUsage() {\n      if (uiState.usage != null) return;\n      try {\n        const cached = JSON.parse(localStorage.getItem(USAGE_CACHE_KEY) || "null");\n        const cacheIsFresh = Number.isFinite(cached?.capturedAtMs) && Date.now() - cached.capturedAtMs <= 6 * 60 * 60 * 1e3;\n        const resetIsValid = !Number.isFinite(cached?.resetAtMs) || cached.resetAtMs > Date.now();\n        if (cacheIsFresh && resetIsValid) uiState.usage = cached;\n      } catch {\n      }\n    }\n    function usageEqual(left, right) {\n      return left === right || left != null && right != null && left.remainingPercent === right.remainingPercent && left.resetAtMs === right.resetAtMs && left.resetLabel === right.resetLabel && left.capturedAtMs === right.capturedAtMs;\n    }\n    function normalizeUsagePayload(payload) {\n      const rateLimit = payload?.rate_limit;\n      if (rateLimit == null || typeof rateLimit !== "object") return null;\n      const windows = [rateLimit.primary_window, rateLimit.secondary_window].filter((window2) => window2 != null && Number.isFinite(Number(window2.used_percent))).map((window2) => ({\n        usedPercent: Number(window2.used_percent),\n        windowSeconds: Number(window2.limit_window_seconds) || 0,\n        resetAtSeconds: Number(window2.reset_at)\n      }));\n      if (windows.length === 0) return null;\n      const limitingWindow = windows.reduce((current, candidate) => {\n        if (candidate.usedPercent > current.usedPercent) return candidate;\n        if (candidate.usedPercent === current.usedPercent && candidate.windowSeconds > current.windowSeconds) {\n          return candidate;\n        }\n        return current;\n      });\n      return {\n        remainingPercent: Math.round(\n          Math.min(100, Math.max(0, 100 - limitingWindow.usedPercent))\n        ),\n        resetAtMs: Number.isFinite(limitingWindow.resetAtSeconds) ? limitingWindow.resetAtSeconds * 1e3 : null,\n        capturedAtMs: Date.now()\n      };\n    }\n    function fetchUsagePayload() {\n      return new Promise((resolve, reject) => {\n        const bridge = globalThis.electronBridge;\n        if (typeof bridge?.sendMessageFromView !== "function") {\n          reject(new Error("앱 요청 통로를 찾지 못했습니다"));\n          return;\n        }\n        const requestId = globalThis.crypto?.randomUUID?.() || `codex-theme-${Date.now()}-${Math.random().toString(16).slice(2)}`;\n        let settled = false;\n        let timeout = 0;\n        const finish = (callback, value) => {\n          if (settled) return;\n          settled = true;\n          clearTimeout(timeout);\n          cancelUsageFetch = null;\n          window.removeEventListener("message", onMessage);\n          callback(value);\n        };\n        const onMessage = (event) => {\n          const message = event.data;\n          if (message?.type !== "fetch-response" || message.requestId !== requestId) return;\n          if (message.responseType !== "success") {\n            finish(reject, new Error(message.error || "사용량 요청이 실패했습니다"));\n            return;\n          }\n          try {\n            finish(resolve, JSON.parse(message.bodyJsonString || "null"));\n          } catch (error) {\n            finish(reject, error);\n          }\n        };\n        timeout = setTimeout(() => {\n          finish(reject, new Error("사용량 요청 시간이 초과되었습니다"));\n        }, 1e4);\n        cancelUsageFetch = () => finish(reject, new Error("Usage request cancelled"));\n        window.addEventListener("message", onMessage);\n        Promise.resolve().then(() => {\n          if (settled || disposed || getConfig().usageManagedByHost === true) return;\n          return bridge.sendMessageFromView({\n            type: "fetch",\n            requestId,\n            method: "GET",\n            url: "/wham/usage",\n            headers: {\n              "X-OpenAI-Attach-Auth": "1",\n              "X-OpenAI-Attach-Integrity-State": "1",\n              "OAI-Language": navigator.language || "en",\n              originator: "Codex Desktop"\n            }\n          });\n        }).catch((error) => finish(reject, error));\n      });\n    }\n    async function refreshUsage() {\n      if (disposed || usageFetchInFlight) return usageFetchInFlight;\n      usageFetchInFlight = (async () => {\n        try {\n          const usage = normalizeUsagePayload(await fetchUsagePayload());\n          if (disposed || getConfig().usageManagedByHost === true) return;\n          if (usage == null) throw new Error("사용량 응답 형식이 올바르지 않습니다");\n          uiState.usageError = null;\n          onUsage(usage);\n        } catch (error) {\n          if (disposed || getConfig().usageManagedByHost === true) return;\n          const message = error instanceof Error ? error.message : String(error);\n          if (uiState.usageError !== message) {\n            uiState.usageError = message;\n            scheduleRender();\n          }\n        } finally {\n          usageFetchInFlight = null;\n        }\n      })();\n      return usageFetchInFlight;\n    }\n    function formatUsage(usage) {\n      if (!usage || !Number.isFinite(usage.remainingPercent)) {\n        return {\n          value: "—",\n          month: "—",\n          day: "—",\n          title: uiState.usageError || "使用量を確認中です",\n          remainingPercent: null\n        };\n      }\n      let resetTitle = "";\n      let month = "—";\n      let day = "—";\n      const resetDate = Number.isFinite(usage.resetAtMs) ? new Date(usage.resetAtMs) : null;\n      if (resetDate && Number.isFinite(resetDate.getTime())) {\n        month = String(resetDate.getMonth() + 1);\n        day = String(resetDate.getDate());\n        resetTitle = new Intl.DateTimeFormat("ja-JP", {\n          dateStyle: "medium",\n          timeStyle: "short"\n        }).format(resetDate);\n      } else if (typeof usage.resetLabel === "string") {\n        resetTitle = usage.resetLabel.trim();\n      }\n      const remainingPercent = Math.round(Math.min(100, Math.max(0, usage.remainingPercent)));\n      return {\n        value: String(remainingPercent),\n        month,\n        day,\n        title: resetTitle ? `使用量 ${remainingPercent}% 残り · ${resetTitle}リセット` : `使用量 ${remainingPercent}% 残り · 更新時刻を確認中…`,\n        remainingPercent\n      };\n    }\n    function findSidebarFooterContext() {\n      for (const rail of document.querySelectorAll("[data-app-navigation-rail]")) {\n        if (!isVisible(rail)) continue;\n        const footerRow2 = rail.querySelector(":scope > .relative.shrink-0.w-9:has(> .flex.flex-col > .flex button)");\n        if (footerRow2 instanceof HTMLElement && isVisible(footerRow2)) {\n          return { footerRow: footerRow2, placement: "rail" };\n        }\n      }\n      const panel = document.querySelector(".app-shell-left-panel");\n      if (!(panel instanceof HTMLElement)) return null;\n      const scroll = panel.querySelector("[data-app-action-sidebar-scroll]");\n      if (!(scroll instanceof HTMLElement)) return null;\n      const profileButtons = Array.from(panel.querySelectorAll("button.sidebar-item, .sidebar-item button")).filter((button) => !scroll.contains(button) && isVisible(button)).sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom);\n      const profileButton = profileButtons[0];\n      if (!(profileButton instanceof HTMLButtonElement)) return null;\n      const footerRow = profileButton.closest(".h-toolbar");\n      if (!(footerRow instanceof HTMLElement) || !panel.contains(footerRow) || !isVisible(footerRow)) {\n        return null;\n      }\n      return { footerRow, placement: "footer" };\n    }\n    function usagePanelIsAllowed() {\n      return !/^\\/settings(?:\\/|$)/.test(location.pathname);\n    }\n    function renderUsagePanel() {\n      if (!usagePanelIsAllowed()) {\n        document.getElementById(USAGE_PANEL_ID)?.remove();\n        return;\n      }\n      const context = findSidebarFooterContext();\n      if (context == null) {\n        document.getElementById(USAGE_PANEL_ID)?.remove();\n        return;\n      }\n      const host = context.footerRow.parentElement;\n      if (!(host instanceof HTMLElement)) return;\n      document.getElementById("codex-theme-usage-badge")?.remove();\n      for (const hiddenHelp of document.querySelectorAll(\'[data-codex-theme-help-hidden="true"]\')) {\n        removeAttributeIfPresent(hiddenHelp, "data-codex-theme-help-hidden");\n      }\n      let panel = document.getElementById(USAGE_PANEL_ID);\n      if (!(panel instanceof HTMLElement)) {\n        panel = markOwned(document.createElement("section"));\n        panel.id = USAGE_PANEL_ID;\n        panel.setAttribute("role", "img");\n        panel.setAttribute("aria-live", "polite");\n        panel.innerHTML = [\n          \'<svg class="codex-theme-usage-gauge" viewBox="0 0 72 70" aria-hidden="true">\',\n          \'<defs><linearGradient id="codex-theme-usage-spectrum" gradientUnits="userSpaceOnUse" x1="8" y1="0" x2="64" y2="0">\',\n          \'<stop offset="0" stop-color="#ff514e"/><stop offset=".25" stop-color="#ff9a36"/>\',\n          \'<stop offset=".5" stop-color="#ffe348"/><stop offset=".75" stop-color="#36dd86"/>\',\n          \'<stop offset="1" stop-color="#28c8df"/></linearGradient></defs>\',\n          \'<path class="codex-theme-usage-arc" d="M11.751 50 A28 28 0 1 1 60.249 50"/>\',\n          \'<circle class="codex-theme-usage-marker" r="3.2" cx="36" cy="8"/>\',\n          \'<text class="codex-theme-usage-value" x="36" y="43">—</text>\',\n          \'<text class="codex-theme-usage-month" x="22" y="65">—</text>\',\n          \'<text class="codex-theme-usage-day" x="50" y="65">—</text>\',\n          "</svg>"\n        ].join("");\n      }\n      if (panel.parentElement !== host || panel.nextElementSibling !== context.footerRow) {\n        host.insertBefore(panel, context.footerRow);\n      }\n      const formatted = formatUsage(uiState.usage);\n      for (const key of ["value", "month", "day"]) {\n        const label = panel.querySelector(`.codex-theme-usage-${key}`);\n        if (label?.textContent !== formatted[key]) label.textContent = formatted[key];\n      }\n      const marker = panel.querySelector(".codex-theme-usage-marker");\n      const angle = (150 + (formatted.remainingPercent ?? 0) * 2.4) * Math.PI / 180;\n      setAttributeIfChanged(marker, "cx", (36 + 28 * Math.cos(angle)).toFixed(3));\n      setAttributeIfChanged(marker, "cy", (36 + 28 * Math.sin(angle)).toFixed(3));\n      setAttributeIfChanged(panel, "data-placement", context.placement);\n      setAttributeIfChanged(panel, "data-remaining-percent", formatted.remainingPercent == null ? "unknown" : String(formatted.remainingPercent));\n      if (panel.title !== formatted.title) panel.title = formatted.title;\n      setAttributeIfChanged(panel, "aria-label", formatted.title);\n    }\n  }\n\n  // src/page/server-signals.mjs\n  var ACTIVITY_ATTRIBUTE = "data-codex-theme-server-activity";\n  function createServerSignals(retainedLatencies) {\n    let state = { ...retainedLatencies || {} };\n    return {\n      render: renderServerLatencies,\n      get value() {\n        return { ...state };\n      },\n      update(next) {\n        if (shallowEqualObject(state, next || {})) return false;\n        state = { ...next || {} };\n        return true;\n      },\n      dispose() {\n        for (const signal of document.querySelectorAll(".codex-theme-server-signal")) signal.remove();\n        for (const status of document.querySelectorAll(\'[data-codex-theme-native-server-status="true"]\')) {\n          removeAttributeIfPresent(status, "data-codex-theme-native-server-status");\n        }\n        for (const activity of document.querySelectorAll(`[${ACTIVITY_ATTRIBUTE}]`)) {\n          removeAttributeIfPresent(activity, ACTIVITY_ATTRIBUTE);\n        }\n      }\n    };\n    function serverSignalBars(latency) {\n      if (!Number.isFinite(latency)) return 0;\n      if (latency <= 40) return 4;\n      if (latency <= 100) return 3;\n      if (latency <= 250) return 2;\n      return 1;\n    }\n    function createServerSignal(alias) {\n      const signal = markOwned(document.createElement("span"));\n      signal.className = "codex-theme-server-signal";\n      signal.dataset.hostAlias = alias;\n      signal.setAttribute("role", "img");\n      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");\n      svg.setAttribute("viewBox", "0 0 16 16");\n      svg.setAttribute("aria-hidden", "true");\n      const bars = [\n        { x: 1, y: 11, width: 2.5, height: 4 },\n        { x: 4.8, y: 8, width: 2.5, height: 7 },\n        { x: 8.6, y: 5, width: 2.5, height: 10 },\n        { x: 12.4, y: 2, width: 2.5, height: 13 }\n      ];\n      bars.forEach((bar, index) => {\n        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");\n        rect.classList.add("codex-theme-server-signal-bar");\n        rect.dataset.index = String(index + 1);\n        rect.setAttribute("x", String(bar.x));\n        rect.setAttribute("y", String(bar.y));\n        rect.setAttribute("width", String(bar.width));\n        rect.setAttribute("height", String(bar.height));\n        rect.setAttribute("rx", "1.25");\n        svg.appendChild(rect);\n      });\n      signal.appendChild(svg);\n      return signal;\n    }\n    function findServerLabel(scroll, panelRect, alias) {\n      const normalizedAlias = alias.toLocaleLowerCase();\n      const matches = [];\n      const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);\n      let textNode;\n      while (textNode = walker.nextNode()) {\n        if (textNode.nodeValue?.trim().toLocaleLowerCase() !== normalizedAlias) continue;\n        const parent = textNode.parentElement;\n        if (!(parent instanceof HTMLElement) || isOwnedNode(parent) || !isVisible(parent)) continue;\n        const rect = parent.getBoundingClientRect();\n        if (rect.left < panelRect.left + panelRect.width * 0.38) continue;\n        matches.push(parent);\n      }\n      matches.sort((left, right) => right.getBoundingClientRect().left - left.getBoundingClientRect().left);\n      return matches[0] ?? null;\n    }\n    function findNativeServerStatus(label) {\n      const row = label.closest(".sidebar-item");\n      if (row instanceof HTMLElement) {\n        const currentStatus = Array.from(row.querySelectorAll(\'[role="img"]\')).find((candidate) => candidate instanceof HTMLElement && !isOwnedNode(candidate) && !candidate.contains(label));\n        if (currentStatus instanceof HTMLElement) return currentStatus;\n      }\n      const legacyStatus = label.parentElement?.querySelector(\n        ":scope > .sidebar-item-icon"\n      );\n      return legacyStatus instanceof HTMLElement && !isOwnedNode(legacyStatus) ? legacyStatus : null;\n    }\n    function findServerActivitySlot(label, signal) {\n      const row = label.closest("[data-app-action-sidebar-project-row]");\n      if (!(row instanceof HTMLElement)) return null;\n      for (const spinner of row.querySelectorAll(\'.animate-spin, [style*="animation-duration"]\')) {\n        if (!(spinner instanceof HTMLElement) || isOwnedNode(spinner) || !spinner.querySelector("svg")) continue;\n        const duration = spinner.style.animationDuration;\n        const status = spinner.parentElement;\n        const isTaskSpinner = duration === "2000ms" || duration === "2s" || spinner.classList.contains("animate-spin") && (status?.getAttribute("role") === "status" || status?.classList.contains("text-token-foreground/70"));\n        if (!isTaskSpinner) continue;\n        let slot = spinner;\n        while (slot.parentElement && slot.parentElement !== row && !slot.parentElement.contains(label)) {\n          slot = slot.parentElement;\n        }\n        const group = slot.parentElement;\n        if (!group || group === row || !group.contains(label) || !group.contains(signal) || slot.contains(signal) || slot.querySelector("button, [role=\'button\']")) continue;\n        if (!["flex", "inline-flex"].includes(getComputedStyle(group).display)) continue;\n        return slot;\n      }\n      return null;\n    }\n    function renderServerLatencies() {\n      const panel = document.querySelector(".app-shell-left-panel");\n      const scroll = panel?.querySelector("[data-app-action-sidebar-scroll]");\n      if (!(panel instanceof HTMLElement) || !(scroll instanceof HTMLElement)) return;\n      const latencies = state;\n      const panelRect = panel.getBoundingClientRect();\n      const desiredSignals = /* @__PURE__ */ new Set();\n      const desiredNativeStatuses = /* @__PURE__ */ new Set();\n      const desiredActivitySlots = /* @__PURE__ */ new Set();\n      const existingSignals = new Map(\n        Array.from(scroll.querySelectorAll(".codex-theme-server-signal")).filter((signal) => signal instanceof HTMLElement).map((signal) => [signal.dataset.hostAlias, signal])\n      );\n      for (const [alias, latency] of Object.entries(latencies)) {\n        let signal = existingSignals.get(alias);\n        const label = findServerLabel(scroll, panelRect, alias);\n        if (!(label instanceof HTMLElement)) continue;\n        if (!(signal instanceof HTMLElement)) signal = createServerSignal(alias);\n        const nativeStatus = findNativeServerStatus(label);\n        if (nativeStatus instanceof HTMLElement) {\n          if (signal.nextElementSibling !== nativeStatus) {\n            nativeStatus.insertAdjacentElement("beforebegin", signal);\n          }\n          setAttributeIfChanged(signal, "data-placement", "native-status");\n          desiredNativeStatuses.add(nativeStatus);\n          setAttributeIfChanged(nativeStatus, "data-codex-theme-native-server-status", "true");\n        } else {\n          if (signal.previousElementSibling !== label) {\n            label.insertAdjacentElement("afterend", signal);\n          }\n          setAttributeIfChanged(signal, "data-placement", "label");\n        }\n        desiredSignals.add(signal);\n        const activitySlot = findServerActivitySlot(label, signal);\n        if (activitySlot) {\n          setAttributeIfChanged(activitySlot, ACTIVITY_ATTRIBUTE, "true");\n          desiredActivitySlots.add(activitySlot);\n        }\n        const barCount = serverSignalBars(latency);\n        setAttributeIfChanged(signal, "data-bars", String(barCount));\n        for (const bar of signal.querySelectorAll(".codex-theme-server-signal-bar")) {\n          const index = Number(bar.getAttribute("data-index"));\n          setAttributeIfChanged(bar, "data-active", index <= barCount ? "true" : "false");\n        }\n        const roundedLatency = Number.isFinite(latency) ? Math.round(latency) : null;\n        const description = roundedLatency == null ? "未接続、信号 0/4" : `応答 ${roundedLatency}ミリ秒、信号 ${barCount}/4`;\n        setAttributeIfChanged(signal, "aria-label", description);\n        if (signal.title !== description) signal.title = description;\n      }\n      for (const signal of existingSignals.values()) {\n        if (!desiredSignals.has(signal)) signal.remove();\n      }\n      for (const nativeStatus of scroll.querySelectorAll(\n        \'[data-codex-theme-native-server-status="true"]\'\n      )) {\n        if (!desiredNativeStatuses.has(nativeStatus)) {\n          removeAttributeIfPresent(nativeStatus, "data-codex-theme-native-server-status");\n        }\n      }\n      for (const activity of document.querySelectorAll(`[${ACTIVITY_ATTRIBUTE}]`)) {\n        if (!desiredActivitySlots.has(activity)) removeAttributeIfPresent(activity, ACTIVITY_ATTRIBUTE);\n      }\n    }\n  }\n\n  // src/page/composer.mjs\n  function createComposerController({ getConfig, diagnostics }) {\n    const RAINBOW_FRAME_INTERVAL_MS = 1e3 / 30;\n    const RAINBOW_ACTIVE_GRACE_MS = Number(getConfig()?.timings?.rainbowGraceMs) || 900;\n    let disposed = false;\n    let composerSurface = null;\n    let composerCanvas = null;\n    let composerResizeObserver = null;\n    let composerAnimationFrame = 0;\n    let composerLastDrawTimestamp = -Infinity;\n    let composerGeometryKey = "";\n    let composerSegments = [];\n    let composerActiveUntil = 0;\n    let composerActive = false;\n    function reconcile({ discover = true } = {}) {\n      if (disposed) return null;\n      if (discover || !composerSurface?.isConnected || !isVisible(composerSurface)) {\n        const next = findComposerSurface();\n        if (next !== composerSurface) setComposerSurface(next);\n      }\n      return composerSurface;\n    }\n    function evaluate() {\n      if (disposed) return false;\n      if (composerSurface == null || !composerSurface.isConnected || !isVisible(composerSurface)) {\n        reconcile();\n      }\n      const detected = composerIsActive(composerSurface);\n      const now = performance.now();\n      if (detected) composerActiveUntil = now + RAINBOW_ACTIVE_GRACE_MS;\n      setComposerActive(detected || composerSurface != null && now < composerActiveUntil);\n      return composerActive;\n    }\n    function dispose() {\n      if (disposed) return;\n      disposed = true;\n      setComposerSurface(null);\n    }\n    return {\n      reconcile,\n      evaluate,\n      dispose,\n      get surface() {\n        return composerSurface;\n      },\n      get animating() {\n        return composerAnimationFrame !== 0;\n      },\n      inspect: () => ({\n        attached: composerSurface?.isConnected === true,\n        active: composerActive,\n        ready: composerCanvas?.dataset.ready === "true",\n        segmentCount: Number(composerCanvas?.dataset.segmentCount) || 0\n      })\n    };\n    function findComposerSurface() {\n      const editors = Array.from(document.querySelectorAll(\n        \'[data-codex-composer="true"], textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder]\'\n      )).filter((element) => {\n        if (!(element instanceof HTMLElement) || !isVisible(element)) return false;\n        const rect = element.getBoundingClientRect();\n        return rect.width >= 240 && rect.height >= 20;\n      }).sort((left, right) => {\n        const leftRect = left.getBoundingClientRect();\n        const rightRect = right.getBoundingClientRect();\n        return rightRect.bottom - leftRect.bottom || rightRect.width - leftRect.width;\n      });\n      const editor = editors[0];\n      if (!(editor instanceof HTMLElement)) return null;\n      const layoutRoot = editor.closest(\n        "[data-composer-layout][data-composer-surface-variant]"\n      );\n      if (layoutRoot instanceof HTMLElement && isVisible(layoutRoot)) {\n        for (let surface2 = editor.parentElement; surface2 && layoutRoot.contains(surface2); surface2 = surface2.parentElement) {\n          const rect = surface2.getBoundingClientRect();\n          const radius = Number.parseFloat(getComputedStyle(surface2).borderRadius);\n          if (rect.width >= 320 && rect.height >= 48 && rect.height <= 260 && Number.isFinite(radius) && radius >= 8 && surface2.querySelector("button")) {\n            return surface2;\n          }\n          if (surface2 === layoutRoot) break;\n        }\n        return layoutRoot;\n      }\n      if (composerSurface instanceof HTMLElement && composerSurface.isConnected && isVisible(composerSurface) && composerSurface.contains(editor)) {\n        return composerSurface;\n      }\n      const form = editor.closest("form");\n      if (form instanceof HTMLElement && isVisible(form)) return form;\n      let surface = editor.parentElement;\n      let candidate = null;\n      for (let depth = 0; surface && depth < 8; depth += 1, surface = surface.parentElement) {\n        const rect = surface.getBoundingClientRect();\n        if (rect.width >= 320 && rect.height >= 48 && rect.height <= 260 && surface.querySelector("button")) {\n          candidate = surface;\n        }\n        if (rect.width >= window.innerWidth * 0.92) break;\n      }\n      return candidate;\n    }\n    function composerIsActive(surface) {\n      if (!(surface instanceof HTMLElement)) return false;\n      if (getConfig().rainbowPreview) return true;\n      const stopPattern = /(?:stop|cancel|interrupt|停止|中止|キャンセル|중지|정지|취소)/i;\n      const controls = Array.from(surface.querySelectorAll("button, [role=button]")).filter((element) => element instanceof HTMLElement && isVisible(element));\n      if (controls.some((element) => stopPattern.test([\n        element.getAttribute("aria-label"),\n        element.getAttribute("title"),\n        element.getAttribute("data-testid"),\n        element.textContent\n      ].filter(Boolean).join(" ")))) {\n        return true;\n      }\n      return surface.querySelector(\n        \'[aria-busy="true"], [data-state="streaming"], [data-status="running"]\'\n      ) != null;\n    }\n    function setComposerSurface(nextSurface) {\n      if (composerSurface === nextSurface && composerCanvas?.isConnected) return;\n      stopComposerAnimation();\n      composerResizeObserver?.disconnect();\n      composerResizeObserver = null;\n      if (composerSurface instanceof HTMLElement) {\n        removeAttributeIfPresent(composerSurface, "data-codex-theme-rainbow-composer");\n        removeAttributeIfPresent(composerSurface, "data-codex-theme-rainbow-active");\n      }\n      composerCanvas?.remove();\n      composerSurface = nextSurface instanceof HTMLElement ? nextSurface : null;\n      composerCanvas = null;\n      composerGeometryKey = "";\n      composerSegments = [];\n      composerActive = false;\n      composerActiveUntil = 0;\n      if (!(composerSurface instanceof HTMLElement)) return;\n      setAttributeIfChanged(composerSurface, "data-codex-theme-rainbow-composer", "attached");\n      setAttributeIfChanged(composerSurface, "data-codex-theme-rainbow-active", "false");\n      const canvas = markOwned(document.createElement("canvas"));\n      canvas.className = "codex-theme-rainbow-canvas";\n      canvas.setAttribute("aria-hidden", "true");\n      canvas.setAttribute("data-effect", "surface-fill");\n      composerSurface.appendChild(canvas);\n      composerCanvas = canvas;\n      diagnostics.composerCanvasCreates += 1;\n      if (typeof ResizeObserver === "function") {\n        composerResizeObserver = new ResizeObserver(() => {\n          composerGeometryKey = "";\n          if (composerActive) drawRainbowFrame(performance.now());\n        });\n        composerResizeObserver.observe(composerSurface);\n      }\n    }\n    function drawRainbowFrame(timestamp) {\n      if (!(composerCanvas instanceof HTMLCanvasElement) || !(composerSurface instanceof HTMLElement)) {\n        return;\n      }\n      const canvasRect = composerCanvas.getBoundingClientRect();\n      const surfaceRect = composerSurface.getBoundingClientRect();\n      const cssWidth = canvasRect.width || surfaceRect.width;\n      const cssHeight = canvasRect.height || surfaceRect.height;\n      if (cssWidth < 2 || cssHeight < 2) return;\n      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);\n      const pixelWidth = Math.round(cssWidth * pixelRatio);\n      const pixelHeight = Math.round(cssHeight * pixelRatio);\n      if (composerCanvas.width !== pixelWidth || composerCanvas.height !== pixelHeight) {\n        composerCanvas.width = pixelWidth;\n        composerCanvas.height = pixelHeight;\n      }\n      const context = composerCanvas.getContext("2d");\n      if (context == null) return;\n      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);\n      context.clearRect(0, 0, cssWidth, cssHeight);\n      const metricsKey = `${Math.round(cssWidth * 10)}x${Math.round(cssHeight * 10)}`;\n      const segmentCount = Math.min(480, Math.max(180, Math.ceil(cssWidth / 3)));\n      const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;\n      const duration = reducedMotion ? 8e3 : 2400;\n      const phase = timestamp % duration / duration;\n      const geometryKey = `${metricsKey}:${segmentCount}`;\n      if (composerGeometryKey !== geometryKey) {\n        composerGeometryKey = geometryKey;\n        const bandWidth = cssWidth / segmentCount;\n        composerSegments = Array.from({ length: segmentCount }, (_, index) => ({\n          x: index * bandWidth,\n          width: bandWidth + 1\n        }));\n      }\n      for (let index = 0; index < composerSegments.length; index += 1) {\n        const segment = composerSegments[index];\n        const hue = ((index / segmentCount - phase) * 360 + 360) % 360;\n        context.fillStyle = `hsl(${hue}deg 100% 58%)`;\n        context.fillRect(segment.x, 0, segment.width, cssHeight);\n      }\n      setAttributeIfChanged(composerCanvas, "data-ready", "true");\n      setAttributeIfChanged(composerCanvas, "data-pixel-ratio", String(pixelRatio));\n      setAttributeIfChanged(composerCanvas, "data-segment-count", String(segmentCount));\n    }\n    function animateComposer(timestamp) {\n      if (disposed || !composerActive || !(composerCanvas instanceof HTMLCanvasElement) || !composerCanvas.isConnected || !(composerSurface instanceof HTMLElement)) {\n        composerAnimationFrame = 0;\n        return;\n      }\n      if (timestamp - composerLastDrawTimestamp >= RAINBOW_FRAME_INTERVAL_MS) {\n        drawRainbowFrame(timestamp);\n        composerLastDrawTimestamp = timestamp;\n      }\n      composerAnimationFrame = requestAnimationFrame(animateComposer);\n    }\n    function startComposerAnimation() {\n      if (composerAnimationFrame || !composerActive) return;\n      composerLastDrawTimestamp = -Infinity;\n      composerAnimationFrame = requestAnimationFrame(animateComposer);\n    }\n    function stopComposerAnimation() {\n      if (composerAnimationFrame) cancelAnimationFrame(composerAnimationFrame);\n      composerAnimationFrame = 0;\n      composerLastDrawTimestamp = -Infinity;\n    }\n    function setComposerActive(active) {\n      if (!(composerSurface instanceof HTMLElement)) active = false;\n      if (composerActive === active) return;\n      composerActive = active;\n      if (composerSurface instanceof HTMLElement) {\n        setAttributeIfChanged(\n          composerSurface,\n          "data-codex-theme-rainbow-active",\n          active ? "true" : "false"\n        );\n      }\n      if (active) startComposerAnimation();\n      else stopComposerAnimation();\n    }\n  }\n\n  // src/page/fire.mjs\n  function createFireController({ getConfig, diagnostics, sessions }) {\n    const FIRE_FRAME_INTERVAL_MS = 250;\n    const THUMB_FIRE_GROWTH_DURATION_MS = 5 * 60 * 1e3;\n    const WALLPAPER_IMAGE_WIDTH = 4032;\n    const WALLPAPER_IMAGE_HEIGHT = 3024;\n    const HAND_FIRE_POINTS = [\n      { side: "left", x: 1200, y: 1090 },\n      { side: "right", x: 2510, y: 1080 }\n    ];\n    let disposed = false;\n    let fireSurface = null;\n    let fireLayer = null;\n    let fireImages = [];\n    let fireResizeObserver = null;\n    let fireGeometryFrame = 0;\n    let fireTimer = 0;\n    let fireActive = false;\n    let fireActiveStartedAt = 0;\n    let fireCurrentSessionKey = null;\n    return {\n      reconcile: () => setFireSurface(findMainSurface()),\n      configure: updateFireAsset,\n      setActive: setFireActive,\n      get running() {\n        return fireTimer !== 0;\n      },\n      inspect: () => ({\n        attached: fireLayer?.isConnected === true,\n        active: fireActive,\n        sessionKey: fireCurrentSessionKey,\n        elapsedMs: fireActiveStartedAt > 0 ? Math.max(0, Date.now() - fireActiveStartedAt) : 0,\n        retainedSessionCount: sessions.size\n      }),\n      dispose() {\n        if (disposed) return;\n        disposed = true;\n        stopFireTimer();\n        if (fireGeometryFrame) cancelAnimationFrame(fireGeometryFrame);\n        fireGeometryFrame = 0;\n        fireActive = false;\n        setFireSurface(null);\n      }\n    };\n    function setFireSurface(nextSurface) {\n      if (fireSurface === nextSurface && fireSurface?.isConnected) {\n        setAttributeIfChanged(fireSurface, "data-codex-theme-wallpaper-root", "true");\n        return;\n      }\n      fireResizeObserver?.disconnect();\n      fireResizeObserver = null;\n      fireLayer?.remove();\n      fireLayer = null;\n      fireImages = [];\n      if (fireSurface instanceof HTMLElement) {\n        removeAttributeIfPresent(fireSurface, "data-codex-theme-wallpaper-root");\n      }\n      fireSurface = nextSurface instanceof HTMLElement ? nextSurface : null;\n      if (!(fireSurface instanceof HTMLElement)) return;\n      setAttributeIfChanged(fireSurface, "data-codex-theme-wallpaper-root", "true");\n      if (typeof ResizeObserver === "function") {\n        fireResizeObserver = new ResizeObserver(scheduleFireGeometry);\n        fireResizeObserver.observe(fireSurface);\n      }\n      if (fireActive) {\n        ensureFireLayer();\n        scheduleFireGeometry();\n      }\n    }\n    function ensureFireLayer() {\n      if (!(fireSurface instanceof HTMLElement) || fireLayer?.isConnected && fireImages.length === HAND_FIRE_POINTS.length && fireImages.every((fire) => fire.image.isConnected)) {\n        return;\n      }\n      fireLayer?.remove();\n      const layer = markOwned(document.createElement("div"));\n      layer.className = "codex-theme-thumb-fire-layer";\n      layer.setAttribute("aria-hidden", "true");\n      fireSurface.prepend(layer);\n      fireLayer = layer;\n      fireImages = HAND_FIRE_POINTS.map((point) => {\n        const image = markOwned(document.createElement("img"));\n        image.className = "codex-theme-thumb-fire";\n        image.dataset.side = point.side;\n        image.alt = "";\n        image.draggable = false;\n        image.decoding = "async";\n        image.setAttribute("aria-hidden", "true");\n        image.addEventListener("load", () => {\n          setAttributeIfChanged(image, "data-ready", "true");\n          scheduleFireGeometry();\n        });\n        image.src = getConfig().fireDataUrl || "";\n        if (image.complete && image.naturalWidth > 0) {\n          setAttributeIfChanged(image, "data-ready", "true");\n        }\n        layer.appendChild(image);\n        return { image, point, scaleX: 1, scaleY: 1 };\n      });\n      diagnostics.fireLayerCreates += 1;\n    }\n    function updateFireAsset() {\n      for (const fire of fireImages) {\n        if (fire.image.src === getConfig().fireDataUrl) continue;\n        removeAttributeIfPresent(fire.image, "data-ready");\n        fire.image.src = getConfig().fireDataUrl || "";\n      }\n    }\n    function scheduleFireGeometry() {\n      if (disposed || fireGeometryFrame) return;\n      fireGeometryFrame = requestAnimationFrame(() => {\n        fireGeometryFrame = 0;\n        positionFireImages();\n      });\n    }\n    function positionFireImages() {\n      if (!(fireSurface instanceof HTMLElement) || !(fireLayer instanceof HTMLElement) || !isVisible(fireSurface)) {\n        return false;\n      }\n      const surfaceRect = fireSurface.getBoundingClientRect();\n      const scale = Math.max(\n        surfaceRect.width / WALLPAPER_IMAGE_WIDTH,\n        surfaceRect.height / WALLPAPER_IMAGE_HEIGHT\n      );\n      const imageWidth = WALLPAPER_IMAGE_WIDTH * scale;\n      const imageHeight = WALLPAPER_IMAGE_HEIGHT * scale;\n      const imageOffsetX = (surfaceRect.width - imageWidth) / 2;\n      const imageOffsetY = (surfaceRect.height - imageHeight) / 2;\n      const baseWidth = Math.max(72, Math.min(112, 160 * scale));\n      const baseHeight = Math.max(118, Math.min(180, 255 * scale));\n      const elapsedMs = fireActive && fireActiveStartedAt > 0 ? Math.max(0, Date.now() - fireActiveStartedAt) : 0;\n      const growthStepCount = Math.max(1, Math.round(THUMB_FIRE_GROWTH_DURATION_MS / 1e3));\n      const growthStep = Math.min(growthStepCount, Math.floor(elapsedMs / 1e3));\n      const growthProgress = growthStep / growthStepCount;\n      const easedGrowth = Math.pow(growthProgress, 0.72);\n      const secondPhase = elapsedMs % 1e3 / 1e3;\n      const secondPulse = Math.sin(secondPhase * Math.PI);\n      const pulseScaleX = 1 + secondPulse * (0.035 + growthProgress * 0.075);\n      const pulseScaleY = 1 + secondPulse * (0.025 + growthProgress * 0.055);\n      const previousCanvasWidth = baseWidth * 2;\n      const previousCanvasHeight = baseHeight * 2.35;\n      const maximumScaleX = Math.max(1, surfaceRect.width * 0.9 / previousCanvasWidth);\n      const maximumScaleY = Math.max(1, surfaceRect.height * 1.12 / previousCanvasHeight);\n      const transformScaleX = (1 + easedGrowth) * (1 + easedGrowth * (maximumScaleX - 1)) * pulseScaleX;\n      const transformScaleY = (1 + easedGrowth * 1.35) * (1 + easedGrowth * (maximumScaleY - 1)) * pulseScaleY;\n      for (const fire of fireImages) {\n        const anchorX = imageOffsetX + fire.point.x * scale;\n        const anchorY = imageOffsetY + fire.point.y * scale;\n        setStylePropertyIfChanged(\n          fire.image,\n          "left",\n          `${Math.round((anchorX - baseWidth / 2) * 10) / 10}px`\n        );\n        setStylePropertyIfChanged(\n          fire.image,\n          "top",\n          `${Math.round((anchorY - baseHeight) * 10) / 10}px`\n        );\n        setStylePropertyIfChanged(fire.image, "width", `${Math.round(baseWidth * 10) / 10}px`);\n        setStylePropertyIfChanged(fire.image, "height", `${Math.round(baseHeight * 10) / 10}px`);\n        setStylePropertyIfChanged(\n          fire.image,\n          "--codex-theme-fire-scale-x",\n          String(transformScaleX)\n        );\n        setStylePropertyIfChanged(\n          fire.image,\n          "--codex-theme-fire-scale-y",\n          String(transformScaleY)\n        );\n        fire.scaleX = transformScaleX;\n        fire.scaleY = transformScaleY;\n      }\n      return true;\n    }\n    function startFireTimer() {\n      if (fireTimer) return;\n      fireTimer = setInterval(scheduleFireGeometry, FIRE_FRAME_INTERVAL_MS);\n    }\n    function stopFireTimer() {\n      if (fireTimer) clearInterval(fireTimer);\n      fireTimer = 0;\n    }\n    function setFireActive(active, identity) {\n      const sessionKey = identity?.key || "view:unkeyed";\n      if (active) {\n        if (!(fireSurface instanceof HTMLElement) || !fireSurface.isConnected) {\n          setFireSurface(findMainSurface());\n        }\n        if (!(fireSurface instanceof HTMLElement)) return;\n        const startedAt = sessions.start(identity);\n        fireCurrentSessionKey = sessionKey;\n        fireActiveStartedAt = startedAt;\n        fireActive = true;\n        ensureFireLayer();\n        for (const fire of fireImages) {\n          setAttributeIfChanged(fire.image, "data-active", "true");\n        }\n        startFireTimer();\n        scheduleFireGeometry();\n        return;\n      }\n      sessions.end(identity);\n      if (!fireActive) return;\n      fireActive = false;\n      fireActiveStartedAt = 0;\n      fireCurrentSessionKey = null;\n      for (const fire of fireImages) removeAttributeIfPresent(fire.image, "data-active");\n      stopFireTimer();\n    }\n  }\n\n  // src/page/activity.mjs\n  function createActivityTracker(retainedStarts) {\n    const sessionStarts = retainedStarts && typeof retainedStarts === "object" ? { ...retainedStarts } : /* @__PURE__ */ Object.create(null);\n    function snapshot() {\n      const threadRows = Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-row]"));\n      const projectRows = Array.from(document.querySelectorAll("[data-app-action-sidebar-project-row]"));\n      const activeThreadRows = activeSidebarSessionRows(threadRows);\n      const activeProjectRows = activeCollapsedProjectRows(projectRows);\n      retainActiveSessions(activeThreadRows, activeProjectRows, threadRows);\n      return { activeThreadRows, activeProjectRows, identity: currentSessionIdentity(threadRows, projectRows) };\n    }\n    function start(identity) {\n      const key = identity?.key || "view:unkeyed";\n      let startedAt = sessionStarts[key];\n      if (!Number.isFinite(startedAt) && identity?.fallbackKey) startedAt = sessionStarts[identity.fallbackKey];\n      if (!Number.isFinite(startedAt)) startedAt = Date.now();\n      sessionStarts[key] = startedAt;\n      pruneSessionStarts();\n      return startedAt;\n    }\n    return {\n      snapshot,\n      start,\n      end(identity) {\n        if (identity?.key) delete sessionStarts[identity.key];\n      },\n      retain: () => ({ ...sessionStarts }),\n      get size() {\n        return Object.keys(sessionStarts).length;\n      }\n    };\n    function currentSessionIdentity(threadRows, projectRows) {\n      const currentThread = threadRows.find(\n        (row) => row.dataset.appActionSidebarThreadActive === "true"\n      ) || threadRows.find((row) => row.getAttribute("aria-current") === "page");\n      if (currentThread instanceof HTMLElement) {\n        const threadId = currentThread.dataset.appActionSidebarThreadId;\n        const projectList = currentThread.closest("[data-app-action-sidebar-project-list-id]");\n        const projectId2 = projectList instanceof HTMLElement ? projectList.dataset.appActionSidebarProjectListId : null;\n        if (threadId) {\n          return { key: `thread:${threadId}`, fallbackKey: projectId2 ? `project:${projectId2}` : null };\n        }\n      }\n      const currentProject = projectRows.find((row) => row.getAttribute("aria-current") === "page");\n      const projectId = currentProject?.dataset.appActionSidebarProjectId;\n      if (projectId) return { key: `project:${projectId}`, fallbackKey: null };\n      return { key: "view:unkeyed", fallbackKey: null };\n    }\n    function pruneSessionStarts() {\n      const entries = Object.entries(sessionStarts).filter((entry) => Number.isFinite(entry[1])).sort((left, right) => right[1] - left[1]);\n      for (const [key] of entries.slice(32)) delete sessionStarts[key];\n    }\n    function rowHasActiveSessionIndicator(row) {\n      return row.querySelector(\'[aria-label="Subscribed: active"]\') != null || Array.from(row.querySelectorAll(\'.animate-spin, [style*="animation-duration"]\')).some((element) => {\n        if (!(element instanceof HTMLElement)) return false;\n        const duration = element.style.animationDuration;\n        const statusContainer = element.parentElement;\n        return element.querySelector("svg") != null && (duration === "2000ms" || element.classList.contains("animate-spin") && statusContainer?.classList.contains("text-token-foreground/70") === true);\n      });\n    }\n    function activeSidebarSessionRows(threadRows) {\n      const seenThreadIds = /* @__PURE__ */ new Set();\n      return threadRows.filter((row) => {\n        if (!(row instanceof HTMLElement) || !rowHasActiveSessionIndicator(row)) return false;\n        const threadId = row.dataset.appActionSidebarThreadId;\n        if (!threadId) return true;\n        if (seenThreadIds.has(threadId)) return false;\n        seenThreadIds.add(threadId);\n        return true;\n      });\n    }\n    function activeCollapsedProjectRows(projectRows) {\n      const seenProjectIds = /* @__PURE__ */ new Set();\n      return projectRows.filter((row) => row.dataset.appActionSidebarProjectCollapsed === "true").filter((row) => {\n        if (!(row instanceof HTMLElement) || !rowHasActiveSessionIndicator(row)) return false;\n        const projectId = row.dataset.appActionSidebarProjectId;\n        if (!projectId) return true;\n        if (seenProjectIds.has(projectId)) return false;\n        seenProjectIds.add(projectId);\n        return true;\n      });\n    }\n    function retainActiveSessions(activeThreadRows, activeProjectRows, threadRows) {\n      const now = Date.now();\n      const activeThreadIds = /* @__PURE__ */ new Set();\n      for (const row of activeThreadRows) {\n        const threadId = row.dataset.appActionSidebarThreadId;\n        if (!threadId) continue;\n        activeThreadIds.add(threadId);\n        const threadKey = `thread:${threadId}`;\n        const projectList = row.closest("[data-app-action-sidebar-project-list-id]");\n        const projectId = projectList instanceof HTMLElement ? projectList.dataset.appActionSidebarProjectListId : null;\n        const projectKey = projectId ? `project:${projectId}` : null;\n        const inheritedStart = Number.isFinite(sessionStarts[threadKey]) ? sessionStarts[threadKey] : projectKey && Number.isFinite(sessionStarts[projectKey]) ? sessionStarts[projectKey] : now;\n        sessionStarts[threadKey] = inheritedStart;\n        if (projectKey && !Number.isFinite(sessionStarts[projectKey])) {\n          sessionStarts[projectKey] = inheritedStart;\n        }\n      }\n      for (const row of activeProjectRows) {\n        const projectId = row.dataset.appActionSidebarProjectId;\n        if (!projectId) continue;\n        const projectKey = `project:${projectId}`;\n        if (!Number.isFinite(sessionStarts[projectKey])) sessionStarts[projectKey] = now;\n      }\n      for (const row of threadRows) {\n        if (!(row instanceof HTMLElement)) continue;\n        const threadId = row.dataset.appActionSidebarThreadId;\n        if (threadId && !activeThreadIds.has(threadId) && row.dataset.appActionSidebarThreadActive !== "true") {\n          delete sessionStarts[`thread:${threadId}`];\n        }\n      }\n      pruneSessionStarts();\n    }\n  }\n\n  // src/page/runtime.mjs\n  var RUNTIME_KEY = "__codexThemeRuntime";\n  function installPageRuntime(initialConfig) {\n    const requestedVersion = Number(initialConfig?.version) || 1;\n    const existing = globalThis[RUNTIME_KEY];\n    if (existing?.version === requestedVersion) return existing.install(initialConfig);\n    let retained = null;\n    try {\n      retained = existing?.dispose?.({ preserveStyle: true }) ?? null;\n    } catch {\n    }\n    globalThis.__codexThemeUiObserver?.disconnect?.();\n    clearInterval(globalThis.__codexThemeComposerTimer);\n    clearInterval(globalThis.__codexThemeUsageTimer);\n    try {\n      globalThis.__codexThemeDisposeThumbFire?.();\n    } catch {\n    }\n    delete globalThis.__codexThemeUiObserver;\n    delete globalThis.__codexThemeComposerTimer;\n    delete globalThis.__codexThemeUsageTimer;\n    delete globalThis.__codexThemeDisposeThumbFire;\n    delete globalThis.__installCodexThemeWallpaper;\n    delete globalThis.__setCodexThemeUsage;\n    delete globalThis.__setCodexThemeLatencies;\n    delete globalThis.__prepareCodexThemeUsageProbe;\n    delete globalThis.__collectCodexThemeUsageProbe;\n    delete globalThis.__finishCodexThemeUsageProbe;\n    const runtime = createRuntime(initialConfig, retained);\n    globalThis[RUNTIME_KEY] = runtime;\n    return runtime.install(initialConfig);\n  }\n  function createRuntime(startingConfig, retained) {\n    const ACTIVITY_REFRESH_MS = 500;\n    const COMPOSER_RECOVERY_REFRESH_MS = 2e3;\n    const USAGE_ACTIVITY_GRACE_MS = Number(startingConfig?.timings?.usageGraceMs) || 1200;\n    const RELEVANT_STRUCTURE_SELECTOR = [\n      ".app-shell-left-panel",\n      "[data-app-navigation-rail]",\n      "[data-app-action-sidebar-scroll]",\n      "[data-app-action-sidebar-thread-row]",\n      "[data-app-action-sidebar-project-row]",\n      "[data-app-shell-main-surface]",\n      \'[class*="_MainContentSurface_"]\',\n      "[data-composer-surface-variant]",\n      "[data-codex-composer]",\n      "[data-chatgpt-conversation-selection-target]",\n      ".codex-theme-native-chat-work-toggle",\n      "textarea",\n      \'[contenteditable="true"][role="textbox"]\',\n      \'[contenteditable="true"][data-placeholder]\'\n    ].join(",");\n    let config = { ...startingConfig };\n    let installed = false;\n    let disposed = false;\n    let observer = null;\n    let domReadyHandler = null;\n    let activityTimer = 0;\n    let structureFrame = 0;\n    let activityFrame = 0;\n    let activityState = null;\n    let usageActivityActiveUntil = 0;\n    let lastComposerRecoveryAt = -Infinity;\n    const pendingFeatures = /* @__PURE__ */ new Set();\n    const diagnostics = {\n      installs: 0,\n      evaluations: 0,\n      refreshes: 0,\n      structureReconciles: 0,\n      activityChecks: 0,\n      observerCallbacks: 0,\n      ignoredObserverCallbacks: 0,\n      stateUpdates: 0,\n      composerCanvasCreates: 0,\n      fireLayerCreates: 0,\n      unifiedSidebarPatches: 0,\n      unifiedSidebarRenderRequests: 0,\n      unifiedSidebarRenderErrors: 0,\n      unifiedSidebarRestores: 0,\n      chatWorkToggleLoads: 0,\n      chatWorkToggleLoadErrors: 0,\n      chatWorkToggleRenderErrors: 0,\n      chatWorkToggleModeSwitches: 0,\n      chatWorkToggleModeSwitchErrors: 0,\n      chatWorkToggleMounts: 0,\n      chatWorkToggleRemoves: 0,\n      chatComposerRecoveries: 0\n    };\n    diagnostics.usageRenders = 0;\n    diagnostics.serverSignalRenders = 0;\n    const sessions = createActivityTracker(retained?.sessionStarts);\n    const composer = createComposerController({ getConfig: () => config, diagnostics });\n    const fire = createFireController({ getConfig: () => config, diagnostics, sessions });\n    const servers = createServerSignals(retained?.latencies);\n    const nativeUi = createNativeUiController({\n      diagnostics,\n      scheduleStructure,\n      timings: config.timings,\n      getMainSurface: findMainSurface\n    });\n    const usage = createUsageController({\n      getConfig: () => config,\n      retainedUsage: retained?.usage,\n      onUsage: (value) => updateState({ usage: value }),\n      scheduleRender: () => scheduleFeature("usage")\n    });\n    const runtime = {\n      version: Number(startingConfig?.version) || 1,\n      install,\n      updateState,\n      refresh,\n      inspect,\n      dispose\n    };\n    return runtime;\n    function ensureStyle() {\n      let style = document.getElementById(STYLE_ID);\n      if (!(style instanceof HTMLStyleElement)) {\n        const parent = document.head || document.documentElement;\n        if (!(parent instanceof Element)) return;\n        style = markOwned(document.createElement("style"));\n        style.id = STYLE_ID;\n        parent.appendChild(style);\n      }\n      if (style.textContent !== config.css) style.textContent = config.css || "";\n    }\n    function recoverMissingComposer() {\n      if (composer.surface != null || /^\\/settings(?:\\/|$)/.test(location.pathname)) return;\n      const view = document.querySelector("[data-chatgpt-conversation-selection-target]");\n      if (!isVisible(view)) return;\n      lastComposerRecoveryAt = performance.now();\n      nativeUi.reconcileComposer();\n    }\n    function evaluateActivity() {\n      if (disposed || !document.documentElement) return;\n      if (nativeUi.hasPendingMode()) nativeUi.reconcileHome();\n      diagnostics.activityChecks += 1;\n      const now = performance.now();\n      const currentComposerActive = composer.evaluate();\n      if (composer.surface == null && now - lastComposerRecoveryAt >= COMPOSER_RECOVERY_REFRESH_MS) {\n        recoverMissingComposer();\n      }\n      const { activeThreadRows, activeProjectRows, identity } = sessions.snapshot();\n      const sidebarActive = activeThreadRows.length > 0;\n      const collapsedProjectActive = activeProjectRows.length > 0;\n      const detected = currentComposerActive || sidebarActive || collapsedProjectActive;\n      if (detected) usageActivityActiveUntil = now + USAGE_ACTIVITY_GRACE_MS;\n      const usageActive = detected || now < usageActivityActiveUntil;\n      const activeValue = String(usageActive);\n      if (document.documentElement.dataset.codexThemeSessionActive !== activeValue) {\n        document.documentElement.dataset.codexThemeSessionActive = activeValue;\n      }\n      const currentIdentityIsActive = activeThreadRows.some((row) => identity.key === `thread:${row.dataset.appActionSidebarThreadId}`) || activeProjectRows.some((row) => identity.key === `project:${row.dataset.appActionSidebarProjectId}`);\n      fire.setActive(currentComposerActive || currentIdentityIsActive, identity);\n      activityState = {\n        currentComposerActive,\n        sidebarActive,\n        sidebarActiveCount: activeThreadRows.length,\n        sidebarThreadIds: activeThreadRows.map((row) => row.dataset.appActionSidebarThreadId).filter(Boolean),\n        collapsedProjectActive,\n        collapsedProjectActiveCount: activeProjectRows.length,\n        collapsedProjectIds: activeProjectRows.map((row) => row.dataset.appActionSidebarProjectId).filter(Boolean),\n        active: usageActive\n      };\n    }\n    function renderUsage() {\n      diagnostics.usageRenders += 1;\n      usage.render();\n    }\n    function renderServers() {\n      diagnostics.serverSignalRenders += 1;\n      servers.render();\n    }\n    function reconcileStructure() {\n      if (disposed || !document.documentElement) return;\n      diagnostics.structureReconciles += 1;\n      ensureStyle();\n      renderUsage();\n      nativeUi.reconcile();\n      renderServers();\n      composer.reconcile();\n      recoverMissingComposer();\n      fire.reconcile();\n      scheduleActivity();\n    }\n    function scheduleFeature(feature) {\n      if (disposed) return;\n      pendingFeatures.add(feature);\n      if (structureFrame) return;\n      structureFrame = requestAnimationFrame(() => {\n        structureFrame = 0;\n        const pending = new Set(pendingFeatures);\n        pendingFeatures.clear();\n        if (pending.has("structure")) reconcileStructure();\n        else {\n          if (pending.has("usage")) renderUsage();\n          if (pending.has("servers")) renderServers();\n        }\n      });\n    }\n    function scheduleStructure() {\n      scheduleFeature("structure");\n    }\n    function scheduleActivity() {\n      if (disposed || activityFrame) return;\n      activityFrame = requestAnimationFrame(() => {\n        activityFrame = 0;\n        evaluateActivity();\n      });\n    }\n    function changedNodesAreOwned(record) {\n      const changed = [...record.addedNodes, ...record.removedNodes];\n      return changed.length > 0 && changed.every(isOwnedNode);\n    }\n    function nodeTouchesRelevantStructure(node) {\n      const element = node instanceof Element ? node : node?.parentElement;\n      if (!(element instanceof Element) || isOwnedNode(element)) return false;\n      return element.matches(RELEVANT_STRUCTURE_SELECTOR) || element.querySelector(RELEVANT_STRUCTURE_SELECTOR) != null;\n    }\n    function classifyMutation(record) {\n      if (isOwnedNode(record.target)) return { structure: false, activity: false };\n      const target = record.target instanceof Element ? record.target : record.target?.parentElement;\n      if (record.type === "attributes") {\n        if (!(target instanceof Element)) return { structure: false, activity: false };\n        const inSidebar = target.closest(".app-shell-left-panel, [data-app-navigation-rail]") != null;\n        const inComposer = composer.surface instanceof HTMLElement && composer.surface.contains(target);\n        return { structure: false, activity: inSidebar || inComposer };\n      }\n      if (record.type !== "childList" || changedNodesAreOwned(record)) {\n        return { structure: false, activity: false };\n      }\n      if (target instanceof Element && target.closest(".app-shell-left-panel, [data-app-navigation-rail]")) {\n        return { structure: true, activity: true };\n      }\n      if (target instanceof Element && composer.surface instanceof HTMLElement && (composer.surface.contains(target) || target.contains(composer.surface))) {\n        const changed2 = [...record.addedNodes, ...record.removedNodes];\n        const structure2 = changed2.some((node) => node instanceof Element && nodeTouchesRelevantStructure(node));\n        return { structure: structure2, activity: true };\n      }\n      const changed = [...record.addedNodes, ...record.removedNodes];\n      const structure = changed.some(nodeTouchesRelevantStructure);\n      return { structure, activity: structure };\n    }\n    function installObserver() {\n      observer?.disconnect();\n      observer = new MutationObserver((records) => {\n        diagnostics.observerCallbacks += 1;\n        let structure = false;\n        let activity = false;\n        for (const record of records) {\n          const classification = classifyMutation(record);\n          structure ||= classification.structure;\n          activity ||= classification.activity;\n          if (structure && activity) break;\n        }\n        if (!structure && !activity) diagnostics.ignoredObserverCallbacks += 1;\n        if (structure) {\n          scheduleStructure("mutation");\n        }\n        if (activity) scheduleActivity("mutation");\n      });\n      observer.observe(document.documentElement, {\n        childList: true,\n        subtree: true,\n        attributes: true,\n        attributeFilter: ["aria-busy", "aria-label", "data-state", "data-status", "data-testid"]\n      });\n    }\n    function install(nextConfig) {\n      diagnostics.evaluations += 1;\n      if (disposed) return { installed: false, disposed: true };\n      if (nextConfig && typeof nextConfig === "object") config = { ...config, ...nextConfig };\n      ensureStyle();\n      fire.configure();\n      usage.configure();\n      if (document.documentElement) document.documentElement.dataset.codexThemeWallpaper = "enabled";\n      if (!installed) {\n        installed = true;\n        diagnostics.installs += 1;\n        nativeUi.install();\n        if (document.documentElement) installObserver();\n        activityTimer = setInterval(scheduleActivity, ACTIVITY_REFRESH_MS);\n        if (document.readyState === "loading") {\n          domReadyHandler = () => {\n            if (document.documentElement) {\n              document.documentElement.dataset.codexThemeWallpaper = "enabled";\n              if (!observer) installObserver();\n            }\n            refresh();\n          };\n          document.addEventListener("DOMContentLoaded", domReadyHandler, { once: true });\n        }\n        usage.install();\n      }\n      refresh();\n      return {\n        installed: true,\n        imageBytes: Number(config.imageBytes) || 0,\n        title: document.title,\n        url: location.href,\n        runtime: inspect()\n      };\n    }\n    function updateState(nextState) {\n      if (disposed || nextState == null || typeof nextState !== "object") return false;\n      let changed = false;\n      if (Object.prototype.hasOwnProperty.call(nextState, "usage") && usage.update(nextState.usage)) {\n        changed = true;\n        scheduleFeature("usage");\n      }\n      if (Object.prototype.hasOwnProperty.call(nextState, "latencies") && servers.update(nextState.latencies)) {\n        changed = true;\n        scheduleFeature("servers");\n      }\n      if (changed) diagnostics.stateUpdates += 1;\n      return changed;\n    }\n    function refresh() {\n      if (disposed) return false;\n      diagnostics.refreshes += 1;\n      scheduleStructure();\n      scheduleActivity();\n      return true;\n    }\n    function inspect() {\n      return {\n        version: runtime.version,\n        installed,\n        disposed,\n        diagnostics: { ...diagnostics },\n        resources: {\n          observer: observer != null,\n          activityTimer: activityTimer !== 0,\n          usageTimer: usage.running,\n          composerAnimationFrame: composer.animating,\n          fireTimer: fire.running\n        },\n        nodes: {\n          usagePanels: document.querySelectorAll(`#${USAGE_PANEL_ID}`).length,\n          composerCanvases: document.querySelectorAll(".codex-theme-rainbow-canvas").length,\n          fireLayers: document.querySelectorAll(".codex-theme-thumb-fire-layer").length,\n          fireImages: document.querySelectorAll(".codex-theme-thumb-fire").length,\n          serverSignals: document.querySelectorAll(".codex-theme-server-signal").length,\n          chatWorkToggles: document.querySelectorAll(".codex-theme-native-chat-work-toggle").length\n        },\n        ...nativeUi.inspect(),\n        usage: usage.inspect(),\n        activity: activityState,\n        composer: composer.inspect(),\n        fire: fire.inspect()\n      };\n    }\n    function retainedState() {\n      return {\n        usage: usage.value,\n        latencies: servers.value,\n        sessionStarts: sessions.retain(),\n        chatWorkToggleMode: nativeUi.inspect().chatWorkToggle.mode\n      };\n    }\n    function dispose({ preserveStyle = false } = {}) {\n      const retained2 = retainedState();\n      if (disposed) return retained2;\n      disposed = true;\n      observer?.disconnect();\n      observer = null;\n      if (activityTimer) clearInterval(activityTimer);\n      activityTimer = 0;\n      if (structureFrame) cancelAnimationFrame(structureFrame);\n      if (activityFrame) cancelAnimationFrame(activityFrame);\n      structureFrame = 0;\n      activityFrame = 0;\n      pendingFeatures.clear();\n      if (domReadyHandler) document.removeEventListener("DOMContentLoaded", domReadyHandler);\n      domReadyHandler = null;\n      usage.dispose();\n      nativeUi.dispose();\n      composer.dispose();\n      fire.dispose();\n      servers.dispose();\n      if (document.documentElement) {\n        removeAttributeIfPresent(document.documentElement, "data-codex-theme-session-active");\n        if (!preserveStyle) {\n          document.getElementById(STYLE_ID)?.remove();\n          removeAttributeIfPresent(document.documentElement, "data-codex-theme-wallpaper");\n        }\n      }\n      if (globalThis[RUNTIME_KEY] === runtime) delete globalThis[RUNTIME_KEY];\n      return retained2;\n    }\n  }\n  return __toCommonJS(browser_entry_exports);\n})();\n';
}

// src/page/styles.mjs
function createThemeCss(imageDataUrl) {
  return `
:root {
  --codex-chat-secondary: rgb(250 251 250 / 80%);
  --codex-chat-input: rgb(255 255 255 / 86%);
  --codex-chat-dropdown: rgb(255 255 255 / 94%);
  --codex-chat-code: rgb(246 248 248 / 90%);
}

:root[data-theme="dark"],
:root:not([data-theme]):is(.dark, .electron-dark) {
  --codex-chat-secondary: rgb(24 29 31 / 82%);
  --codex-chat-input: rgb(28 34 36 / 88%);
  --codex-chat-dropdown: rgb(24 29 31 / 94%);
  --codex-chat-code: rgb(16 21 23 / 92%);
}

:is([data-app-shell-main-surface], [class*="_MainContentSurface_"]) {
  /* Current ChatGPT/Codex surface tokens. */
  --color-background-primary-soft: var(--codex-chat-input) !important;
  --color-background-secondary-soft-alpha: var(--codex-chat-code) !important;
  --color-codex-editor-inline-code-background: var(--codex-chat-code) !important;
  --color-surface-elevated: var(--codex-chat-dropdown) !important;
  --color-surface-elevated-secondary: var(--codex-chat-input) !important;
  --color-surface-secondary: var(--codex-chat-secondary) !important;

  /* Compatibility tokens retained for older app builds and editor surfaces. */
  --vscode-dropdown-background: var(--codex-chat-dropdown) !important;
  --vscode-input-background: var(--codex-chat-input) !important;
  --vscode-textCodeBlock-background: var(--codex-chat-code) !important;
  --color-token-main-surface-primary: transparent !important;
  --color-token-bg-primary: transparent !important;
  --color-token-bg-secondary: var(--codex-chat-secondary) !important;
  --color-token-input-background: var(--codex-chat-input) !important;
  --color-token-dropdown-background: var(--codex-chat-dropdown) !important;
  --color-token-text-code-block-background: var(--codex-chat-code) !important;

  background-color: transparent !important;
}

/*
 * The current app can keep more than one MainContentSurface in the document
 * while a conversation switches layouts. The runtime marks the one visible,
 * full-size surface so the wallpaper and dimming layer are painted only once.
 */
[data-codex-theme-wallpaper-root="true"] {
  background-image:
    linear-gradient(rgb(0 0 0 / 60%), rgb(0 0 0 / 60%)),
    url(${JSON.stringify(imageDataUrl)}) !important;
  background-clip: border-box !important;
  background-origin: border-box !important;
  background-position: center center, center center !important;
  background-repeat: no-repeat !important;
  background-size: cover, cover !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  position: relative !important;
  isolation: isolate;
  border-inline-start-color: transparent !important;
  outline: 0 !important;
}

/*
 * Keep the app's native edge-fade nodes for layout, but remove their paint so
 * the wallpaper has the same uniform dimming from the top edge to the bottom.
 */
[data-codex-theme-wallpaper-root="true"]
  :is(
    [class*="_MainContentTopFade_"],
    .pointer-events-none.absolute.inset-x-0.bottom-0.z-0.bg-gradient-to-t.from-surface.via-surface
  ) {
  background-image: none !important;
}

/* Remove the solid search-header backdrop and its trailing fade on these pages. */
[data-codex-theme-wallpaper-root="true"]
  .sticky.bg-surface:has(:is(#plugins-store-page-search, #scheduled-page-search)) {
  background-color: transparent !important;
}

[data-codex-theme-wallpaper-root="true"]
  .sticky.bg-surface:has(:is(#plugins-store-page-search, #scheduled-page-search))::after {
  background-image: none !important;
}

/* Keep the native split width, but remove the bright one-pixel seam. */
.app-shell-left-panel {
  border-inline-end-color: transparent !important;
  box-shadow: none !important;
}

.app-shell-left-panel::after {
  border-color: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
}

/*
 * Keep the Chat/Work selector outside the native Home React tree. Codex swaps
 * that tree while changing modes, but this titlebar-level control remains in
 * one fixed DOM position and therefore cannot inherit the Home remount jitter.
 */
.codex-theme-chat-work-toggle-host {
  position: fixed;
  z-index: 2147483000;
  display: flex;
  height: 48px;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.codex-theme-native-chat-work-toggle {
  --mode-toggle-direction: 1;
  position: relative;
  isolation: isolate;
  display: inline-grid;
  height: 36px;
  max-width: 100%;
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  border-radius: 9999px;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  user-select: none;
}

.codex-theme-chat-work-track {
  position: absolute;
  z-index: 0;
  top: 50%;
  right: 1px;
  left: 1px;
  height: 34px;
  border-radius: 9999px;
  background: var(--color-background-mode-toggle-track);
  pointer-events: none;
  transform: translateY(-50%);
}

.codex-theme-chat-work-indicator {
  position: relative;
  z-index: 1;
  grid-column: 1;
  grid-row: 1;
  width: calc(100% + 9px);
  margin: -0.5px 0 -0.5px -0.5px;
  border: 0.5px solid var(--color-border-mode-toggle-selected);
  border-radius: 9999px;
  background: var(--color-background-mode-toggle-selected);
  box-shadow: var(--shadow-mode-toggle-selected);
  pointer-events: none;
}

.codex-theme-chat-work-button {
  position: relative;
  z-index: 2;
  display: inline-flex;
  height: 100%;
  min-width: 0;
  align-items: center;
  justify-content: center;
  padding: 0 40px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: var(--color-text-secondary, var(--color-token-description-foreground));
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}

.codex-theme-chat-work-button[aria-pressed="true"],
.codex-theme-chat-work-button[aria-pressed="false"]:hover,
.codex-theme-chat-work-button[aria-pressed="false"]:focus-visible {
  color: var(--color-text-primary, var(--color-token-foreground));
}

.codex-theme-chat-work-button[data-mode="chat"] {
  grid-column: 1;
  grid-row: 1;
  padding-inline: 44px 36px;
}

.codex-theme-chat-work-button[data-mode="work"] {
  grid-column: 2;
  grid-row: 1;
  padding-inline: 36px 44px;
}

:root[data-codex-theme-chat-work-transition]
  [data-app-shell-main-surface]
  div:has(> [data-feature="game-source"]) {
  opacity: 1 !important;
  transform: none !important;
  transition: none !important;
  animation: none !important;
}

#codex-theme-usage-panel {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 100%;
  margin: 0;
  padding: 8px 0;
  color: var(--color-text-primary, var(--color-token-foreground, #fff));
}

#codex-theme-usage-panel[data-placement="rail"] {
  width: 36px;
  height: 49px;
  padding: 0;
  overflow: visible;
}

#codex-theme-usage-panel .codex-theme-usage-gauge {
  display: block;
  flex: none;
  width: 56px;
  height: auto;
  overflow: visible;
  font-family: "SF Pro Rounded", ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif;
  font-variant-numeric: tabular-nums;
  text-anchor: middle;
}

#codex-theme-usage-panel[data-placement="rail"] .codex-theme-usage-gauge {
  width: 48px;
}

#codex-theme-usage-panel .codex-theme-usage-arc {
  fill: none;
  stroke: url(#codex-theme-usage-spectrum);
  stroke-width: 6;
  stroke-linecap: round;
}

#codex-theme-usage-panel .codex-theme-usage-marker {
  fill: url(#codex-theme-usage-spectrum);
  stroke: #202124;
  stroke-width: 2.4;
}

#codex-theme-usage-panel .codex-theme-usage-value {
  fill: currentColor;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -1.2px;
}

#codex-theme-usage-panel[data-remaining-percent="100"] .codex-theme-usage-value {
  font-size: 21px;
  letter-spacing: -0.7px;
}

#codex-theme-usage-panel :is(.codex-theme-usage-month, .codex-theme-usage-day) {
  font-size: 15px;
  font-weight: 600;
}

#codex-theme-usage-panel .codex-theme-usage-month { fill: #ff6660; }
#codex-theme-usage-panel .codex-theme-usage-day { fill: #28c8df; }
#codex-theme-usage-panel[data-remaining-percent="unknown"] .codex-theme-usage-arc { opacity: .25; }
#codex-theme-usage-panel[data-remaining-percent="unknown"] .codex-theme-usage-marker { visibility: hidden; }

:root[data-codex-theme-session-active="true"] #codex-theme-usage-panel .codex-theme-usage-marker {
  stroke: var(--color-text-primary, #fff);
}

[data-codex-theme-rainbow-composer="attached"] {
  position: relative !important;
  isolation: isolate;
}

.codex-theme-rainbow-canvas {
  position: absolute;
  z-index: -1;
  inset: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  corner-shape: inherit;
  pointer-events: none;
  contain: strict;
  mix-blend-mode: screen;
  opacity: 0;
  transform: translateZ(0);
  backface-visibility: hidden;
  transition: opacity 240ms ease;
}

[data-codex-theme-rainbow-active="true"]
  > .codex-theme-rainbow-canvas[data-ready="true"] {
  opacity: 0.68;
}

.codex-theme-thumb-fire-layer {
  position: absolute;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
}

.codex-theme-thumb-fire {
  position: absolute;
  display: block;
  object-fit: contain;
  object-position: center bottom;
  pointer-events: none;
  contain: strict;
  opacity: 0;
  transform: scale(var(--codex-theme-fire-scale-x, 1), var(--codex-theme-fire-scale-y, 1)) translateZ(0);
  transform-origin: 50% 100%;
  backface-visibility: hidden;
  mix-blend-mode: screen;
  transition: opacity 320ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: opacity, transform;
}

.codex-theme-thumb-fire[data-active="true"][data-ready="true"] {
  opacity: 0.96;
}

.codex-theme-server-signal {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: none;
  align-items: center;
  justify-content: center;
  margin-left: 0;
  color: rgb(54 204 134);
  transition: color 180ms ease, opacity 180ms ease;
}

.codex-theme-server-signal[data-placement="label"] {
  margin-left: 6px;
}

.codex-theme-server-signal[data-bars="0"] {
  color: var(--color-text-secondary, var(--color-token-description-foreground));
  opacity: 0.48;
}

.codex-theme-server-signal svg {
  display: block;
  width: 16px;
  height: 16px;
  overflow: visible;
}

.codex-theme-server-signal-bar {
  fill: currentColor;
  opacity: 0.18;
  transition: opacity 180ms ease;
}

.codex-theme-server-signal-bar[data-active="true"] {
  opacity: 1;
}

[data-codex-theme-native-server-status="true"] {
  display: none !important;
}

[data-app-action-sidebar-project-row][data-app-action-sidebar-project-collapsed="true"] [data-codex-theme-server-activity="true"] {
  order: -1;
}

/* Match the 16px signal's inset inside the native 20px connection status slot. */
[data-app-action-sidebar-project-row][data-app-action-sidebar-project-collapsed="true"] :has(> [data-codex-theme-server-activity="true"]) > .codex-theme-server-signal[data-placement="label"] {
  margin-inline: 2px;
}

`;
}

// src/page/source.mjs
var PAGE_RUNTIME_VERSION = 45;
function createRuntimeSource(config) {
  return `(() => {
${getPageRuntimeBundle()}
return __codexThemePage.installPageRuntime(${JSON.stringify(config)});
})()`;
}
function createPageSource(imageDataUrl, fireDataUrl, { rainbowPreview = false, usageManagedByHost = false } = {}) {
  const config = {
    version: PAGE_RUNTIME_VERSION,
    css: createThemeCss(imageDataUrl),
    fireDataUrl,
    rainbowPreview,
    usageManagedByHost,
    imageBytes: Buffer.byteLength(imageDataUrl, "utf8")
  };
  return createRuntimeSource(config);
}

// src/main.mjs
var scriptDirectory = path3.dirname(fileURLToPath(import.meta.url));
var projectPath = path3.basename(scriptDirectory) === "src" ? path3.dirname(scriptDirectory) : scriptDirectory;
async function main() {
  const options = parseArguments(process.argv.slice(2), projectPath);
  if (options.help) {
    printHelp();
    return;
  }
  const appExecutable = findAppExecutable();
  if (!appExecutable) {
    throw new Error("/Applications에서 ChatGPT 또는 Codex 앱을 찾지 못했습니다.");
  }
  validateAssets(options);
  const appLauncher = findAppLauncher(projectPath);
  validateAppLauncher(appLauncher);
  const codexExecutable = path3.resolve(
    path3.dirname(appExecutable),
    "..",
    "Resources",
    "codex"
  );
  const usageClient = fs4.existsSync(codexExecutable) ? new AppServerRateLimitClient(codexExecutable) : null;
  console.log(`[wallpaper] 사진: ${options.imagePath}`);
  console.log(`[wallpaper] 불꽃: ${options.firePath}`);
  console.log(`[wallpaper] 앱: ${appExecutable}`);
  console.log(`[wallpaper] 전용 프로필: ${options.profilePath}`);
  if (options.dryRun) {
    console.log("[wallpaper] 검사 완료. 앱은 실행하지 않았습니다.");
    return;
  }
  fs4.mkdirSync(options.profilePath, { recursive: true, mode: 448 });
  const usageCachePath = path3.join(options.profilePath, "codex-theme-usage.json");
  const pinnedSshHosts = parsePinnedSshHosts(SSH_CONFIG_PATH);
  const source = createPageSource(assetDataUrl(options.imagePath), assetDataUrl(options.firePath), {
    rainbowPreview: options.inspectUi,
    usageManagedByHost: usageClient != null
  });
  const childEnvironment = { ...process.env };
  if (options.skipRemoteSshBoot) childEnvironment.CODEX_SSH_SKIP_APP_SERVER_BOOT = "true";
  const child = options.attachedAppPid != null ? new AttachedApp(options.attachedAppPid) : spawn2(
    appLauncher,
    [
      appExecutable,
      "--remote-debugging-pipe",
      `--user-data-dir=${options.profilePath}`,
      "--no-first-run"
    ],
    {
      env: childEnvironment,
      stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"]
    }
  );
  const session = new ThemeSession({ child, usageClient });
  await session.start(async (cdp) => {
    let usageRefreshInFlight = null;
    let appServerUsageAvailable = false;
    let lastUsageError = null;
    let controller = null;
    const usageRequests = /* @__PURE__ */ new Map();
    let latestUsage = readUsageCache(usageCachePath);
    let latestLatencies = Object.fromEntries(
      Object.keys(pinnedSshHosts).map((alias) => [alias, null])
    );
    let screenshotCaptured = false;
    const pushUiState = async (sessionId) => {
      const expression = `globalThis.__codexThemeRuntime?.updateState(${JSON.stringify({
        usage: latestUsage,
        latencies: latestLatencies
      })}) ?? false`;
      const result = await cdp.send(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sessionId
      );
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "화면 상태 갱신에 실패했습니다.");
      }
    };
    const broadcastUiState = async () => {
      if (session.stopped || !controller) return;
      await Promise.allSettled(controller.sessionIds().map(pushUiState));
    };
    const refreshAccountUsage = async () => {
      if (session.stopped) return;
      if (usageClient == null || usageRefreshInFlight != null) return usageRefreshInFlight;
      usageRefreshInFlight = (async () => {
        try {
          const usage = await usageClient.read();
          if (session.stopped) return;
          const visibleValueChanged = latestUsage?.remainingPercent !== usage.remainingPercent || latestUsage?.resetAtMs !== usage.resetAtMs;
          appServerUsageAvailable = true;
          latestUsage = usage;
          writeUsageCache(usageCachePath, usage);
          lastUsageError = null;
          if (visibleValueChanged) {
            console.log(`[wallpaper] Codex 앱 서버 사용량 갱신: ${usage.remainingPercent}% 남음`);
          }
          await broadcastUiState();
        } catch (error) {
          if (session.stopped) return;
          const message = error instanceof Error ? error.message : String(error);
          if (lastUsageError !== message) {
            lastUsageError = message;
            console.error(`[wallpaper] Codex 앱 서버 사용량을 읽지 못했습니다: ${message}`);
          }
        } finally {
          usageRefreshInFlight = null;
        }
      })();
      return usageRefreshInFlight;
    };
    const inspectUi = async (sessionId) => {
      const result = await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const panel = document.querySelector(".app-shell-left-panel");
            const scroll = panel?.querySelector("[data-app-action-sidebar-scroll]");
            const rectOf = (element) => {
              const rect = element.getBoundingClientRect();
              return {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              };
            };
            const aliases = [];
            if (scroll) {
              const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);
              let node;
              while ((node = walker.nextNode())) {
                const value = node.nodeValue?.trim() ?? "";
                if (/^(VPN|Proxmox|Homelab|Oracle[_-](?:Seoul|Osaka|Chuncheon))$/i.test(value)) {
                  aliases.push({
                    value,
                    parentClass: node.parentElement?.className ?? null,
                    rect: node.parentElement ? rectOf(node.parentElement) : null,
                  });
                }
              }
            }
            return {
              runtime: globalThis.__codexThemeRuntime?.inspect?.() ?? null,
              panel: panel ? rectOf(panel) : null,
              scroll: scroll ? rectOf(scroll) : null,
              aliases,
              mainSurfaces: Array.from(document.querySelectorAll(
                '[data-app-shell-main-surface], [class*="_MainContentSurface_"]',
              )).map((surface) => ({
                tag: surface.tagName,
                className: surface.className,
                rect: rectOf(surface),
              })),
              usageResources: performance.getEntriesByType("resource")
                .map((entry) => entry.name)
                .filter((name) => name.includes("/wham/usage")),
            };
          })()`,
          returnByValue: true
        },
        sessionId
      );
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "UI 진단에 실패했습니다.");
      }
      console.log(`[wallpaper] UI 진단: ${JSON.stringify(result.result?.value ?? null)}`);
    };
    const captureScreenshot = async (sessionId) => {
      if (session.stopped || !options.screenshotPath || screenshotCaptured) return;
      screenshotCaptured = true;
      const screenshot = await cdp.send(
        "Page.captureScreenshot",
        { format: "png", fromSurface: true },
        sessionId
      );
      if (session.stopped) return;
      fs4.mkdirSync(path3.dirname(options.screenshotPath), { recursive: true });
      fs4.writeFileSync(options.screenshotPath, Buffer.from(screenshot.data, "base64"));
      console.log(`[wallpaper] 검증 화면 저장: ${options.screenshotPath}`);
      if (options.exitAfterScreenshot) session.setTimeout(() => session.stop(), 100);
    };
    const onReady = async ({ sessionId }) => {
      if (options.inspectUi || options.screenshotPath) {
        if (!await session.delay(2500)) return;
      }
      if (options.inspectUi) await inspectUi(sessionId);
      await captureScreenshot(sessionId);
    };
    controller = new TargetController({
      cdp,
      source,
      pushUiState,
      onReady
    });
    session.setController(controller);
    const refreshLatencies = async () => {
      if (session.stopped) return;
      const latencies = await measurePinnedSshLatencies(pinnedSshHosts);
      if (session.stopped) return;
      latestLatencies = latencies;
      await broadcastUiState();
    };
    const captureUsageResponse = async (sessionId, requestId) => {
      if (session.stopped || appServerUsageAvailable) return;
      try {
        const responseBody = await cdp.send("Network.getResponseBody", { requestId }, sessionId);
        if (session.stopped) return;
        const body = responseBody.base64Encoded ? Buffer.from(responseBody.body, "base64").toString("utf8") : responseBody.body;
        const usage = normalizeUsagePayload(JSON.parse(body));
        if (usage == null) return;
        latestUsage = usage;
        writeUsageCache(usageCachePath, usage);
        console.log(`[wallpaper] 사용량 갱신: ${usage.remainingPercent}% 남음`);
        await broadcastUiState();
      } catch (error) {
        if (session.stopped) return;
        console.error(`[wallpaper] 사용량 응답을 읽지 못했습니다: ${error.message}`);
      }
    };
    cdp.eventHandler = async (message) => {
      if (message.method === "Target.targetCreated" || message.method === "Target.targetInfoChanged") {
        await controller.handleTargetInfo(message.params.targetInfo);
        return;
      }
      if (message.method === "Target.targetDestroyed") {
        const targetId = message.params.targetId;
        for (const [key, request] of usageRequests) {
          if (controller.targetIdForSession(request.sessionId) === targetId) usageRequests.delete(key);
        }
        controller.handleTargetDestroyed(targetId);
        return;
      }
      if (message.method === "Target.detachedFromTarget") {
        controller.handleSessionDetached(message.params.sessionId, message.params.targetId);
        return;
      }
      if (message.method === "Page.loadEventFired" && message.sessionId && controller.targetIdForSession(message.sessionId)) {
        try {
          await pushUiState(message.sessionId);
        } catch (error) {
          console.error(`[wallpaper] 새 문서 상태 갱신을 건너뛰었습니다: ${error.message}`);
        }
        return;
      }
      if (message.method === "Network.responseReceived" && message.sessionId) {
        const responseUrl = message.params.response?.url ?? "";
        if (/\/wham\/usage(?:[?#]|$)/.test(responseUrl)) {
          usageRequests.set(`${message.sessionId}:${message.params.requestId}`, {
            requestId: message.params.requestId,
            sessionId: message.sessionId
          });
        }
        return;
      }
      if (message.method === "Network.loadingFinished" && message.sessionId) {
        const key = `${message.sessionId}:${message.params.requestId}`;
        const usageRequest = usageRequests.get(key);
        if (usageRequest) {
          usageRequests.delete(key);
          await captureUsageResponse(usageRequest.sessionId, usageRequest.requestId);
        }
        return;
      }
      if (message.method === "Network.loadingFailed" && message.sessionId) {
        usageRequests.delete(`${message.sessionId}:${message.params.requestId}`);
      }
    };
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    const { targetInfos = [] } = await cdp.send("Target.getTargets");
    await Promise.all(targetInfos.map((targetInfo) => controller.handleTargetInfo(targetInfo)));
    if (session.stopped) return;
    if (usageClient != null) {
      void refreshAccountUsage();
      session.setInterval(refreshAccountUsage, 60 * 1e3);
    }
    void refreshLatencies();
    session.setInterval(refreshLatencies, LATENCY_REFRESH_MS);
    console.log("[wallpaper] 실행기를 닫으면 이 전용 Codex 인스턴스도 함께 종료됩니다.");
  });
}
main().catch((error) => {
  console.error(`[wallpaper] ${error.message}`);
  process.exitCode = 1;
});
