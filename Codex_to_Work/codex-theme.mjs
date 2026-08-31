#!/usr/bin/env node

// Codex_to_Work/src/main.mjs
import { spawn as spawn2 } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// Codex_to_Work/src/host/cdp-pipe.mjs
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
    this.output.setEncoding("utf8");
    this.output.on("data", (chunk) => this.handleChunk(chunk));
    this.output.on("error", (error) => this.failAll(error));
    this.output.on("close", () => this.failAll(new Error("디버깅 파이프가 닫혔습니다.")));
  }
  handleChunk(chunk) {
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
        void this.eventHandler(message);
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
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 응답 시간이 초과되었습니다.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.input.write(`${JSON.stringify(message)}\0`);
    });
  }
};

// Codex_to_Work/src/host/rate-limit-client.mjs
import { spawn } from "node:child_process";

// Codex_to_Work/src/host/support.mjs
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
    inspectUi: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--image") {
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
  const windows = rateLimits.flatMap((rateLimit) => [rateLimit.primary_window, rateLimit.secondary_window]).filter((window2) => window2 != null && Number.isFinite(Number(window2.used_percent))).map((window2) => ({
    usedPercent: Number(window2.used_percent),
    windowSeconds: Number(window2.limit_window_seconds) || 0,
    resetAtSeconds: Number(window2.reset_at)
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
  const windows = [snapshot.primary, snapshot.secondary].filter((window2) => window2 != null && Number.isFinite(Number(window2.usedPercent))).map((window2) => ({
    usedPercent: Number(window2.usedPercent),
    windowMinutes: Number(window2.windowDurationMins) || 0,
    resetAtSeconds: Number(window2.resetsAt)
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

// Codex_to_Work/src/host/rate-limit-client.mjs
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

// Codex_to_Work/src/host/target-controller.mjs
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
        exhausted: false
      };
      this.records.set(targetInfo.targetId, record);
    } else {
      const wasEligible = this.eligible(record.targetInfo);
      record.targetInfo = targetInfo;
      if (!wasEligible && this.eligible(targetInfo)) {
        record.retryCount = 0;
        record.exhausted = false;
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
    record.exhausted = false;
    if (this.eligible(record.targetInfo)) this.#scheduleRetry(resolvedTargetId, record);
  }
  dispose() {
    this.disposed = true;
    for (const record of this.records.values()) {
      record.generation += 1;
      this.#cancelRetry(record);
    }
    this.records.clear();
    this.sessionTargets.clear();
  }
  async #ensureAttached(targetId, record) {
    if (this.disposed || this.records.get(targetId) !== record || record.sessionId || record.attachPromise || record.retryTimer || record.exhausted) {
      return;
    }
    const attachPromise = this.#attach(targetId, record);
    record.attachPromise = attachPromise;
    try {
      await attachPromise;
    } finally {
      if (this.records.get(targetId) === record && record.attachPromise === attachPromise) {
        record.attachPromise = null;
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
      record.exhausted = false;
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
    if (this.disposed || this.records.get(targetId) !== record || !this.eligible(record.targetInfo) || record.retryTimer) {
      return false;
    }
    if (record.retryCount >= this.retryDelaysMs.length) {
      record.exhausted = true;
      return false;
    }
    const delayMs = this.retryDelaysMs[record.retryCount];
    record.retryCount += 1;
    const generation = record.generation;
    record.retryTimer = this.setTimeoutFn(() => {
      if (!this.#isCurrent(targetId, record, generation)) return;
      record.retryTimer = null;
      void this.#ensureAttached(targetId, record);
    }, delayMs);
    return true;
  }
  #cancelRetry(record) {
    if (!record.retryTimer) return;
    this.clearTimeoutFn(record.retryTimer);
    record.retryTimer = null;
  }
  async #detachQuietly(sessionId) {
    try {
      await this.cdp.send("Target.detachFromTarget", { sessionId });
    } catch {
    }
  }
};

// Codex_to_Work/src/page/runtime.mjs
function installPageRuntime(initialConfig) {
  const RUNTIME_KEY = "__codexThemeRuntime";
  const requestedVersion = Number(initialConfig?.version) || 1;
  const existing = globalThis[RUNTIME_KEY];
  if (existing?.version === requestedVersion) {
    return existing.install(initialConfig);
  }
  let retainedState = null;
  try {
    retainedState = existing?.dispose?.({ preserveStyle: true }) ?? null;
  } catch {
  }
  globalThis.__codexThemeUiObserver?.disconnect?.();
  clearInterval(globalThis.__codexThemeComposerTimer);
  clearInterval(globalThis.__codexThemeUsageTimer);
  try {
    globalThis.__codexThemeDisposeThumbFire?.();
  } catch {
  }
  delete globalThis.__codexThemeUiObserver;
  delete globalThis.__codexThemeComposerTimer;
  delete globalThis.__codexThemeUsageTimer;
  delete globalThis.__codexThemeDisposeThumbFire;
  delete globalThis.__installCodexThemeWallpaper;
  delete globalThis.__setCodexThemeUsage;
  delete globalThis.__setCodexThemeLatencies;
  delete globalThis.__prepareCodexThemeUsageProbe;
  delete globalThis.__collectCodexThemeUsageProbe;
  delete globalThis.__finishCodexThemeUsageProbe;
  const runtime = createRuntime(initialConfig, retainedState);
  globalThis[RUNTIME_KEY] = runtime;
  return runtime.install(initialConfig);
  function createRuntime(startingConfig, retained) {
    const STYLE_ID = "codex-theme-style";
    const USAGE_PANEL_ID = "codex-theme-usage-panel";
    const QUICK_CHAT_BUTTON_ID = "codex-theme-chat-quick-chat";
    const OWNED_ATTRIBUTE = "data-codex-theme-owned";
    const USAGE_CACHE_KEY = "codex-theme-usage-cache";
    const USAGE_REFRESH_MS = 60 * 1e3;
    const ACTIVITY_REFRESH_MS = 500;
    const CHAT_TURN_DIFF_REFRESH_MS = 1e3;
    const RAINBOW_FRAME_INTERVAL_MS = 1e3 / 30;
    const RAINBOW_ACTIVE_GRACE_MS = Number(startingConfig?.timings?.rainbowGraceMs) || 900;
    const USAGE_ACTIVITY_GRACE_MS = Number(startingConfig?.timings?.usageGraceMs) || 1200;
    const FIRE_FRAME_INTERVAL_MS = 250;
    const THUMB_FIRE_GROWTH_DURATION_MS = 5 * 60 * 1e3;
    const WALLPAPER_IMAGE_WIDTH = 2662;
    const WALLPAPER_IMAGE_HEIGHT = 1776;
    const THUMB_FIRE_POINTS = [
      { side: "left", x: 404, y: 1180 },
      { side: "right", x: 2370, y: 1174 }
    ];
    const RELEVANT_STRUCTURE_SELECTOR = [
      ".app-shell-left-panel",
      "[data-app-action-sidebar-scroll]",
      "[data-app-action-sidebar-thread-row]",
      "[data-app-action-sidebar-project-row]",
      "[data-app-shell-main-surface]",
      '[class*="_MainContentSurface_"]',
      "[data-composer-surface-variant]",
      "[data-codex-composer]",
      "textarea",
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-placeholder]'
    ].join(",");
    let config = { ...startingConfig };
    let installed = false;
    let disposed = false;
    let domReadyHandler = null;
    let observer = null;
    let activityTimer = 0;
    let usageTimer = 0;
    let chatTurnDiffTimer = 0;
    let nativeTurnDiffRuntime = null;
    let nativeTurnDiffRuntimePromise = null;
    let nativeTurnDiffRenderInFlight = false;
    let nativeTurnDiffRenderRequested = false;
    let nativeTurnDiffLastError = null;
    const nativeTurnDiffRoots = /* @__PURE__ */ new Map();
    const workCommandSummaryNodes = /* @__PURE__ */ new Map();
    const workTechnicalDetailNodes = /* @__PURE__ */ new Map();
    let structureFrame = 0;
    let activityFrame = 0;
    let usageFetchInFlight = null;
    let activityState = null;
    let usageActivityActiveUntil = 0;
    let quickChatHandler = null;
    let quickChatTemplate = null;
    let quickChatLabel = "";
    let quickChatPrimaryLabel = "";
    let quickChatRowClassName = "";
    let quickChatRuntime = null;
    let quickChatRuntimePromise = null;
    let quickChatLastError = null;
    let composerSurface = null;
    let composerCanvas = null;
    let composerResizeObserver = null;
    let composerAnimationFrame = 0;
    let composerLastDrawTimestamp = -Infinity;
    let composerGeometryKey = "";
    let composerSegments = [];
    let composerActiveUntil = 0;
    let composerActive = false;
    let fireSurface = null;
    let fireLayer = null;
    let fireImages = [];
    let fireResizeObserver = null;
    let fireGeometryFrame = 0;
    let fireTimer = 0;
    let fireActive = false;
    let fireActiveStartedAt = 0;
    let fireCurrentSessionKey = null;
    const uiState = {
      usage: retained?.usage ?? null,
      latencies: retained?.latencies && typeof retained.latencies === "object" ? retained.latencies : {},
      usageError: null
    };
    const sessionStarts = retained?.sessionStarts && typeof retained.sessionStarts === "object" ? retained.sessionStarts : /* @__PURE__ */ Object.create(null);
    const diagnostics = {
      installs: 0,
      evaluations: 0,
      refreshes: 0,
      structureReconciles: 0,
      activityChecks: 0,
      observerCallbacks: 0,
      ignoredObserverCallbacks: 0,
      stateUpdates: 0,
      composerCanvasCreates: 0,
      fireLayerCreates: 0,
      nativeTurnDiffLoads: 0,
      nativeTurnDiffLoadErrors: 0,
      nativeTurnDiffRenders: 0,
      nativeTurnDiffRenderErrors: 0,
      workCommandSummaryReveals: 0,
      workCommandSummaryRestores: 0,
      workTechnicalDetailRenders: 0,
      workTechnicalDetailRemovals: 0,
      quickChatHandlerCaptures: 0,
      quickChatBridgeLoads: 0,
      quickChatBridgeLoadErrors: 0,
      quickChatButtonsCreated: 0,
      quickChatOpens: 0,
      quickChatOpenErrors: 0
    };
    loadCachedUsage();
    const runtime2 = {
      version: Number(startingConfig?.version) || 1,
      install,
      updateState,
      refresh,
      inspect,
      dispose
    };
    return runtime2;
    function loadCachedUsage() {
      if (uiState.usage != null) return;
      try {
        const cached = JSON.parse(localStorage.getItem(USAGE_CACHE_KEY) || "null");
        const cacheIsFresh = Number.isFinite(cached?.capturedAtMs) && Date.now() - cached.capturedAtMs <= 6 * 60 * 60 * 1e3;
        const resetIsValid = !Number.isFinite(cached?.resetAtMs) || cached.resetAtMs > Date.now();
        if (cacheIsFresh && resetIsValid) uiState.usage = cached;
      } catch {
      }
    }
    function isVisible(element) {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    function isOwnedNode(node) {
      const element = node instanceof Element ? node : node?.parentElement;
      if (!(element instanceof Element)) return false;
      return element.id === STYLE_ID || element.hasAttribute(OWNED_ATTRIBUTE) || element.closest(`[${OWNED_ATTRIBUTE}="true"]`) != null;
    }
    function markOwned(element) {
      if (element.getAttribute(OWNED_ATTRIBUTE) !== "true") {
        element.setAttribute(OWNED_ATTRIBUTE, "true");
      }
      return element;
    }
    function setAttributeIfChanged(element, name, value) {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
    function removeAttributeIfPresent(element, name) {
      if (element.hasAttribute(name)) element.removeAttribute(name);
    }
    function setStylePropertyIfChanged(element, name, value) {
      if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
    }
    function shallowEqualObject(left, right) {
      if (left === right) return true;
      const leftKeys = Object.keys(left || {});
      const rightKeys = Object.keys(right || {});
      if (leftKeys.length !== rightKeys.length) return false;
      return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key]));
    }
    function usageEqual(left, right) {
      return left === right || left != null && right != null && left.remainingPercent === right.remainingPercent && left.resetAtMs === right.resetAtMs && left.resetLabel === right.resetLabel && left.capturedAtMs === right.capturedAtMs;
    }
    function ensureStyle() {
      let style = document.getElementById(STYLE_ID);
      if (!(style instanceof HTMLStyleElement)) {
        const parent = document.head || document.documentElement;
        if (!(parent instanceof Element)) return null;
        style = document.createElement("style");
        style.id = STYLE_ID;
        markOwned(style);
        parent.appendChild(style);
      }
      if (style.textContent !== config.css) style.textContent = config.css || "";
      return style;
    }
    function normalizeUsagePayload2(payload) {
      const rateLimits = [
        payload?.rate_limit,
        ...Array.isArray(payload?.additional_rate_limits) ? payload.additional_rate_limits.map((limit) => limit?.rate_limit) : []
      ].filter((rateLimit) => rateLimit != null && typeof rateLimit === "object");
      const windows = rateLimits.flatMap((rateLimit) => [rateLimit.primary_window, rateLimit.secondary_window]).filter((window2) => window2 != null && Number.isFinite(Number(window2.used_percent))).map((window2) => ({
        usedPercent: Number(window2.used_percent),
        windowSeconds: Number(window2.limit_window_seconds) || 0,
        resetAtSeconds: Number(window2.reset_at)
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
        capturedAtMs: Date.now()
      };
    }
    function fetchUsagePayload() {
      return new Promise((resolve, reject) => {
        const bridge = globalThis.electronBridge;
        if (typeof bridge?.sendMessageFromView !== "function") {
          reject(new Error("앱 요청 통로를 찾지 못했습니다"));
          return;
        }
        const requestId = globalThis.crypto?.randomUUID?.() || `codex-theme-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        let settled = false;
        let timeout = 0;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
          callback(value);
        };
        const onMessage = (event) => {
          const message = event.data;
          if (message?.type !== "fetch-response" || message.requestId !== requestId) return;
          if (message.responseType !== "success") {
            finish(reject, new Error(message.error || "사용량 요청이 실패했습니다"));
            return;
          }
          try {
            finish(resolve, JSON.parse(message.bodyJsonString || "null"));
          } catch (error) {
            finish(reject, error);
          }
        };
        timeout = setTimeout(() => {
          finish(reject, new Error("사용량 요청 시간이 초과되었습니다"));
        }, 1e4);
        window.addEventListener("message", onMessage);
        Promise.resolve(bridge.sendMessageFromView({
          type: "fetch",
          requestId,
          method: "GET",
          url: "/wham/usage",
          headers: {
            "X-OpenAI-Attach-Auth": "1",
            "X-OpenAI-Attach-Integrity-State": "1",
            "OAI-Language": navigator.language || "en",
            originator: "Codex Desktop"
          }
        })).catch((error) => finish(reject, error));
      });
    }
    async function refreshUsage() {
      if (disposed || usageFetchInFlight) return usageFetchInFlight;
      usageFetchInFlight = (async () => {
        try {
          const usage = normalizeUsagePayload2(await fetchUsagePayload());
          if (usage == null) throw new Error("사용량 응답 형식이 올바르지 않습니다");
          uiState.usageError = null;
          updateState({ usage });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (uiState.usageError !== message) {
            uiState.usageError = message;
            scheduleStructure("usage-error");
          }
        } finally {
          usageFetchInFlight = null;
        }
      })();
      return usageFetchInFlight;
    }
    function formatUsage(usage) {
      if (!usage || !Number.isFinite(usage.remainingPercent)) {
        return {
          value: uiState.usageError ? "使用量を取得できません" : "使用量を確認中…",
          reset: "",
          title: uiState.usageError || "使用量を確認中です",
          remainingPercent: 0
        };
      }
      let resetLabel = "更新時刻を確認中…";
      let resetTitle = "";
      if (typeof usage.resetLabel === "string" && usage.resetLabel.trim()) {
        resetLabel = `${usage.resetLabel.trim()}リセット`;
        resetTitle = usage.resetLabel.trim();
      } else if (Number.isFinite(usage.resetAtMs)) {
        const resetDate = new Date(usage.resetAtMs);
        resetLabel = `${resetDate.getMonth() + 1}月${resetDate.getDate()}日リセット`;
        resetTitle = new Intl.DateTimeFormat("ja-JP", {
          dateStyle: "medium",
          timeStyle: "short"
        }).format(resetDate);
      }
      return {
        value: `${usage.remainingPercent}% 残り`,
        reset: resetLabel,
        title: resetTitle ? `使用量 ${usage.remainingPercent}% 残り · ${resetTitle}リセット` : `使用量 ${usage.remainingPercent}% 残り`,
        remainingPercent: Math.min(100, Math.max(0, usage.remainingPercent))
      };
    }
    function findSidebarFooterContext() {
      const panel = document.querySelector(".app-shell-left-panel");
      if (!(panel instanceof HTMLElement)) return null;
      const scroll = panel.querySelector("[data-app-action-sidebar-scroll]");
      if (!(scroll instanceof HTMLElement)) return null;
      const profileButtons = Array.from(panel.querySelectorAll("button.sidebar-item")).filter((button) => !scroll.contains(button) && isVisible(button)).sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom);
      const profileButton = profileButtons[0];
      if (!(profileButton instanceof HTMLButtonElement)) return null;
      const footerRow = profileButton.closest(".h-toolbar");
      if (!(footerRow instanceof HTMLElement) || !panel.contains(footerRow) || !isVisible(footerRow)) {
        return null;
      }
      return { footerRow, panel, profileButton, scroll };
    }
    function usagePanelIsAllowed() {
      return !/^\/settings(?:\/|$)/.test(location.pathname);
    }
    function renderUsagePanel() {
      if (!usagePanelIsAllowed()) {
        document.getElementById(USAGE_PANEL_ID)?.remove();
        return;
      }
      const context = findSidebarFooterContext();
      if (context == null) {
        document.getElementById(USAGE_PANEL_ID)?.remove();
        return;
      }
      const host = context.footerRow.parentElement;
      if (!(host instanceof HTMLElement)) return;
      document.getElementById("codex-theme-usage-badge")?.remove();
      for (const hiddenHelp of document.querySelectorAll('[data-codex-theme-help-hidden="true"]')) {
        removeAttributeIfPresent(hiddenHelp, "data-codex-theme-help-hidden");
      }
      let panel = document.getElementById(USAGE_PANEL_ID);
      if (!(panel instanceof HTMLElement)) {
        panel = markOwned(document.createElement("section"));
        panel.id = USAGE_PANEL_ID;
        panel.setAttribute("aria-live", "polite");
        panel.innerHTML = [
          '<div class="codex-theme-usage-row">',
          '<span class="codex-theme-usage-value">使用量を確認中…</span>',
          '<span class="codex-theme-usage-reset"></span>',
          "</div>",
          '<div class="codex-theme-usage-track" aria-hidden="true">',
          '<div class="codex-theme-usage-fill"></div>',
          "</div>"
        ].join("");
      }
      if (panel.parentElement !== host || panel.nextElementSibling !== context.footerRow) {
        host.insertBefore(panel, context.footerRow);
      }
      const formatted = formatUsage(uiState.usage);
      const value = panel.querySelector(".codex-theme-usage-value");
      const reset = panel.querySelector(".codex-theme-usage-reset");
      const fill = panel.querySelector(".codex-theme-usage-fill");
      if (value?.textContent !== formatted.value) value.textContent = formatted.value;
      if (reset?.textContent !== formatted.reset) reset.textContent = formatted.reset;
      if (fill instanceof HTMLElement) {
        const clipRight = `${100 - formatted.remainingPercent}%`;
        setStylePropertyIfChanged(fill, "--codex-theme-usage-clip-right", clipRight);
        setAttributeIfChanged(fill, "data-remaining-percent", String(formatted.remainingPercent));
      }
      if (panel.title !== formatted.title) panel.title = formatted.title;
      setAttributeIfChanged(panel, "aria-label", formatted.title);
    }
    function reactEventProps(element) {
      if (!(element instanceof Element)) return null;
      for (const key of Object.getOwnPropertyNames(element)) {
        if (!key.startsWith("__reactProps$")) continue;
        const props = element[key];
        if (props != null && typeof props === "object") return props;
      }
      return fiberProps(reactFiberForElement(element));
    }
    function isQuickChatButton(button) {
      if (!(button instanceof HTMLButtonElement) || isOwnedNode(button) || !isVisible(button)) {
        return false;
      }
      if (button.querySelector('path[d^="M7.9834 5.3042"]')) return true;
      const label = button.getAttribute("aria-label")?.toLocaleLowerCase() ?? "";
      const normalized = label.replace(/[\s_-]+/g, "");
      return normalized.includes("quickchat") || normalized.includes("クイックチャット") || normalized.includes("빠른채팅");
    }
    function quickChatRow(button, panel) {
      for (let current = button.parentElement; current != null && current !== panel; current = current.parentElement) {
        if (current instanceof HTMLElement && current.classList.contains("flex") && current.classList.contains("items-center") && current.classList.contains("gap-1")) {
          return current;
        }
      }
      return null;
    }
    function directChildWithin(element, ancestor) {
      let current = element;
      while (current.parentElement != null && current.parentElement !== ancestor) {
        current = current.parentElement;
      }
      return current.parentElement === ancestor ? current : null;
    }
    function sanitizeQuickChatTemplate(template) {
      if (!(template instanceof HTMLElement)) return null;
      for (const element of [template, ...template.querySelectorAll("*")]) {
        element.removeAttribute("id");
        element.removeAttribute("aria-describedby");
        element.removeAttribute("data-state");
      }
      markOwned(template);
      return template;
    }
    function captureNativeQuickChat(panel) {
      const nativeButton = Array.from(panel.querySelectorAll("button")).find(isQuickChatButton);
      if (!(nativeButton instanceof HTMLButtonElement)) return null;
      const row = quickChatRow(nativeButton, panel);
      const branch = row == null ? null : directChildWithin(nativeButton, row);
      const onClick = reactEventProps(nativeButton)?.onClick;
      if (!(row instanceof HTMLElement) || !(branch instanceof HTMLElement) || typeof onClick !== "function") {
        return nativeButton;
      }
      if (quickChatHandler !== onClick) diagnostics.quickChatHandlerCaptures += 1;
      quickChatHandler = onClick;
      quickChatTemplate = sanitizeQuickChatTemplate(branch.cloneNode(true));
      quickChatLabel = nativeButton.getAttribute("aria-label")?.trim() || "Quick chat";
      quickChatPrimaryLabel = row.textContent?.trim() ?? "";
      quickChatRowClassName = row.className;
      return nativeButton;
    }
    function normalizedQuickChatText(value) {
      return String(value ?? "").toLocaleLowerCase().replace(/[\s_\-:：。、・!！?？()\[\]{}]+/g, "");
    }
    function isNewChatLabel(value) {
      const normalized = normalizedQuickChatText(value);
      return normalized === "newchat" || normalized === "新しいチャット" || normalized === "새채팅" || normalized === "새로운채팅" || normalized === "新聊天" || normalized === "新建聊天";
    }
    function rowLooksLikeNewChat(row) {
      if (!(row instanceof HTMLElement) || isOwnedNode(row) || !isVisible(row)) return false;
      if (quickChatPrimaryLabel && quickChatRowClassName && row.className === quickChatRowClassName && row.textContent?.trim() === quickChatPrimaryLabel) {
        return true;
      }
      if (!row.classList.contains("flex") || !row.classList.contains("items-center") || !row.classList.contains("gap-1")) {
        return false;
      }
      return Array.from(row.querySelectorAll("button, a")).some((candidate) => !isOwnedNode(candidate) && isNewChatLabel(candidate.textContent));
    }
    function chatNewChatRow(panel) {
      const rows = Array.from(panel.querySelectorAll("div")).filter(rowLooksLikeNewChat);
      rows.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
      return rows[0] ?? null;
    }
    function defaultQuickChatLabel() {
      const language = document.documentElement.lang?.toLocaleLowerCase() ?? "";
      if (language.startsWith("ja")) return "クイックチャット";
      if (language.startsWith("ko")) return "빠른 채팅";
      return "Quick chat";
    }
    function createQuickChatFallback() {
      const branch = document.createElement("div");
      branch.className = "pe-1";
      branch.innerHTML = [
        '<button class="codex-theme-quick-chat-button no-drag cursor-interaction items-center gap-1 border whitespace-nowrap select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-40 flex rounded-lg text-tertiary enabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border-transparent h-6 px-2 py-0 text-xs leading-4 aspect-square shrink-0 justify-center !px-0" type="button">',
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
        '<path d="M7.9834 5.3042C8.27312 5.30446 8.50879 5.5398 8.50879 5.82959V7.479H10.1582C10.4482 7.479 10.6836 7.71445 10.6836 8.00439C10.6836 8.29434 10.4482 8.52979 10.1582 8.52979H8.50879V10.1802C8.50853 10.4697 8.27296 10.7053 7.9834 10.7056C7.69361 10.7056 7.45827 10.4699 7.45801 10.1802V8.52979H5.80762C5.51767 8.52979 5.28223 8.29434 5.28223 8.00439C5.28223 7.71445 5.51767 7.479 5.80762 7.479H7.45801V5.82959C7.45801 5.53964 7.69345 5.3042 7.9834 5.3042Z" fill="currentColor"></path>',
        '<path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.80811C11.575 1.80811 14.5254 4.55306 14.5254 8.00049C14.5252 11.4478 11.5749 14.1919 8 14.1919C6.78477 14.1919 5.75932 13.8294 4.75488 13.3599L2.9873 13.8188C2.5113 13.9421 2.07317 13.5186 2.17969 13.0386L2.5498 11.3638C2.03641 10.3602 1.4747 9.38219 1.47461 8.00049C1.47461 4.55306 4.42502 1.80811 8 1.80811ZM8 2.85889C4.94756 2.85889 2.52539 5.18869 2.52539 8.00049C2.52548 9.13389 2.98018 9.88342 3.55176 11.0151C3.62017 11.1507 3.63938 11.3062 3.60645 11.4546L3.34277 12.6411L4.62598 12.3091L4.74023 12.2896C4.81669 12.2837 4.89333 12.2917 4.9668 12.312L5.0752 12.3521L5.44238 12.522C6.29248 12.8997 7.09158 13.1421 8 13.1421C11.0523 13.1421 13.4744 10.8121 13.4746 8.00049C13.4746 5.18869 11.0524 2.85889 8 2.85889Z" fill="currentColor"></path>',
        "</svg>",
        "</button>"
      ].join("");
      return sanitizeQuickChatTemplate(branch);
    }
    function isQuickChatStore(value) {
      try {
        return value != null && typeof value === "object" && typeof value.get === "function" && typeof value.set === "function" && typeof value.watch === "function" && typeof value.when === "function" && value.node != null && value.chain != null;
      } catch {
        return false;
      }
    }
    function quickChatStoreFromFiberTree() {
      const root = currentReactFiberRoot();
      if (root == null) return null;
      const stack = [root];
      const visitedFibers = /* @__PURE__ */ new Set();
      while (stack.length > 0 && visitedFibers.size < 1e5) {
        const fiber = stack.pop();
        if (fiber == null || visitedFibers.has(fiber)) continue;
        visitedFibers.add(fiber);
        let hook = fiber.memoizedState;
        const visitedHooks = /* @__PURE__ */ new Set();
        while (hook != null && typeof hook === "object" && visitedHooks.size < 1e3) {
          if (visitedHooks.has(hook)) break;
          visitedHooks.add(hook);
          const state = hook.memoizedState;
          const candidates = [state, state?.current, hook.baseState, hook.baseState?.current];
          const store = candidates.find(isQuickChatStore);
          if (store != null) return store;
          hook = hook.next;
        }
        if (fiber.sibling != null) stack.push(fiber.sibling);
        if (fiber.child != null) stack.push(fiber.child);
      }
      return null;
    }
    function nativeQuickChatOpen(moduleNamespace) {
      return Object.values(moduleNamespace).find((value) => {
        if (typeof value !== "function") return false;
        const source = Function.prototype.toString.call(value);
        return source.includes("chatgpt.quick-chat") && source.includes("projectId") && source.includes("projectName") && source.includes("hasConversation");
      }) ?? null;
    }
    async function loadQuickChatRuntime() {
      const testLoader = globalThis.__codexThemeQuickChatLoader;
      if (typeof testLoader === "function") {
        const loaded = await testLoader();
        if (typeof loaded?.open !== "function") {
          throw new Error("The Quick chat test loader returned an invalid runtime");
        }
        return loaded;
      }
      const appInitialPattern = /\/app-initial-[^/]+\.js(?:[?#]|$)/;
      const appInitialUrl = resourceAssetUrl(appInitialPattern) ?? linkedAssetUrl(appInitialPattern);
      if (appInitialUrl == null) throw new Error("The Quick chat app runtime was not found");
      const moduleNamespace = await import(appInitialUrl);
      const open = nativeQuickChatOpen(moduleNamespace);
      if (open == null) throw new Error("The native Quick chat command was not found");
      return { appInitialUrl, open };
    }
    async function ensureQuickChatRuntime() {
      if (quickChatRuntime != null) return quickChatRuntime;
      if (quickChatRuntimePromise == null) {
        quickChatRuntimePromise = loadQuickChatRuntime().then((loaded) => {
          quickChatRuntime = loaded;
          quickChatLastError = null;
          diagnostics.quickChatBridgeLoads += 1;
          return loaded;
        }).catch((error) => {
          quickChatLastError = String(error?.stack || error);
          diagnostics.quickChatBridgeLoadErrors += 1;
          quickChatRuntimePromise = null;
          throw error;
        });
      }
      return quickChatRuntimePromise;
    }
    async function openQuickChatThroughApp() {
      const runtime22 = await ensureQuickChatRuntime();
      const store = quickChatStoreFromFiberTree();
      if (store == null) throw new Error("The live Quick chat state store was not found");
      return runtime22.open(store, {});
    }
    function openQuickChat(event) {
      event.preventDefault();
      event.stopPropagation();
      try {
        const result = typeof quickChatHandler === "function" ? quickChatHandler(event) : openQuickChatThroughApp();
        diagnostics.quickChatOpens += 1;
        if (result != null && typeof result.then === "function") {
          Promise.resolve(result).catch((error) => {
            quickChatLastError = String(error?.stack || error);
            diagnostics.quickChatOpenErrors += 1;
          });
        }
      } catch (error) {
        quickChatLastError = String(error?.stack || error);
        diagnostics.quickChatOpenErrors += 1;
      }
    }
    function renderChatQuickChatButton() {
      const panel = document.querySelector(".app-shell-left-panel");
      const existing2 = document.getElementById(QUICK_CHAT_BUTTON_ID);
      if (!(panel instanceof HTMLElement) || !usagePanelIsAllowed()) {
        existing2?.remove();
        return;
      }
      const nativeButton = captureNativeQuickChat(panel);
      if (nativeButton instanceof HTMLButtonElement) {
        existing2?.remove();
        return;
      }
      const row = chatNewChatRow(panel);
      if (!(row instanceof HTMLElement)) {
        existing2?.remove();
        return;
      }
      if (existing2 instanceof HTMLElement && existing2.parentElement === row) return;
      existing2?.remove();
      const branch = quickChatTemplate instanceof HTMLElement ? sanitizeQuickChatTemplate(quickChatTemplate.cloneNode(true)) : createQuickChatFallback();
      if (!(branch instanceof HTMLElement)) return;
      branch.id = QUICK_CHAT_BUTTON_ID;
      const button = branch instanceof HTMLButtonElement ? branch : branch.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) return;
      button.disabled = false;
      const label = quickChatLabel || defaultQuickChatLabel();
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.addEventListener("click", openQuickChat);
      row.append(branch);
      diagnostics.quickChatButtonsCreated += 1;
    }
    function reactFiberForElement(element) {
      if (!(element instanceof Element)) return null;
      for (const key of Object.getOwnPropertyNames(element)) {
        if (key.startsWith("__reactFiber$")) return element[key] ?? null;
        if (key.startsWith("__reactContainer$")) {
          return element[key]?.current ?? element[key] ?? null;
        }
      }
      return null;
    }
    function currentReactFiberRoot() {
      const candidates = [
        ...document.querySelectorAll(
          '[data-app-shell-main-surface], [class*="_MainContentSurface_"]'
        ),
        document.body
      ];
      for (const candidate of candidates) {
        let fiber = reactFiberForElement(candidate);
        if (fiber == null) continue;
        while (fiber.return != null) fiber = fiber.return;
        return fiber.current ?? fiber;
      }
      return null;
    }
    function hashText(value) {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }
    function nearestTurnDiffHost(fiber) {
      for (let current = fiber?.return; current != null; current = current.return) {
        if (current.stateNode instanceof HTMLElement && current.stateNode.closest(
          '[data-app-shell-main-surface], [class*="_MainContentSurface_"]'
        ) != null) {
          return current.stateNode;
        }
      }
      return null;
    }
    function turnDiffItemsFromProps(props) {
      if (props == null || typeof props !== "object") return [];
      const candidates = [
        props.item,
        props.unifiedDiffItem,
        ...Array.isArray(props.items) ? props.items : [],
        ...Array.isArray(props.turn?.items) ? props.turn.items : [],
        ...Array.isArray(props.turnState?.items) ? props.turnState.items : [],
        ...Array.isArray(props.mcpTurn?.items) ? props.mcpTurn.items : []
      ];
      const items = [];
      const seen = /* @__PURE__ */ new Set();
      for (const item of candidates) {
        if (item == null || typeof item !== "object" || item.type !== "turn-diff" || typeof item.unifiedDiff !== "string" || item.unifiedDiff.length === 0 || seen.has(item)) {
          continue;
        }
        seen.add(item);
        items.push(item);
      }
      return items;
    }
    function fiberProps(fiber) {
      const props = fiber?.memoizedProps ?? fiber?.pendingProps;
      return props != null && typeof props === "object" ? props : null;
    }
    function firstDefined(current, next) {
      return current == null && next != null ? next : current;
    }
    function statusTurnInProgress(status) {
      if (typeof status !== "string") return null;
      const normalized = status.toLowerCase().replace(/[^a-z]/g, "");
      if (["active", "inprogress", "running", "started", "streaming", "working"].includes(normalized)) {
        return true;
      }
      if ([
        "cancelled",
        "canceled",
        "complete",
        "completed",
        "done",
        "failed",
        "interrupted",
        "stopped"
      ].includes(normalized)) {
        return false;
      }
      return null;
    }
    function turnInProgressFromProps(props) {
      if (props == null || typeof props !== "object") return null;
      const explicit = [
        props.isTurnInProgress,
        props.turn?.isTurnInProgress,
        props.turnState?.isTurnInProgress
      ].find((value) => typeof value === "boolean");
      if (explicit != null) return explicit;
      for (const status of [props.turn?.status, props.turnState?.status, props.turnStatus]) {
        const inProgress = statusTurnInProgress(status);
        if (inProgress != null) return inProgress;
      }
      for (const completed of [props.turn?.completed, props.turnState?.completed]) {
        if (typeof completed === "boolean") return !completed;
      }
      return null;
    }
    function turnItemsFromProps(props) {
      if (props == null || typeof props !== "object") return [];
      return [props.items, props.turn?.items, props.turnState?.items, props.mcpTurn?.items].filter(Array.isArray).sort((left, right) => right.length - left.length)[0] ?? [];
    }
    function itemsLookInProgress(items) {
      const streamingTypes = /* @__PURE__ */ new Set([
        "command-execution",
        "dynamic-tool-call",
        "mcp-tool-call",
        "web-search"
      ]);
      return items.some((item) => {
        if (item == null || typeof item !== "object" || !streamingTypes.has(item.type)) {
          return false;
        }
        if (item.completed === false) return true;
        return statusTurnInProgress(item.executionStatus ?? item.status) === true;
      });
    }
    function turnDiffContext(fiber, initialProps, item) {
      let conversationDetailLevel = initialProps?.conversationDetailLevel ?? initialProps?.threadDetailLevel ?? null;
      let conversationId = initialProps?.conversationId ?? initialProps?.turn?.conversationId ?? initialProps?.turnState?.conversationId ?? null;
      let cwd = initialProps?.cwd ?? item?.cwd ?? initialProps?.turn?.cwd ?? initialProps?.turnState?.cwd ?? null;
      let hostId = initialProps?.hostId ?? initialProps?.turn?.hostId ?? initialProps?.turnState?.hostId ?? null;
      let turnId = initialProps?.turnId ?? initialProps?.turn?.id ?? initialProps?.turnState?.turnId ?? null;
      let isTurnInProgress = turnInProgressFromProps(initialProps);
      let turnItems = turnItemsFromProps(initialProps);
      for (let current = fiber?.return; current != null; current = current.return) {
        const props = fiberProps(current);
        if (props == null) continue;
        conversationDetailLevel = firstDefined(
          conversationDetailLevel,
          props.conversationDetailLevel ?? props.threadDetailLevel
        );
        conversationId = firstDefined(
          conversationId,
          props.conversationId ?? props.turn?.conversationId ?? props.turnState?.conversationId
        );
        cwd = firstDefined(cwd, props.cwd ?? props.turn?.cwd ?? props.turnState?.cwd);
        hostId = firstDefined(hostId, props.hostId ?? props.turn?.hostId ?? props.turnState?.hostId);
        turnId = firstDefined(turnId, props.turnId ?? props.turn?.id ?? props.turnState?.turnId);
        isTurnInProgress = firstDefined(isTurnInProgress, turnInProgressFromProps(props));
        const candidateItems = turnItemsFromProps(props);
        if (candidateItems.length > turnItems.length) turnItems = candidateItems;
      }
      return {
        conversationDetailLevel,
        conversationId,
        cwd,
        hostId,
        isTurnInProgress: isTurnInProgress ?? itemsLookInProgress(turnItems),
        turnId,
        turnItems
      };
    }
    function reactProviderFibers(fiber) {
      const providers = [];
      for (let current = fiber?.return; current != null; current = current.return) {
        if (current.tag !== 10) continue;
        const providerType = current.elementType ?? current.type;
        if (providerType == null) continue;
        providers.push(current);
      }
      return providers;
    }
    function chatTurnDiffHost(fiber, context) {
      const nearestHost = nearestTurnDiffHost(fiber);
      if (!(nearestHost instanceof HTMLElement)) return null;
      const contentSearchTurn = nearestHost.closest("[data-content-search-turn-key]");
      if (contentSearchTurn instanceof HTMLElement) {
        const contentTurnKey = contentSearchTurn.getAttribute("data-content-search-turn-key");
        if (context.turnId == null || contentTurnKey === context.turnId) {
          return contentSearchTurn;
        }
      }
      const chatGptTurn = nearestHost.closest("[data-chatgpt-conversation-turn]");
      if (chatGptTurn instanceof HTMLElement) return chatGptTurn;
      return context.conversationDetailLevel === "STEPS_PROSE" ? nearestHost : null;
    }
    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function resourceAssetUrl(pattern) {
      try {
        const entries = performance.getEntriesByType?.("resource") ?? [];
        for (const entry of entries) {
          if (typeof entry?.name === "string" && pattern.test(entry.name)) return entry.name;
        }
      } catch {
      }
      return null;
    }
    function linkedAssetUrl(pattern) {
      try {
        for (const link of document.querySelectorAll("link[href]")) {
          const href = typeof link.href === "string" && link.href ? link.href : new URL(link.getAttribute("href"), document.baseURI).href;
          if (pattern.test(href)) return href;
        }
      } catch {
      }
      return null;
    }
    async function nativeTurnDiffAssetUrls() {
      const appInitialPattern = /\/app-initial-[^/]+\.js(?:[?#]|$)/;
      const nativeComponentPattern = /\/subagent-activity-chip-group-[^/]+\.js(?:[?#]|$)/;
      const turnModulePattern = /\/local-conversation-turn-[^/]+\.js(?:[?#]|$)/;
      const appInitialUrl = resourceAssetUrl(appInitialPattern) ?? linkedAssetUrl(appInitialPattern);
      let nativeComponentUrl = resourceAssetUrl(nativeComponentPattern) ?? linkedAssetUrl(nativeComponentPattern);
      if (nativeComponentUrl == null) {
        const turnModuleUrl = resourceAssetUrl(turnModulePattern) ?? linkedAssetUrl(turnModulePattern);
        if (turnModuleUrl != null) {
          const turnModuleSource = await fetch(turnModuleUrl).then((response) => response.text());
          const match = turnModuleSource.match(
            /["']\.\/((?:subagent-activity-chip-group)-[^"']+\.js)["']/
          );
          if (match?.[1]) nativeComponentUrl = new URL(match[1], turnModuleUrl).href;
        }
      }
      if (appInitialUrl == null || nativeComponentUrl == null) {
        throw new Error("Codex native turn-diff assets were not found");
      }
      return { appInitialUrl, nativeComponentUrl };
    }
    function reactDomFactoryExportName(source) {
      const markerIndex = source.indexOf(".createRoot=function");
      if (markerIndex < 0) return null;
      const wrapperMatch = source.slice(markerIndex, markerIndex + 5e3).match(
        /\}\)\),([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\(\(\(/
      );
      const wrapperName = wrapperMatch?.[1];
      if (!wrapperName) return null;
      const exportBlockIndex = source.lastIndexOf("export{");
      if (exportBlockIndex < 0) return null;
      const aliasMatch = source.slice(exportBlockIndex).match(
        new RegExp(`(?:^|,)${escapeRegExp(wrapperName)} as ([A-Za-z_$][\\w$]*)`)
      );
      return aliasMatch?.[1] ?? null;
    }
    function nativeTurnDiffComponent(moduleNamespace) {
      return Object.values(moduleNamespace).find((value) => {
        if (typeof value !== "function") return false;
        const source = Function.prototype.toString.call(value);
        return source.includes("inProgressDiffSummary") && source.includes("showRevertButton") && source.includes("deferOffscreenRendering");
      }) ?? null;
    }
    async function loadNativeTurnDiffRuntime() {
      const testLoader = globalThis.__codexThemeNativeTurnDiffLoader;
      if (typeof testLoader === "function") {
        const loaded = await testLoader();
        if (typeof loaded?.component !== "function" || typeof loaded?.createRoot !== "function") {
          throw new Error("The native turn-diff test loader returned an invalid runtime");
        }
        return loaded;
      }
      const { appInitialUrl, nativeComponentUrl } = await nativeTurnDiffAssetUrls();
      const [appInitialModule, componentModule, appInitialSource] = await Promise.all([
        import(appInitialUrl),
        import(nativeComponentUrl),
        fetch(appInitialUrl).then((response) => response.text())
      ]);
      const component = nativeTurnDiffComponent(componentModule);
      if (component == null) throw new Error("Codex native turn-diff component was not found");
      const factoryExportName = reactDomFactoryExportName(appInitialSource);
      const reactDomFactory = factoryExportName == null ? appInitialModule.mNt : appInitialModule[factoryExportName];
      const reactDom = typeof reactDomFactory === "function" ? reactDomFactory() : null;
      if (typeof reactDom?.createRoot !== "function") {
        throw new Error("Codex ReactDOM createRoot runtime was not found");
      }
      return {
        component,
        createRoot: reactDom.createRoot,
        appInitialUrl,
        nativeComponentUrl
      };
    }
    async function ensureNativeTurnDiffRuntime() {
      if (nativeTurnDiffRuntime != null) return nativeTurnDiffRuntime;
      if (nativeTurnDiffRuntimePromise == null) {
        nativeTurnDiffRuntimePromise = loadNativeTurnDiffRuntime().then((loaded) => {
          nativeTurnDiffRuntime = loaded;
          nativeTurnDiffLastError = null;
          diagnostics.nativeTurnDiffLoads += 1;
          return loaded;
        }).catch((error) => {
          nativeTurnDiffLastError = String(error?.stack || error);
          diagnostics.nativeTurnDiffLoadErrors += 1;
          nativeTurnDiffRuntimePromise = null;
          throw error;
        });
      }
      return nativeTurnDiffRuntimePromise;
    }
    function reactElement(type, props) {
      return {
        $$typeof: /* @__PURE__ */ Symbol.for("react.transitional.element"),
        type,
        key: null,
        props,
        _owner: null
      };
    }
    function nativeTurnDiffElement(runtime22, entry) {
      let element = reactElement(runtime22.component, {
        isInProgress: false,
        item: entry.item,
        deferOffscreenRendering: false,
        conversationId: entry.context.conversationId,
        cwd: entry.context.cwd,
        hostId: entry.context.hostId
      });
      for (const provider of entry.providers) {
        const providerType = provider.elementType ?? provider.type;
        if (providerType == null) continue;
        element = reactElement(providerType, {
          value: fiberProps(provider)?.value,
          children: element
        });
      }
      return element;
    }
    function removeNativeTurnDiffRoot(key, record = nativeTurnDiffRoots.get(key)) {
      if (record == null) return;
      nativeTurnDiffRoots.delete(key);
      try {
        record.root.unmount();
      } catch {
      }
      record.container.remove();
    }
    function reportNativeTurnDiffRenderError(error) {
      nativeTurnDiffLastError = String(error?.stack || error);
      diagnostics.nativeTurnDiffRenderErrors += 1;
    }
    function assistantActionRow(host) {
      if (!(host instanceof HTMLElement)) return null;
      const rows = Array.from(host.querySelectorAll("div")).filter((element) => element instanceof HTMLElement && !isOwnedNode(element) && element.classList.contains("mt-1.5") && element.classList.contains("h-5") && element.classList.contains("items-center") && element.classList.contains("justify-start") && element.classList.contains("gap-0.5"));
      return rows.at(-1) ?? null;
    }
    function placeNativeTurnDiffContainer(host, container) {
      const actionRow = assistantActionRow(host);
      if (actionRow?.parentElement instanceof HTMLElement) {
        if (container.parentElement !== actionRow.parentElement || container.nextElementSibling !== actionRow) {
          actionRow.before(container);
        }
        return;
      }
      if (container.parentElement !== host || host.lastElementChild !== container) {
        host.append(container);
      }
    }
    function mountNativeTurnDiff(runtime22, entry) {
      let record = nativeTurnDiffRoots.get(entry.key);
      if (record != null && (record.host !== entry.host || !record.container.isConnected)) {
        removeNativeTurnDiffRoot(entry.key, record);
        record = null;
      }
      if (record == null) {
        const container = markOwned(document.createElement("div"));
        container.setAttribute("data-codex-theme-native-turn-diff", "true");
        container.dataset.diffKey = entry.key;
        placeNativeTurnDiffContainer(entry.host, container);
        const root = runtime22.createRoot(container, {
          onCaughtError: reportNativeTurnDiffRenderError,
          onUncaughtError: reportNativeTurnDiffRenderError,
          onRecoverableError: reportNativeTurnDiffRenderError
        });
        record = { container, host: entry.host, root };
        nativeTurnDiffRoots.set(entry.key, record);
      }
      placeNativeTurnDiffContainer(entry.host, record.container);
      try {
        record.root.render(nativeTurnDiffElement(runtime22, entry));
        diagnostics.nativeTurnDiffRenders += 1;
      } catch (error) {
        reportNativeTurnDiffRenderError(error);
        removeNativeTurnDiffRoot(entry.key, record);
      }
    }
    function discoverNativeTurnDiffs(nativeComponent = null) {
      const root = currentReactFiberRoot();
      if (root == null) return /* @__PURE__ */ new Map();
      const discovered = /* @__PURE__ */ new Map();
      const stack = [root];
      const visited = /* @__PURE__ */ new Set();
      while (stack.length > 0 && visited.size < 1e5) {
        const fiber = stack.pop();
        if (fiber == null || visited.has(fiber)) continue;
        visited.add(fiber);
        const props = fiberProps(fiber);
        const items = turnDiffItemsFromProps(props);
        if (items.length > 0) {
          for (const item of items) {
            const context = turnDiffContext(fiber, props, item);
            if (context.isTurnInProgress) continue;
            const host = chatTurnDiffHost(fiber, context);
            if (!(host instanceof HTMLElement)) continue;
            if (context.conversationId == null) continue;
            const identity = item.id || context.turnId || hashText(`${context.conversationId}
${item.unifiedDiff}`);
            const key = `${context.conversationId}:${identity}`;
            const providers = reactProviderFibers(fiber);
            const nativeAlreadyRendered = nativeComponent != null && (fiber.type === nativeComponent || fiber.elementType === nativeComponent);
            const score = providers.length + (context.hostId != null ? 100 : 0) + (context.turnId != null ? 100 : 0) + (context.conversationDetailLevel === "STEPS_PROSE" ? 50 : 0) + (Array.isArray(item.patchBatches) ? 10 : 0);
            const previous = discovered.get(key);
            if (previous == null || score > previous.score) {
              discovered.set(key, {
                context,
                fiber,
                host,
                item,
                key,
                nativeAlreadyRendered: nativeAlreadyRendered || previous?.nativeAlreadyRendered,
                providers,
                score
              });
            } else if (nativeAlreadyRendered) {
              previous.nativeAlreadyRendered = true;
            }
          }
        }
        if (fiber.sibling != null) stack.push(fiber.sibling);
        if (fiber.child != null) stack.push(fiber.child);
      }
      return discovered;
    }
    async function renderChatModeTurnDiffs() {
      if (disposed || !document.documentElement) return;
      for (const legacyCard of document.querySelectorAll(".codex-theme-chat-turn-diff")) {
        legacyCard.remove();
      }
      let discovered = discoverNativeTurnDiffs(nativeTurnDiffRuntime?.component ?? null);
      for (const [key, record] of nativeTurnDiffRoots) {
        const entry = discovered.get(key);
        if (entry == null || entry.host !== record.host) removeNativeTurnDiffRoot(key, record);
      }
      if (discovered.size === 0) return;
      let runtime22;
      try {
        runtime22 = await ensureNativeTurnDiffRuntime();
      } catch {
        return;
      }
      if (disposed) return;
      discovered = discoverNativeTurnDiffs(runtime22.component);
      for (const [key, record] of nativeTurnDiffRoots) {
        const entry = discovered.get(key);
        if (entry == null || entry.host !== record.host || entry.nativeAlreadyRendered) {
          removeNativeTurnDiffRoot(key, record);
        }
      }
      for (const entry of discovered.values()) {
        if (!entry.nativeAlreadyRendered && entry.host.isConnected) {
          mountNativeTurnDiff(runtime22, entry);
        }
      }
    }
    function scheduleChatTurnDiffRender() {
      if (disposed) return;
      if (nativeTurnDiffRenderInFlight) {
        nativeTurnDiffRenderRequested = true;
        return;
      }
      nativeTurnDiffRenderInFlight = true;
      void renderChatModeTurnDiffs().catch(reportNativeTurnDiffRenderError).finally(() => {
        nativeTurnDiffRenderInFlight = false;
        if (nativeTurnDiffRenderRequested && !disposed) {
          nativeTurnDiffRenderRequested = false;
          scheduleChatTurnDiffRender();
        }
      });
    }
    function commandText(item) {
      const candidates = [
        item?.parsedCmd?.cmd,
        item?.command,
        item?.cmd,
        item?.arguments?.command
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
        if (Array.isArray(candidate) && candidate.length > 0) {
          return candidate.map(String).join(" ").trim();
        }
      }
      return "";
    }
    function redactCommand(value) {
      const secretName = "(?:[A-Z0-9_]*(?:API_?KEY|ACCESS_?TOKEN|AUTHORIZATION|BEARER|COOKIE|CREDENTIALS?|PASSWORD|PASSWD|SECRET|TOKEN)[A-Z0-9_]*)";
      const secretFlag = "(?:api[-_]?key|access[-_]?token|authorization|bearer|cookie|credentials?|password|passwd|secret|token)";
      const argument = `(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s]+)`;
      return String(value).replace(new RegExp(`\\b(${secretName})=(${argument})`, "gi"), "$1=<redacted>").replace(new RegExp(`(--${secretFlag})(?:=|\\s+)(${argument})`, "gi"), "$1 <redacted>");
    }
    function diffPaths(unifiedDiff) {
      if (typeof unifiedDiff !== "string") return [];
      const paths = [];
      for (const match of unifiedDiff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
        const before = match[1]?.trim();
        const after = match[2]?.trim();
        if (before) paths.push(before);
        if (after && after !== before) paths.push(after);
      }
      return paths;
    }
    function fencedCodeBlocks(content) {
      if (typeof content !== "string") return [];
      const blocks = [];
      for (const match of content.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
        blocks.push({
          code: redactCommand(match[2].trim()),
          language: match[1].trim()
        });
      }
      return blocks;
    }
    function addUnique(values, seen, value, limit = 100) {
      if (values.length >= limit || value == null) return;
      const text = String(value).trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      values.push(text.slice(0, 8e3));
    }
    function workTechnicalDetails(items) {
      const details = {
        commands: [],
        files: [],
        planCode: [],
        planSteps: [],
        searches: [],
        tools: []
      };
      const seen = Object.fromEntries(
        Object.keys(details).map((key) => [key, /* @__PURE__ */ new Set()])
      );
      for (const item of items.slice(0, 500)) {
        if (item == null || typeof item !== "object") continue;
        const command = commandText(item);
        if (command) addUnique(details.commands, seen.commands, redactCommand(command));
        for (const path3 of [item.path, item.filePath, item.fsPath, item.parsedCmd?.path]) {
          addUnique(details.files, seen.files, path3);
        }
        for (const change of Array.isArray(item.changes) ? item.changes : []) {
          addUnique(details.files, seen.files, change?.path ?? change?.filePath);
        }
        for (const path3 of diffPaths(item.unifiedDiff)) {
          addUnique(details.files, seen.files, path3);
        }
        if (item.type === "proposed-plan") {
          const content = item.content ?? item.plan ?? item.text;
          for (const block of fencedCodeBlocks(content)) {
            const key = `${block.language}
${block.code}`;
            if (seen.planCode.has(key) || details.planCode.length >= 30) continue;
            seen.planCode.add(key);
            details.planCode.push(block);
          }
        }
        if (["todo-list", "plan", "proposed-plan"].includes(item.type)) {
          const steps = [item.items, item.steps, item.todos, item.plan].find(Array.isArray) ?? [];
          for (const step of steps) {
            const text = typeof step === "string" ? step : step?.step ?? step?.text ?? step?.content ?? step?.title;
            const status = typeof step === "object" ? step?.status ?? step?.state : null;
            addUnique(
              details.planSteps,
              seen.planSteps,
              status && text ? `[${status}] ${text}` : text
            );
          }
        }
        if (["dynamic-tool-call", "mcp-tool-call"].includes(item.type)) {
          const server = item.server ?? item.serverName ?? item.mcpServer;
          const tool = item.tool ?? item.toolName ?? item.name;
          addUnique(details.tools, seen.tools, [server, tool].filter(Boolean).join(" · "));
        }
        if (item.type === "web-search") {
          for (const query of [
            item.query,
            item.searchQuery,
            ...Array.isArray(item.queries) ? item.queries : []
          ]) {
            addUnique(details.searches, seen.searches, query?.q ?? query);
          }
        }
      }
      return details;
    }
    function workTechnicalDetailsCount(details) {
      return details.commands.length + details.files.length + details.planCode.length + details.planSteps.length + details.searches.length + details.tools.length;
    }
    function appendWorkDetailSection(body, title, values, { code = false } = {}) {
      if (values.length === 0) return;
      const section = document.createElement("section");
      section.className = "codex-theme-work-details-section";
      const heading = document.createElement("h4");
      heading.textContent = title;
      section.append(heading);
      for (const value of values) {
        const row = document.createElement(code ? "pre" : "div");
        row.className = code ? "codex-theme-work-details-code" : "codex-theme-work-details-row";
        if (code && typeof value === "object") {
          if (value.language) row.dataset.language = value.language;
          row.textContent = value.code;
        } else {
          row.textContent = String(value);
        }
        section.append(row);
      }
      body.append(section);
    }
    function createWorkTechnicalDetailsNode(entry, open = false) {
      const panel = markOwned(document.createElement("details"));
      panel.className = "codex-theme-work-details";
      panel.setAttribute("data-codex-theme-work-details", "true");
      panel.dataset.detailKey = entry.key;
      panel.open = open;
      const summary = document.createElement("summary");
      const title = document.createElement("span");
      title.className = "codex-theme-work-details-title";
      title.textContent = "Codex details";
      const meta = document.createElement("span");
      meta.className = "codex-theme-work-details-meta";
      const count = workTechnicalDetailsCount(entry.details);
      meta.textContent = `${entry.context.isTurnInProgress ? "Working · " : ""}${count} item${count === 1 ? "" : "s"}`;
      summary.append(title, meta);
      panel.append(summary);
      const body = document.createElement("div");
      body.className = "codex-theme-work-details-body";
      appendWorkDetailSection(body, "Commands", entry.details.commands, { code: true });
      appendWorkDetailSection(body, "Files", entry.details.files, { code: true });
      appendWorkDetailSection(body, "Plan steps", entry.details.planSteps);
      appendWorkDetailSection(body, "Plan code", entry.details.planCode, { code: true });
      appendWorkDetailSection(body, "Tools", entry.details.tools, { code: true });
      appendWorkDetailSection(body, "Web searches", entry.details.searches);
      panel.append(body);
      return panel;
    }
    function discoverWorkTechnicalDetails() {
      const root = currentReactFiberRoot();
      if (root == null) return /* @__PURE__ */ new Map();
      const discovered = /* @__PURE__ */ new Map();
      const stack = [root];
      const visited = /* @__PURE__ */ new Set();
      while (stack.length > 0 && visited.size < 1e5) {
        const fiber = stack.pop();
        if (fiber == null || visited.has(fiber)) continue;
        visited.add(fiber);
        const props = fiberProps(fiber);
        const items = turnItemsFromProps(props);
        if (items.length > 0) {
          const context = turnDiffContext(fiber, props, null);
          if (context.conversationDetailLevel === "STEPS_PROSE" && context.conversationId != null && context.turnId != null) {
            const host = chatTurnDiffHost(fiber, context);
            const details = workTechnicalDetails(context.turnItems);
            const count = workTechnicalDetailsCount(details);
            if (host instanceof HTMLElement && count > 0) {
              const key = `${context.conversationId}:${context.turnId}`;
              const signature = hashText(JSON.stringify({
                details,
                isTurnInProgress: context.isTurnInProgress
              }));
              const score = context.turnItems.length + count * 10;
              const previous = discovered.get(key);
              if (previous == null || score > previous.score) {
                discovered.set(key, { context, details, host, key, score, signature });
              }
            }
          }
        }
        if (fiber.sibling != null) stack.push(fiber.sibling);
        if (fiber.child != null) stack.push(fiber.child);
      }
      return discovered;
    }
    function renderWorkTechnicalDetails() {
      if (disposed || !document.documentElement) return;
      const discovered = discoverWorkTechnicalDetails();
      for (const [key, record] of workTechnicalDetailNodes) {
        const entry = discovered.get(key);
        if (entry != null && entry.host === record.host && record.node.isConnected) continue;
        record.node.remove();
        workTechnicalDetailNodes.delete(key);
        diagnostics.workTechnicalDetailRemovals += 1;
      }
      for (const entry of discovered.values()) {
        const previous = workTechnicalDetailNodes.get(entry.key);
        if (previous != null && previous.host === entry.host && previous.signature === entry.signature && previous.node.isConnected) {
          continue;
        }
        const open = previous?.node?.open === true;
        const node = createWorkTechnicalDetailsNode(entry, open);
        if (previous?.node?.isConnected) previous.node.replaceWith(node);
        else entry.host.append(node);
        workTechnicalDetailNodes.set(entry.key, {
          host: entry.host,
          node,
          signature: entry.signature
        });
        diagnostics.workTechnicalDetailRenders += 1;
      }
    }
    function commandEntryForElement(element) {
      for (let current = reactFiberForElement(element); current != null; current = current.return) {
        const props = fiberProps(current);
        const item = props?.item;
        if (item != null && typeof item === "object" && ["command-execution", "exec"].includes(item.type) && commandText(item)) {
          return { context: turnDiffContext(current, props, item), fiber: current, item };
        }
      }
      return null;
    }
    function commandSummaryFromHeader(header) {
      const summary = Array.from(header.querySelectorAll("span")).find((element) => element instanceof HTMLElement && element.classList.contains("min-w-0") && element.classList.contains("truncate"));
      return summary instanceof HTMLElement ? summary : null;
    }
    function commandSummaryNode(body, host) {
      for (let current = body.parentElement; current instanceof HTMLElement && host.contains(current); current = current.parentElement) {
        const header = Array.from(current.querySelectorAll("div")).find((element) => element instanceof HTMLElement && element.classList.contains("group/activity-header") && !element.contains(body));
        if (!(header instanceof HTMLElement)) continue;
        const summary = commandSummaryFromHeader(header);
        if (summary != null) return summary;
      }
      return null;
    }
    function commandSummaryTextNode(summary) {
      const walker = document.createTreeWalker(summary, NodeFilter.SHOW_TEXT);
      const candidates = [];
      let node;
      while (node = walker.nextNode()) {
        if (node.nodeValue?.trim()) candidates.push(node);
      }
      return candidates.sort((left, right) => right.nodeValue.trim().length - left.nodeValue.trim().length)[0] ?? null;
    }
    function commandTextWithNativeWhitespace(originalText, command) {
      const leading = originalText.match(/^\s*/)?.[0] ?? "";
      const trailing = originalText.match(/\s*$/)?.[0] ?? "";
      return `${leading}${command}${trailing}`;
    }
    function restoreWorkCommandSummary(node, record = workCommandSummaryNodes.get(node)) {
      if (record?.textNode?.isConnected && record.textNode.nodeValue === record.renderedText) {
        record.textNode.nodeValue = record.originalText;
      }
      removeAttributeIfPresent(node, "data-codex-theme-work-command-summary");
      removeAttributeIfPresent(node, "data-codex-theme-work-command");
      diagnostics.workCommandSummaryRestores += 1;
    }
    function renderWorkCommandSummaries() {
      const desired = /* @__PURE__ */ new Map();
      const candidates = /* @__PURE__ */ new Set([
        ...document.querySelectorAll('[data-testid="exec-shell-body"]'),
        ...document.getElementsByClassName("group/activity-header")
      ]);
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement) || isOwnedNode(candidate)) continue;
        const entry = commandEntryForElement(candidate);
        if (entry?.context.conversationDetailLevel !== "STEPS_PROSE") continue;
        const host = chatTurnDiffHost(entry.fiber, entry.context);
        if (!(host instanceof HTMLElement)) continue;
        const summary = candidate.classList.contains("group/activity-header") ? commandSummaryFromHeader(candidate) : commandSummaryNode(candidate, host);
        if (!(summary instanceof HTMLElement)) continue;
        const command = redactCommand(commandText(entry.item));
        const textNode = commandSummaryTextNode(summary);
        if (command && textNode != null) desired.set(summary, { command, textNode });
      }
      for (const [node] of workCommandSummaryNodes) {
        if (desired.has(node) && node.isConnected) continue;
        restoreWorkCommandSummary(node);
        workCommandSummaryNodes.delete(node);
      }
      for (const [node, desiredEntry] of desired) {
        const { command, textNode } = desiredEntry;
        let record = workCommandSummaryNodes.get(node);
        if (record != null && record.textNode !== textNode) {
          restoreWorkCommandSummary(node, record);
          workCommandSummaryNodes.delete(node);
          record = null;
        }
        if (record == null) {
          record = {
            command,
            originalText: textNode.nodeValue,
            renderedText: "",
            textNode
          };
          workCommandSummaryNodes.set(node, record);
          diagnostics.workCommandSummaryReveals += 1;
        } else if (textNode.nodeValue !== record.renderedText) {
          record.originalText = textNode.nodeValue;
        }
        record.command = command;
        record.renderedText = commandTextWithNativeWhitespace(record.originalText, command);
        if (textNode.nodeValue !== record.renderedText) textNode.nodeValue = record.renderedText;
        setAttributeIfChanged(node, "data-codex-theme-work-command-summary", "true");
        setAttributeIfChanged(node, "data-codex-theme-work-command", command.slice(0, 8e3));
      }
    }
    function scheduleWorkModeEnhancements() {
      scheduleChatTurnDiffRender();
      renderWorkCommandSummaries();
      renderWorkTechnicalDetails();
    }
    function serverSignalBars(latency) {
      if (!Number.isFinite(latency)) return 0;
      if (latency <= 40) return 4;
      if (latency <= 100) return 3;
      if (latency <= 250) return 2;
      return 1;
    }
    function createServerSignal(alias) {
      const signal = markOwned(document.createElement("span"));
      signal.className = "codex-theme-server-signal";
      signal.dataset.hostAlias = alias;
      signal.setAttribute("role", "img");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("aria-hidden", "true");
      const bars = [
        { x: 1, y: 11, width: 2.5, height: 4 },
        { x: 4.8, y: 8, width: 2.5, height: 7 },
        { x: 8.6, y: 5, width: 2.5, height: 10 },
        { x: 12.4, y: 2, width: 2.5, height: 13 }
      ];
      bars.forEach((bar, index) => {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.classList.add("codex-theme-server-signal-bar");
        rect.dataset.index = String(index + 1);
        rect.setAttribute("x", String(bar.x));
        rect.setAttribute("y", String(bar.y));
        rect.setAttribute("width", String(bar.width));
        rect.setAttribute("height", String(bar.height));
        rect.setAttribute("rx", "1.25");
        svg.appendChild(rect);
      });
      signal.appendChild(svg);
      return signal;
    }
    function findServerLabel(scroll, panelRect, alias) {
      const normalizedAlias = alias.toLocaleLowerCase();
      const matches = [];
      const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);
      let textNode;
      while (textNode = walker.nextNode()) {
        if (textNode.nodeValue?.trim().toLocaleLowerCase() !== normalizedAlias) continue;
        const parent = textNode.parentElement;
        if (!(parent instanceof HTMLElement) || isOwnedNode(parent) || !isVisible(parent)) continue;
        const rect = parent.getBoundingClientRect();
        if (rect.left < panelRect.left + panelRect.width * 0.38) continue;
        matches.push(parent);
      }
      matches.sort((left, right) => right.getBoundingClientRect().left - left.getBoundingClientRect().left);
      return matches[0] ?? null;
    }
    function renderServerLatencies() {
      const panel = document.querySelector(".app-shell-left-panel");
      const scroll = panel?.querySelector("[data-app-action-sidebar-scroll]");
      if (!(panel instanceof HTMLElement) || !(scroll instanceof HTMLElement)) return;
      const latencies = uiState.latencies || {};
      const panelRect = panel.getBoundingClientRect();
      const desiredSignals = /* @__PURE__ */ new Set();
      const desiredNativeStatuses = /* @__PURE__ */ new Set();
      const existingSignals = new Map(
        Array.from(scroll.querySelectorAll(".codex-theme-server-signal")).filter((signal) => signal instanceof HTMLElement).map((signal) => [signal.dataset.hostAlias, signal])
      );
      for (const [alias, latency] of Object.entries(latencies)) {
        let signal = existingSignals.get(alias);
        let label = signal instanceof HTMLElement ? signal.previousElementSibling : null;
        if (!(label instanceof HTMLElement) || isOwnedNode(label)) {
          label = findServerLabel(scroll, panelRect, alias);
        }
        if (!(label instanceof HTMLElement)) continue;
        if (!(signal instanceof HTMLElement)) signal = createServerSignal(alias);
        if (signal.previousElementSibling !== label) label.insertAdjacentElement("afterend", signal);
        desiredSignals.add(signal);
        const nativeStatus = label.parentElement?.querySelector(":scope > .sidebar-item-icon");
        if (nativeStatus instanceof HTMLElement && nativeStatus !== signal) {
          desiredNativeStatuses.add(nativeStatus);
          setAttributeIfChanged(nativeStatus, "data-codex-theme-native-server-status", "true");
        }
        const barCount = serverSignalBars(latency);
        setAttributeIfChanged(signal, "data-bars", String(barCount));
        for (const bar of signal.querySelectorAll(".codex-theme-server-signal-bar")) {
          const index = Number(bar.getAttribute("data-index"));
          setAttributeIfChanged(bar, "data-active", index <= barCount ? "true" : "false");
        }
        const roundedLatency = Number.isFinite(latency) ? Math.round(latency) : null;
        const description = roundedLatency == null ? "未接続、信号 0/4" : `応答 ${roundedLatency}ミリ秒、信号 ${barCount}/4`;
        setAttributeIfChanged(signal, "aria-label", description);
        if (signal.title !== description) signal.title = description;
      }
      for (const signal of existingSignals.values()) {
        if (!desiredSignals.has(signal)) signal.remove();
      }
      for (const nativeStatus of scroll.querySelectorAll(
        '[data-codex-theme-native-server-status="true"]'
      )) {
        if (!desiredNativeStatuses.has(nativeStatus)) {
          removeAttributeIfPresent(nativeStatus, "data-codex-theme-native-server-status");
        }
      }
    }
    function findComposerSurface() {
      const editors = Array.from(document.querySelectorAll(
        '[data-codex-composer="true"], textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder]'
      )).filter((element) => {
        if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= 240 && rect.height >= 20;
      }).sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.bottom - leftRect.bottom || rightRect.width - leftRect.width;
      });
      const editor = editors[0];
      if (!(editor instanceof HTMLElement)) return null;
      const layoutRoot = editor.closest(
        "[data-composer-layout][data-composer-surface-variant]"
      );
      if (layoutRoot instanceof HTMLElement && isVisible(layoutRoot)) {
        for (let surface2 = editor.parentElement; surface2 && layoutRoot.contains(surface2); surface2 = surface2.parentElement) {
          const rect = surface2.getBoundingClientRect();
          const radius = Number.parseFloat(getComputedStyle(surface2).borderRadius);
          if (rect.width >= 320 && rect.height >= 48 && rect.height <= 260 && Number.isFinite(radius) && radius >= 8 && surface2.querySelector("button")) {
            return surface2;
          }
          if (surface2 === layoutRoot) break;
        }
        return layoutRoot;
      }
      if (composerSurface instanceof HTMLElement && composerSurface.isConnected && isVisible(composerSurface) && composerSurface.contains(editor)) {
        return composerSurface;
      }
      const form = editor.closest("form");
      if (form instanceof HTMLElement && isVisible(form)) return form;
      let surface = editor.parentElement;
      let candidate = null;
      for (let depth = 0; surface && depth < 8; depth += 1, surface = surface.parentElement) {
        const rect = surface.getBoundingClientRect();
        if (rect.width >= 320 && rect.height >= 48 && rect.height <= 260 && surface.querySelector("button")) {
          candidate = surface;
        }
        if (rect.width >= window.innerWidth * 0.92) break;
      }
      return candidate;
    }
    function composerIsActive(surface) {
      if (!(surface instanceof HTMLElement)) return false;
      if (config.rainbowPreview) return true;
      const stopPattern = /(?:stop|cancel|interrupt|停止|中止|キャンセル|중지|정지|취소)/i;
      const controls = Array.from(surface.querySelectorAll("button, [role=button]")).filter((element) => element instanceof HTMLElement && isVisible(element));
      if (controls.some((element) => stopPattern.test([
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.textContent
      ].filter(Boolean).join(" ")))) {
        return true;
      }
      return surface.querySelector(
        '[aria-busy="true"], [data-state="streaming"], [data-status="running"]'
      ) != null;
    }
    function setComposerSurface(nextSurface) {
      if (composerSurface === nextSurface && composerCanvas?.isConnected) return;
      stopComposerAnimation();
      composerResizeObserver?.disconnect();
      composerResizeObserver = null;
      if (composerSurface instanceof HTMLElement) {
        removeAttributeIfPresent(composerSurface, "data-codex-theme-rainbow-composer");
        removeAttributeIfPresent(composerSurface, "data-codex-theme-rainbow-active");
      }
      composerCanvas?.remove();
      composerSurface = nextSurface instanceof HTMLElement ? nextSurface : null;
      composerCanvas = null;
      composerGeometryKey = "";
      composerSegments = [];
      composerActive = false;
      composerActiveUntil = 0;
      if (!(composerSurface instanceof HTMLElement)) return;
      setAttributeIfChanged(composerSurface, "data-codex-theme-rainbow-composer", "attached");
      setAttributeIfChanged(composerSurface, "data-codex-theme-rainbow-active", "false");
      const canvas = markOwned(document.createElement("canvas"));
      canvas.className = "codex-theme-rainbow-canvas";
      canvas.setAttribute("aria-hidden", "true");
      canvas.setAttribute("data-effect", "surface-fill");
      composerSurface.appendChild(canvas);
      composerCanvas = canvas;
      diagnostics.composerCanvasCreates += 1;
      if (typeof ResizeObserver === "function") {
        composerResizeObserver = new ResizeObserver(() => {
          composerGeometryKey = "";
          if (composerActive) drawRainbowFrame(performance.now());
        });
        composerResizeObserver.observe(composerSurface);
      }
    }
    function drawRainbowFrame(timestamp) {
      if (!(composerCanvas instanceof HTMLCanvasElement) || !(composerSurface instanceof HTMLElement)) {
        return;
      }
      const canvasRect = composerCanvas.getBoundingClientRect();
      const surfaceRect = composerSurface.getBoundingClientRect();
      const cssWidth = canvasRect.width || surfaceRect.width;
      const cssHeight = canvasRect.height || surfaceRect.height;
      if (cssWidth < 2 || cssHeight < 2) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(cssWidth * pixelRatio);
      const pixelHeight = Math.round(cssHeight * pixelRatio);
      if (composerCanvas.width !== pixelWidth || composerCanvas.height !== pixelHeight) {
        composerCanvas.width = pixelWidth;
        composerCanvas.height = pixelHeight;
      }
      const context = composerCanvas.getContext("2d");
      if (context == null) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);
      const metricsKey = `${Math.round(cssWidth * 10)}x${Math.round(cssHeight * 10)}`;
      const segmentCount = Math.min(480, Math.max(180, Math.ceil(cssWidth / 3)));
      const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const duration = reducedMotion ? 8e3 : 2400;
      const phase = timestamp % duration / duration;
      const geometryKey = `${metricsKey}:${segmentCount}`;
      if (composerGeometryKey !== geometryKey) {
        composerGeometryKey = geometryKey;
        const bandWidth = cssWidth / segmentCount;
        composerSegments = Array.from({ length: segmentCount }, (_, index) => ({
          x: index * bandWidth,
          width: bandWidth + 1
        }));
      }
      for (let index = 0; index < composerSegments.length; index += 1) {
        const segment = composerSegments[index];
        const hue = ((index / segmentCount - phase) * 360 + 360) % 360;
        context.fillStyle = `hsl(${hue}deg 100% 58%)`;
        context.fillRect(segment.x, 0, segment.width, cssHeight);
      }
      setAttributeIfChanged(composerCanvas, "data-ready", "true");
      setAttributeIfChanged(composerCanvas, "data-pixel-ratio", String(pixelRatio));
      setAttributeIfChanged(composerCanvas, "data-segment-count", String(segmentCount));
    }
    function animateComposer(timestamp) {
      if (disposed || !composerActive || !(composerCanvas instanceof HTMLCanvasElement) || !composerCanvas.isConnected || !(composerSurface instanceof HTMLElement)) {
        composerAnimationFrame = 0;
        return;
      }
      if (timestamp - composerLastDrawTimestamp >= RAINBOW_FRAME_INTERVAL_MS) {
        drawRainbowFrame(timestamp);
        composerLastDrawTimestamp = timestamp;
      }
      composerAnimationFrame = requestAnimationFrame(animateComposer);
    }
    function startComposerAnimation() {
      if (composerAnimationFrame || !composerActive) return;
      composerLastDrawTimestamp = -Infinity;
      composerAnimationFrame = requestAnimationFrame(animateComposer);
    }
    function stopComposerAnimation() {
      if (composerAnimationFrame) cancelAnimationFrame(composerAnimationFrame);
      composerAnimationFrame = 0;
      composerLastDrawTimestamp = -Infinity;
    }
    function setComposerActive(active) {
      if (!(composerSurface instanceof HTMLElement)) active = false;
      if (composerActive === active) return;
      composerActive = active;
      if (composerSurface instanceof HTMLElement) {
        setAttributeIfChanged(
          composerSurface,
          "data-codex-theme-rainbow-active",
          active ? "true" : "false"
        );
      }
      if (active) startComposerAnimation();
      else stopComposerAnimation();
    }
    function findMainSurface() {
      const visibleSurfaces = (selector) => Array.from(document.querySelectorAll(selector)).filter((surface) => surface instanceof HTMLElement && isVisible(surface));
      const currentSurfaces = visibleSurfaces("[data-app-shell-main-surface]");
      const candidates = currentSurfaces.length > 0 ? currentSurfaces : visibleSurfaces('[class*="_MainContentSurface_"]');
      return candidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
      })[0] ?? null;
    }
    function setFireSurface(nextSurface) {
      if (fireSurface === nextSurface && fireSurface?.isConnected) {
        setAttributeIfChanged(fireSurface, "data-codex-theme-wallpaper-root", "true");
        return;
      }
      fireResizeObserver?.disconnect();
      fireResizeObserver = null;
      fireLayer?.remove();
      fireLayer = null;
      fireImages = [];
      if (fireSurface instanceof HTMLElement) {
        removeAttributeIfPresent(fireSurface, "data-codex-theme-wallpaper-root");
      }
      fireSurface = nextSurface instanceof HTMLElement ? nextSurface : null;
      if (!(fireSurface instanceof HTMLElement)) return;
      setAttributeIfChanged(fireSurface, "data-codex-theme-wallpaper-root", "true");
      if (typeof ResizeObserver === "function") {
        fireResizeObserver = new ResizeObserver(scheduleFireGeometry);
        fireResizeObserver.observe(fireSurface);
      }
      if (fireActive) {
        ensureFireLayer();
        scheduleFireGeometry();
      }
    }
    function ensureFireLayer() {
      if (!(fireSurface instanceof HTMLElement) || fireLayer?.isConnected && fireImages.length === THUMB_FIRE_POINTS.length && fireImages.every((fire) => fire.image.isConnected)) {
        return;
      }
      fireLayer?.remove();
      const layer = markOwned(document.createElement("div"));
      layer.className = "codex-theme-thumb-fire-layer";
      layer.setAttribute("aria-hidden", "true");
      fireSurface.prepend(layer);
      fireLayer = layer;
      fireImages = THUMB_FIRE_POINTS.map((point) => {
        const image = markOwned(document.createElement("img"));
        image.className = "codex-theme-thumb-fire";
        image.dataset.side = point.side;
        image.alt = "";
        image.draggable = false;
        image.decoding = "async";
        image.setAttribute("aria-hidden", "true");
        image.addEventListener("load", () => {
          setAttributeIfChanged(image, "data-ready", "true");
          scheduleFireGeometry();
        });
        image.src = config.fireDataUrl || "";
        if (image.complete && image.naturalWidth > 0) {
          setAttributeIfChanged(image, "data-ready", "true");
        }
        layer.appendChild(image);
        return { image, point, scaleX: 1, scaleY: 1 };
      });
      diagnostics.fireLayerCreates += 1;
    }
    function updateFireAsset() {
      for (const fire of fireImages) {
        if (fire.image.src === config.fireDataUrl) continue;
        removeAttributeIfPresent(fire.image, "data-ready");
        fire.image.src = config.fireDataUrl || "";
      }
    }
    function scheduleFireGeometry() {
      if (disposed || fireGeometryFrame) return;
      fireGeometryFrame = requestAnimationFrame(() => {
        fireGeometryFrame = 0;
        positionFireImages();
      });
    }
    function positionFireImages() {
      if (!(fireSurface instanceof HTMLElement) || !(fireLayer instanceof HTMLElement) || !isVisible(fireSurface)) {
        return false;
      }
      const surfaceRect = fireSurface.getBoundingClientRect();
      const scale = Math.max(
        surfaceRect.width / WALLPAPER_IMAGE_WIDTH,
        surfaceRect.height / WALLPAPER_IMAGE_HEIGHT
      );
      const imageWidth = WALLPAPER_IMAGE_WIDTH * scale;
      const imageHeight = WALLPAPER_IMAGE_HEIGHT * scale;
      const imageOffsetX = (surfaceRect.width - imageWidth) / 2;
      const imageOffsetY = (surfaceRect.height - imageHeight) / 2;
      const baseWidth = Math.max(72, Math.min(112, 160 * scale));
      const baseHeight = Math.max(118, Math.min(180, 255 * scale));
      const elapsedMs = fireActive && fireActiveStartedAt > 0 ? Math.max(0, Date.now() - fireActiveStartedAt) : 0;
      const growthStepCount = Math.max(1, Math.round(THUMB_FIRE_GROWTH_DURATION_MS / 1e3));
      const growthStep = Math.min(growthStepCount, Math.floor(elapsedMs / 1e3));
      const growthProgress = growthStep / growthStepCount;
      const easedGrowth = Math.pow(growthProgress, 0.72);
      const secondPhase = elapsedMs % 1e3 / 1e3;
      const secondPulse = Math.sin(secondPhase * Math.PI);
      const pulseScaleX = 1 + secondPulse * (0.035 + growthProgress * 0.075);
      const pulseScaleY = 1 + secondPulse * (0.025 + growthProgress * 0.055);
      const previousCanvasWidth = baseWidth * 2;
      const previousCanvasHeight = baseHeight * 2.35;
      const maximumScaleX = Math.max(1, surfaceRect.width * 0.9 / previousCanvasWidth);
      const maximumScaleY = Math.max(1, surfaceRect.height * 1.12 / previousCanvasHeight);
      const transformScaleX = (1 + easedGrowth) * (1 + easedGrowth * (maximumScaleX - 1)) * pulseScaleX;
      const transformScaleY = (1 + easedGrowth * 1.35) * (1 + easedGrowth * (maximumScaleY - 1)) * pulseScaleY;
      for (const fire of fireImages) {
        const anchorX = imageOffsetX + fire.point.x * scale;
        const anchorY = imageOffsetY + fire.point.y * scale;
        setStylePropertyIfChanged(
          fire.image,
          "left",
          `${Math.round((anchorX - baseWidth / 2) * 10) / 10}px`
        );
        setStylePropertyIfChanged(
          fire.image,
          "top",
          `${Math.round((anchorY - baseHeight) * 10) / 10}px`
        );
        setStylePropertyIfChanged(fire.image, "width", `${Math.round(baseWidth * 10) / 10}px`);
        setStylePropertyIfChanged(fire.image, "height", `${Math.round(baseHeight * 10) / 10}px`);
        setStylePropertyIfChanged(
          fire.image,
          "--codex-theme-fire-scale-x",
          String(transformScaleX)
        );
        setStylePropertyIfChanged(
          fire.image,
          "--codex-theme-fire-scale-y",
          String(transformScaleY)
        );
        fire.scaleX = transformScaleX;
        fire.scaleY = transformScaleY;
      }
      return true;
    }
    function startFireTimer() {
      if (fireTimer) return;
      fireTimer = setInterval(scheduleFireGeometry, FIRE_FRAME_INTERVAL_MS);
    }
    function stopFireTimer() {
      if (fireTimer) clearInterval(fireTimer);
      fireTimer = 0;
    }
    function currentSessionIdentity() {
      const threadRows = Array.from(document.querySelectorAll(
        "[data-app-action-sidebar-thread-row]"
      )).filter((row) => row instanceof HTMLElement);
      const currentThread = threadRows.find(
        (row) => row.dataset.appActionSidebarThreadActive === "true"
      ) || threadRows.find((row) => row.getAttribute("aria-current") === "page");
      if (currentThread instanceof HTMLElement) {
        const threadId = currentThread.dataset.appActionSidebarThreadId;
        const projectList = currentThread.closest("[data-app-action-sidebar-project-list-id]");
        const projectId2 = projectList instanceof HTMLElement ? projectList.dataset.appActionSidebarProjectListId : null;
        if (threadId) {
          return { key: `thread:${threadId}`, fallbackKey: projectId2 ? `project:${projectId2}` : null };
        }
      }
      const projectRows = Array.from(document.querySelectorAll(
        "[data-app-action-sidebar-project-row]"
      )).filter((row) => row instanceof HTMLElement);
      const currentProject = projectRows.find((row) => row.getAttribute("aria-current") === "page");
      const projectId = currentProject?.dataset.appActionSidebarProjectId;
      if (projectId) return { key: `project:${projectId}`, fallbackKey: null };
      return { key: "view:unkeyed", fallbackKey: null };
    }
    function pruneSessionStarts() {
      const entries = Object.entries(sessionStarts).filter((entry) => Number.isFinite(entry[1])).sort((left, right) => right[1] - left[1]);
      for (const [key] of entries.slice(32)) delete sessionStarts[key];
    }
    function setFireActive(active, identity) {
      const sessionKey = identity?.key || "view:unkeyed";
      if (active) {
        if (!(fireSurface instanceof HTMLElement) || !fireSurface.isConnected) {
          setFireSurface(findMainSurface());
        }
        if (!(fireSurface instanceof HTMLElement)) return;
        let startedAt = sessionStarts[sessionKey];
        if (!Number.isFinite(startedAt) && identity?.fallbackKey) {
          startedAt = sessionStarts[identity.fallbackKey];
        }
        if (!Number.isFinite(startedAt)) startedAt = Date.now();
        sessionStarts[sessionKey] = startedAt;
        pruneSessionStarts();
        fireCurrentSessionKey = sessionKey;
        fireActiveStartedAt = startedAt;
        fireActive = true;
        ensureFireLayer();
        for (const fire of fireImages) {
          setAttributeIfChanged(fire.image, "data-active", "true");
        }
        startFireTimer();
        scheduleFireGeometry();
        return;
      }
      if (identity?.key) delete sessionStarts[identity.key];
      if (!fireActive) return;
      fireActive = false;
      fireActiveStartedAt = 0;
      fireCurrentSessionKey = null;
      for (const fire of fireImages) removeAttributeIfPresent(fire.image, "data-active");
      stopFireTimer();
    }
    function rowHasActiveSessionIndicator(row) {
      return row.querySelector('[aria-label="Subscribed: active"]') != null || Array.from(row.querySelectorAll('.animate-spin, [style*="animation-duration"]')).some((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const duration = element.style.animationDuration;
        const statusContainer = element.parentElement;
        return element.querySelector("svg") != null && (duration === "2000ms" || element.classList.contains("animate-spin") && statusContainer?.classList.contains("text-token-foreground/70") === true);
      });
    }
    function activeSidebarSessionRows() {
      const seenThreadIds = /* @__PURE__ */ new Set();
      return Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-row]")).filter((row) => {
        if (!(row instanceof HTMLElement) || !rowHasActiveSessionIndicator(row)) return false;
        const threadId = row.dataset.appActionSidebarThreadId;
        if (!threadId) return true;
        if (seenThreadIds.has(threadId)) return false;
        seenThreadIds.add(threadId);
        return true;
      });
    }
    function activeCollapsedProjectRows() {
      const seenProjectIds = /* @__PURE__ */ new Set();
      return Array.from(document.querySelectorAll(
        '[data-app-action-sidebar-project-row][data-app-action-sidebar-project-collapsed="true"]'
      )).filter((row) => {
        if (!(row instanceof HTMLElement) || !rowHasActiveSessionIndicator(row)) return false;
        const projectId = row.dataset.appActionSidebarProjectId;
        if (!projectId) return true;
        if (seenProjectIds.has(projectId)) return false;
        seenProjectIds.add(projectId);
        return true;
      });
    }
    function retainActiveSessions(activeThreadRows, activeProjectRows) {
      const now = Date.now();
      const activeThreadIds = /* @__PURE__ */ new Set();
      for (const row of activeThreadRows) {
        const threadId = row.dataset.appActionSidebarThreadId;
        if (!threadId) continue;
        activeThreadIds.add(threadId);
        const threadKey = `thread:${threadId}`;
        const projectList = row.closest("[data-app-action-sidebar-project-list-id]");
        const projectId = projectList instanceof HTMLElement ? projectList.dataset.appActionSidebarProjectListId : null;
        const projectKey = projectId ? `project:${projectId}` : null;
        const inheritedStart = Number.isFinite(sessionStarts[threadKey]) ? sessionStarts[threadKey] : projectKey && Number.isFinite(sessionStarts[projectKey]) ? sessionStarts[projectKey] : now;
        sessionStarts[threadKey] = inheritedStart;
        if (projectKey && !Number.isFinite(sessionStarts[projectKey])) {
          sessionStarts[projectKey] = inheritedStart;
        }
      }
      for (const row of activeProjectRows) {
        const projectId = row.dataset.appActionSidebarProjectId;
        if (!projectId) continue;
        const projectKey = `project:${projectId}`;
        if (!Number.isFinite(sessionStarts[projectKey])) sessionStarts[projectKey] = now;
      }
      for (const row of document.querySelectorAll("[data-app-action-sidebar-thread-row]")) {
        if (!(row instanceof HTMLElement)) continue;
        const threadId = row.dataset.appActionSidebarThreadId;
        if (threadId && !activeThreadIds.has(threadId) && row.dataset.appActionSidebarThreadActive !== "true") {
          delete sessionStarts[`thread:${threadId}`];
        }
      }
      pruneSessionStarts();
    }
    function setUsageActivity(active) {
      const value = active ? "true" : "false";
      if (document.documentElement.dataset.codexThemeSessionActive !== value) {
        document.documentElement.dataset.codexThemeSessionActive = value;
      }
    }
    function evaluateActivity() {
      if (disposed || !document.documentElement) return;
      diagnostics.activityChecks += 1;
      const nextComposerSurface = findComposerSurface();
      if (nextComposerSurface !== composerSurface) setComposerSurface(nextComposerSurface);
      if (!(fireSurface instanceof HTMLElement) || !fireSurface.isConnected) {
        setFireSurface(findMainSurface());
      }
      const now = performance.now();
      const detectedComposerActive = composerIsActive(composerSurface);
      if (detectedComposerActive) composerActiveUntil = now + RAINBOW_ACTIVE_GRACE_MS;
      const currentComposerActive = detectedComposerActive || composerSurface instanceof HTMLElement && now < composerActiveUntil;
      setComposerActive(currentComposerActive);
      const activeThreadRows = activeSidebarSessionRows();
      const activeProjectRows = activeCollapsedProjectRows();
      retainActiveSessions(activeThreadRows, activeProjectRows);
      const sidebarActive = activeThreadRows.length > 0;
      const collapsedProjectActive = activeProjectRows.length > 0;
      const detectedUsageActive = currentComposerActive || sidebarActive || collapsedProjectActive;
      if (detectedUsageActive) usageActivityActiveUntil = now + USAGE_ACTIVITY_GRACE_MS;
      const usageActive = detectedUsageActive || now < usageActivityActiveUntil;
      setUsageActivity(usageActive);
      const identity = currentSessionIdentity();
      const currentIdentityIsActive = activeThreadRows.some((row) => identity.key === `thread:${row.dataset.appActionSidebarThreadId}`) || activeProjectRows.some((row) => identity.key === `project:${row.dataset.appActionSidebarProjectId}`);
      setFireActive(currentComposerActive || currentIdentityIsActive, identity);
      activityState = {
        currentComposerActive,
        sidebarActive,
        sidebarActiveCount: activeThreadRows.length,
        sidebarThreadIds: activeThreadRows.map((row) => row.dataset.appActionSidebarThreadId || null).filter(Boolean),
        collapsedProjectActive,
        collapsedProjectActiveCount: activeProjectRows.length,
        collapsedProjectIds: activeProjectRows.map((row) => row.dataset.appActionSidebarProjectId || null).filter(Boolean),
        active: usageActive
      };
    }
    function reconcileStructure() {
      if (disposed || !document.documentElement) return;
      diagnostics.structureReconciles += 1;
      ensureStyle();
      renderUsagePanel();
      renderChatQuickChatButton();
      renderServerLatencies();
      const nextComposerSurface = findComposerSurface();
      if (nextComposerSurface !== composerSurface) setComposerSurface(nextComposerSurface);
      const nextFireSurface = findMainSurface();
      if (nextFireSurface !== fireSurface) setFireSurface(nextFireSurface);
      scheduleWorkModeEnhancements();
      scheduleActivity("structure");
    }
    function scheduleStructure() {
      if (disposed || structureFrame) return;
      structureFrame = requestAnimationFrame(() => {
        structureFrame = 0;
        reconcileStructure();
      });
    }
    function scheduleActivity() {
      if (disposed || activityFrame) return;
      activityFrame = requestAnimationFrame(() => {
        activityFrame = 0;
        evaluateActivity();
      });
    }
    function changedNodesAreOwned(record) {
      const changed = [...record.addedNodes, ...record.removedNodes];
      return changed.length > 0 && changed.every(isOwnedNode);
    }
    function nodeTouchesRelevantStructure(node) {
      const element = node instanceof Element ? node : node?.parentElement;
      if (!(element instanceof Element) || isOwnedNode(element)) return false;
      return element.matches(RELEVANT_STRUCTURE_SELECTOR) || element.querySelector(RELEVANT_STRUCTURE_SELECTOR) != null;
    }
    function classifyMutation(record) {
      if (isOwnedNode(record.target)) return { structure: false, activity: false };
      const target = record.target instanceof Element ? record.target : record.target?.parentElement;
      if (record.type === "attributes") {
        if (!(target instanceof Element)) return { structure: false, activity: false };
        const inSidebar = target.closest(".app-shell-left-panel") != null;
        const inComposer = composerSurface instanceof HTMLElement && composerSurface.contains(target);
        return { structure: false, activity: inSidebar || inComposer };
      }
      if (record.type !== "childList" || changedNodesAreOwned(record)) {
        return { structure: false, activity: false };
      }
      if (target instanceof Element && target.closest(".app-shell-left-panel")) {
        return { structure: true, activity: true };
      }
      if (target instanceof Element && composerSurface instanceof HTMLElement && (composerSurface.contains(target) || target.contains(composerSurface))) {
        return { structure: false, activity: true };
      }
      const changed = [...record.addedNodes, ...record.removedNodes];
      const structure = changed.some(nodeTouchesRelevantStructure);
      return { structure, activity: structure };
    }
    function installObserver() {
      observer?.disconnect();
      observer = new MutationObserver((records) => {
        diagnostics.observerCallbacks += 1;
        let structure = false;
        let activity = false;
        for (const record of records) {
          const classification = classifyMutation(record);
          structure ||= classification.structure;
          activity ||= classification.activity;
          if (structure && activity) break;
        }
        if (!structure && !activity) diagnostics.ignoredObserverCallbacks += 1;
        if (structure) scheduleStructure("mutation");
        if (activity) scheduleActivity("mutation");
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-busy", "aria-label", "data-state", "data-status", "data-testid"]
      });
    }
    function applyConfig(nextConfig) {
      if (nextConfig && typeof nextConfig === "object") config = { ...config, ...nextConfig };
      ensureStyle();
      updateFireAsset();
    }
    function install(nextConfig) {
      diagnostics.evaluations += 1;
      if (disposed) return { installed: false, disposed: true };
      applyConfig(nextConfig);
      if (document.documentElement) {
        document.documentElement.dataset.codexThemeWallpaper = "enabled";
      }
      if (!installed) {
        installed = true;
        diagnostics.installs += 1;
        if (document.documentElement) installObserver();
        activityTimer = setInterval(scheduleActivity, ACTIVITY_REFRESH_MS);
        if (config.usageManagedByHost !== true) {
          usageTimer = setInterval(refreshUsage, USAGE_REFRESH_MS);
        }
        chatTurnDiffTimer = setInterval(
          scheduleWorkModeEnhancements,
          CHAT_TURN_DIFF_REFRESH_MS
        );
        if (document.readyState === "loading") {
          domReadyHandler = () => {
            if (document.documentElement) {
              document.documentElement.dataset.codexThemeWallpaper = "enabled";
              if (!observer) installObserver();
            }
            refresh("dom-ready");
          };
          document.addEventListener("DOMContentLoaded", domReadyHandler, { once: true });
        }
        if (config.usageManagedByHost !== true) void refreshUsage();
      }
      refresh("install");
      return {
        installed: true,
        imageBytes: Number(config.imageBytes) || 0,
        title: document.title,
        url: location.href,
        runtime: inspect()
      };
    }
    function updateState(nextState) {
      if (disposed || nextState == null || typeof nextState !== "object") return false;
      let changed = false;
      if (Object.prototype.hasOwnProperty.call(nextState, "usage") && nextState.usage != null && !usageEqual(uiState.usage, nextState.usage)) {
        uiState.usage = nextState.usage;
        uiState.usageError = null;
        try {
          localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(nextState.usage));
        } catch {
        }
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(nextState, "latencies") && !shallowEqualObject(uiState.latencies, nextState.latencies || {})) {
        uiState.latencies = { ...nextState.latencies || {} };
        changed = true;
      }
      if (changed) {
        diagnostics.stateUpdates += 1;
        scheduleStructure("state");
      }
      return changed;
    }
    function refresh() {
      if (disposed) return false;
      diagnostics.refreshes += 1;
      scheduleStructure("refresh");
      scheduleActivity("refresh");
      return true;
    }
    function inspect() {
      const fill = document.querySelector(
        `#${USAGE_PANEL_ID} .codex-theme-usage-fill`
      );
      const canvas = composerCanvas;
      return {
        version: runtime2.version,
        installed,
        disposed,
        diagnostics: { ...diagnostics },
        resources: {
          observer: observer != null,
          activityTimer: activityTimer !== 0,
          usageTimer: usageTimer !== 0,
          chatTurnDiffTimer: chatTurnDiffTimer !== 0,
          composerAnimationFrame: composerAnimationFrame !== 0,
          fireTimer: fireTimer !== 0
        },
        nodes: {
          usagePanels: document.querySelectorAll(`#${USAGE_PANEL_ID}`).length,
          chatQuickChatButtons: document.querySelectorAll(`#${QUICK_CHAT_BUTTON_ID}`).length,
          composerCanvases: document.querySelectorAll(".codex-theme-rainbow-canvas").length,
          fireLayers: document.querySelectorAll(".codex-theme-thumb-fire-layer").length,
          fireImages: document.querySelectorAll(".codex-theme-thumb-fire").length,
          serverSignals: document.querySelectorAll(".codex-theme-server-signal").length,
          chatTurnDiffCards: document.querySelectorAll(
            '[data-codex-theme-native-turn-diff="true"]'
          ).length,
          nativeTurnDiffCards: nativeTurnDiffRoots.size,
          workCommandSummaries: workCommandSummaryNodes.size,
          workTechnicalDetails: workTechnicalDetailNodes.size
        },
        nativeTurnDiff: {
          loaded: nativeTurnDiffRuntime != null,
          loading: nativeTurnDiffRuntimePromise != null && nativeTurnDiffRuntime == null,
          lastError: nativeTurnDiffLastError
        },
        quickChat: {
          handlerCaptured: typeof quickChatHandler === "function",
          bridgeLoaded: quickChatRuntime != null,
          bridgeLoading: quickChatRuntimePromise != null && quickChatRuntime == null,
          liveStoreFound: quickChatStoreFromFiberTree() != null,
          lastError: quickChatLastError,
          label: quickChatLabel || null,
          primaryLabel: quickChatPrimaryLabel || null
        },
        usage: {
          value: uiState.usage,
          clipRight: fill instanceof HTMLElement ? fill.style.getPropertyValue("--codex-theme-usage-clip-right") : null,
          layoutWidth: fill instanceof HTMLElement ? fill.style.width : null
        },
        activity: activityState,
        composer: {
          attached: composerSurface instanceof HTMLElement && composerSurface.isConnected,
          active: composerActive,
          ready: canvas?.dataset.ready === "true",
          segmentCount: Number(canvas?.dataset.segmentCount) || 0
        },
        fire: {
          attached: fireLayer instanceof HTMLElement && fireLayer.isConnected,
          active: fireActive,
          sessionKey: fireCurrentSessionKey,
          elapsedMs: fireActiveStartedAt > 0 ? Math.max(0, Date.now() - fireActiveStartedAt) : 0,
          retainedSessionCount: Object.keys(sessionStarts).length
        }
      };
    }
    function dispose({ preserveStyle = false } = {}) {
      if (disposed) {
        return { usage: uiState.usage, latencies: uiState.latencies, sessionStarts };
      }
      disposed = true;
      observer?.disconnect();
      observer = null;
      if (activityTimer) clearInterval(activityTimer);
      if (usageTimer) clearInterval(usageTimer);
      if (chatTurnDiffTimer) clearInterval(chatTurnDiffTimer);
      activityTimer = 0;
      usageTimer = 0;
      chatTurnDiffTimer = 0;
      if (structureFrame) cancelAnimationFrame(structureFrame);
      if (activityFrame) cancelAnimationFrame(activityFrame);
      if (fireGeometryFrame) cancelAnimationFrame(fireGeometryFrame);
      structureFrame = 0;
      activityFrame = 0;
      fireGeometryFrame = 0;
      stopComposerAnimation();
      stopFireTimer();
      composerResizeObserver?.disconnect();
      fireResizeObserver?.disconnect();
      composerResizeObserver = null;
      fireResizeObserver = null;
      if (domReadyHandler) document.removeEventListener("DOMContentLoaded", domReadyHandler);
      domReadyHandler = null;
      for (const [key, record] of nativeTurnDiffRoots) {
        removeNativeTurnDiffRoot(key, record);
      }
      for (const [node] of workCommandSummaryNodes) {
        restoreWorkCommandSummary(node);
      }
      workCommandSummaryNodes.clear();
      for (const record of workTechnicalDetailNodes.values()) record.node.remove();
      workTechnicalDetailNodes.clear();
      nativeTurnDiffRuntime = null;
      nativeTurnDiffRuntimePromise = null;
      nativeTurnDiffRenderInFlight = false;
      nativeTurnDiffRenderRequested = false;
      document.getElementById(QUICK_CHAT_BUTTON_ID)?.remove();
      quickChatHandler = null;
      quickChatTemplate = null;
      quickChatLabel = "";
      quickChatPrimaryLabel = "";
      quickChatRowClassName = "";
      quickChatRuntime = null;
      quickChatRuntimePromise = null;
      quickChatLastError = null;
      if (composerSurface instanceof HTMLElement) {
        removeAttributeIfPresent(composerSurface, "data-codex-theme-rainbow-composer");
        removeAttributeIfPresent(composerSurface, "data-codex-theme-rainbow-active");
      }
      composerCanvas?.remove();
      fireLayer?.remove();
      if (fireSurface instanceof HTMLElement) {
        removeAttributeIfPresent(fireSurface, "data-codex-theme-wallpaper-root");
      }
      document.getElementById(USAGE_PANEL_ID)?.remove();
      for (const card of document.querySelectorAll(".codex-theme-chat-turn-diff")) card.remove();
      for (const container of document.querySelectorAll(
        '[data-codex-theme-native-turn-diff="true"]'
      )) {
        container.remove();
      }
      for (const signal of document.querySelectorAll(".codex-theme-server-signal")) signal.remove();
      for (const nativeStatus of document.querySelectorAll(
        '[data-codex-theme-native-server-status="true"]'
      )) {
        removeAttributeIfPresent(nativeStatus, "data-codex-theme-native-server-status");
      }
      removeAttributeIfPresent(document.documentElement, "data-codex-theme-session-active");
      if (!preserveStyle) {
        document.getElementById(STYLE_ID)?.remove();
        removeAttributeIfPresent(document.documentElement, "data-codex-theme-wallpaper");
      }
      if (globalThis[RUNTIME_KEY] === runtime2) delete globalThis[RUNTIME_KEY];
      return { usage: uiState.usage, latencies: uiState.latencies, sessionStarts };
    }
  }
}

// Codex_to_Work/src/page/styles.mjs
function createThemeCss(imageDataUrl) {
  return `
:root {
  --codex-chat-secondary: rgb(250 251 250 / 80%);
  --codex-chat-input: rgb(255 255 255 / 86%);
  --codex-chat-dropdown: rgb(255 255 255 / 94%);
  --codex-chat-code: rgb(246 248 248 / 90%);
}

:root:is(.dark, .electron-dark) {
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
    .pointer-events-none.absolute.inset-x-0.bottom-0.z-0.h-full.bg-gradient-to-t.from-surface.via-surface
  ) {
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

#codex-theme-usage-panel {
  box-sizing: border-box;
  width: 100%;
  flex: none;
  margin: 0;
  padding: 9px var(--padding-row-x, 14px) 8px;
  border-top: 0.5px solid var(--color-border, rgb(127 127 127 / 18%));
  color: var(--color-text-secondary, var(--color-token-description-foreground));
}

#codex-theme-usage-panel .codex-theme-usage-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

#codex-theme-usage-panel :is(.codex-theme-usage-value, .codex-theme-usage-reset) {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#codex-theme-usage-panel .codex-theme-usage-value {
  flex: 0 1 auto;
}

#codex-theme-usage-panel .codex-theme-usage-reset {
  flex: 0 1 auto;
  text-align: right;
}

#codex-theme-usage-panel .codex-theme-usage-track {
  position: relative;
  height: 3px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(127 127 127 / 22%);
  contain: paint;
}

#codex-theme-usage-panel .codex-theme-usage-fill {
  --codex-theme-usage-clip-right: 100%;
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  background: currentColor;
  clip-path: inset(0 var(--codex-theme-usage-clip-right) 0 0 round 999px);
  opacity: 0.72;
  transition: clip-path 180ms ease, opacity 240ms ease;
  will-change: clip-path;
}

:root[data-codex-theme-session-active="true"] #codex-theme-usage-panel .codex-theme-usage-fill {
  opacity: 1;
}

#codex-theme-usage-panel .codex-theme-usage-fill::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 250%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    hsl(0deg 100% 60%) 0%,
    hsl(60deg 100% 60%) 8.333%,
    hsl(120deg 100% 60%) 16.667%,
    hsl(180deg 100% 60%) 25%,
    hsl(240deg 100% 60%) 33.333%,
    hsl(300deg 100% 60%) 41.667%,
    hsl(360deg 100% 60%) 50%,
    hsl(60deg 100% 60%) 58.333%,
    hsl(120deg 100% 60%) 66.667%,
    hsl(180deg 100% 60%) 75%,
    hsl(240deg 100% 60%) 83.333%,
    hsl(300deg 100% 60%) 91.667%,
    hsl(360deg 100% 60%) 100%
  );
  content: "";
  opacity: 0;
  transform: translate3d(0, 0, 0);
  animation: codex-theme-usage-rainbow 3s linear infinite;
  animation-play-state: paused;
  transition: opacity 240ms ease;
  will-change: transform;
}

:root[data-codex-theme-session-active="true"] #codex-theme-usage-panel .codex-theme-usage-fill::before {
  opacity: 1;
  animation-play-state: running;
}

@keyframes codex-theme-usage-rainbow {
  to {
    transform: translate3d(-50%, 0, 0);
  }
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

/* Match the native Codex turn rhythm above file-review cards in Chat/Work. */
[data-codex-theme-native-turn-diff="true"] {
  margin-block-start: 20px;
  margin-inline: 0;
}

.codex-theme-work-details {
  box-sizing: border-box;
  margin: 10px 0 2px;
  overflow: clip;
  border: 0.5px solid var(--color-border, rgb(127 127 127 / 22%));
  border-radius: 10px;
  background: var(--color-background-secondary-soft-alpha, var(--codex-chat-code));
  color: var(--color-text-primary, inherit);
}

.codex-theme-work-details > summary {
  display: flex;
  min-height: 38px;
  box-sizing: border-box;
  cursor: pointer;
  list-style: none;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  user-select: none;
}

.codex-theme-work-details > summary::-webkit-details-marker {
  display: none;
}

.codex-theme-work-details > summary::before {
  width: 12px;
  flex: none;
  color: var(--color-text-secondary, var(--color-token-description-foreground));
  content: "›";
  font-size: 17px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform 120ms ease;
}

.codex-theme-work-details[open] > summary::before {
  transform: rotate(90deg);
}

.codex-theme-work-details-title {
  min-width: 0;
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
}

.codex-theme-work-details-meta {
  flex: none;
  color: var(--color-text-secondary, var(--color-token-description-foreground));
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1.35;
}

.codex-theme-work-details-body {
  display: grid;
  gap: 12px;
  padding: 0 11px 11px 31px;
}

.codex-theme-work-details-section {
  min-width: 0;
}

.codex-theme-work-details-section h4 {
  margin: 0 0 5px;
  color: var(--color-text-secondary, var(--color-token-description-foreground));
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
}

:is(.codex-theme-work-details-row, .codex-theme-work-details-code) {
  box-sizing: border-box;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.codex-theme-work-details-row + .codex-theme-work-details-row,
.codex-theme-work-details-code + .codex-theme-work-details-code {
  margin-top: 4px;
}

.codex-theme-work-details-code {
  overflow-x: auto;
  border-radius: 6px;
  background: var(--color-codex-editor-inline-code-background, var(--codex-chat-code));
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  padding: 6px 8px;
}

.codex-theme-server-signal {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: none;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  color: rgb(54 204 134);
  transition: color 180ms ease, opacity 180ms ease;
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

@media (prefers-reduced-motion: reduce) {
  #codex-theme-usage-panel .codex-theme-usage-fill::before {
    animation-duration: 10s;
  }
}
`;
}

// Codex_to_Work/src/page/source.mjs
var PAGE_RUNTIME_VERSION = 24;
function createPageSource(imageDataUrl, fireDataUrl, { rainbowPreview = false, usageManagedByHost = false } = {}) {
  const config = {
    version: PAGE_RUNTIME_VERSION,
    css: createThemeCss(imageDataUrl),
    fireDataUrl,
    rainbowPreview,
    usageManagedByHost,
    imageBytes: Buffer.byteLength(imageDataUrl, "utf8")
  };
  return `(${installPageRuntime.toString()})(${JSON.stringify(config)})`;
}

// Codex_to_Work/src/main.mjs
var scriptDirectory = path2.dirname(fileURLToPath(import.meta.url));
var projectPath = path2.basename(scriptDirectory) === "src" ? path2.dirname(scriptDirectory) : scriptDirectory;
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
  const codexExecutable = path2.resolve(
    path2.dirname(appExecutable),
    "..",
    "Resources",
    "codex"
  );
  const usageClient = fs2.existsSync(codexExecutable) ? new AppServerRateLimitClient(codexExecutable) : null;
  console.log(`[wallpaper] 사진: ${options.imagePath}`);
  console.log(`[wallpaper] 불꽃: ${options.firePath}`);
  console.log(`[wallpaper] 앱: ${appExecutable}`);
  console.log(`[wallpaper] 전용 프로필: ${options.profilePath}`);
  if (options.dryRun) {
    console.log("[wallpaper] 검사 완료. 앱은 실행하지 않았습니다.");
    return;
  }
  fs2.mkdirSync(options.profilePath, { recursive: true, mode: 448 });
  const usageCachePath = path2.join(options.profilePath, "codex-theme-usage.json");
  const pinnedSshHosts = parsePinnedSshHosts(SSH_CONFIG_PATH);
  const source = createPageSource(assetDataUrl(options.imagePath), assetDataUrl(options.firePath), {
    rainbowPreview: options.inspectUi,
    usageManagedByHost: usageClient != null
  });
  const childEnvironment = { ...process.env };
  if (options.skipRemoteSshBoot) childEnvironment.CODEX_SSH_SKIP_APP_SERVER_BOOT = "true";
  const child = spawn2(
    appExecutable,
    [
      "--remote-debugging-pipe",
      `--user-data-dir=${options.profilePath}`,
      "--no-first-run"
    ],
    {
      env: childEnvironment,
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"]
    }
  );
  let latencyTimer = 0;
  let usageTimer = 0;
  let usageRefreshInFlight = null;
  let appServerUsageAvailable = false;
  let lastUsageError = null;
  let controller = null;
  const terminate = () => {
    if (latencyTimer) clearInterval(latencyTimer);
    if (usageTimer) clearInterval(usageTimer);
    latencyTimer = 0;
    usageTimer = 0;
    usageClient?.close();
    controller?.dispose();
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  process.once("exit", terminate);
  child.once("error", (error) => {
    console.error("[wallpaper] 앱을 실행하지 못했습니다:", error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    controller?.dispose();
    if (latencyTimer) clearInterval(latencyTimer);
    if (usageTimer) clearInterval(usageTimer);
    usageClient?.close();
    if (signal) console.log(`[wallpaper] Codex가 ${signal} 신호로 종료되었습니다.`);
    else console.log(`[wallpaper] Codex가 종료되었습니다. 코드=${code ?? "unknown"}`);
    process.exit(code ?? 0);
  });
  const cdp = new CdpPipe(child);
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
    if (!controller) return;
    await Promise.allSettled(controller.sessionIds().map(pushUiState));
  };
  const refreshAccountUsage = async () => {
    if (usageClient == null || usageRefreshInFlight != null) return usageRefreshInFlight;
    usageRefreshInFlight = (async () => {
      try {
        const usage = await usageClient.read();
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
    if (!options.screenshotPath || screenshotCaptured) return;
    screenshotCaptured = true;
    const screenshot = await cdp.send(
      "Page.captureScreenshot",
      { format: "png", fromSurface: true },
      sessionId
    );
    fs2.mkdirSync(path2.dirname(options.screenshotPath), { recursive: true });
    fs2.writeFileSync(options.screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.log(`[wallpaper] 검증 화면 저장: ${options.screenshotPath}`);
    if (options.exitAfterScreenshot) setTimeout(terminate, 100);
  };
  const onReady = async ({ sessionId }) => {
    if (options.inspectUi || options.screenshotPath) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
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
  const refreshLatencies = async () => {
    latestLatencies = await measurePinnedSshLatencies(pinnedSshHosts);
    await broadcastUiState();
  };
  const captureUsageResponse = async (sessionId, requestId) => {
    if (appServerUsageAvailable) return;
    try {
      const responseBody = await cdp.send("Network.getResponseBody", { requestId }, sessionId);
      const body = responseBody.base64Encoded ? Buffer.from(responseBody.body, "base64").toString("utf8") : responseBody.body;
      const usage = normalizeUsagePayload(JSON.parse(body));
      if (usage == null) return;
      latestUsage = usage;
      writeUsageCache(usageCachePath, usage);
      console.log(`[wallpaper] 사용량 갱신: ${usage.remainingPercent}% 남음`);
      await broadcastUiState();
    } catch (error) {
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
  if (usageClient != null) {
    void refreshAccountUsage();
    usageTimer = setInterval(() => void refreshAccountUsage(), 60 * 1e3);
  }
  void refreshLatencies();
  latencyTimer = setInterval(() => void refreshLatencies(), LATENCY_REFRESH_MS);
  console.log("[wallpaper] 실행기를 닫으면 이 전용 Codex 인스턴스도 함께 종료됩니다.");
}
main().catch((error) => {
  console.error(`[wallpaper] ${error.message}`);
  process.exitCode = 1;
});
