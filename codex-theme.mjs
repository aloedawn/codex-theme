#!/usr/bin/env node

// src/main.mjs
import { spawn } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

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
    this.output.setEncoding("utf8");
    this.output.on("data", (chunk) => this.handleChunk(chunk));
    this.output.on("error", (error) => this.failAll(error));
    this.output.on("close", () => this.failAll(new Error("디버깅 파이프가 닫혔사옵니다.")));
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
        console.error("[wallpaper] CDP 메시지를 해석하지 못했사옵니다:", error.message);
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
        reject(new Error(`${method} 응답 시간이 초과되었사옵니다.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.input.write(`${JSON.stringify(message)}\0`);
    });
  }
};

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
      throw new Error(`알 수 없는 인자이옵니다: ${argument}`);
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
    throw new Error(`배경 사진이 없사옵니다: ${options.imagePath}`);
  }
  if (!fs.statSync(options.imagePath).isFile()) {
    throw new Error(`배경 경로가 파일이 아니옵니다: ${options.imagePath}`);
  }
  if (!fs.existsSync(options.firePath)) {
    throw new Error(`불꽃 GIF가 없사옵니다: ${options.firePath}`);
  }
  if (!fs.statSync(options.firePath).isFile()) {
    throw new Error(`불꽃 경로가 파일이 아니옵니다: ${options.firePath}`);
  }
  const imageExtension = path.extname(options.imagePath).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(imageExtension)) {
    throw new Error("배경은 JPEG 또는 PNG 파일이어야 하옵니다.");
  }
  if (path.extname(options.firePath).toLowerCase() !== ".gif") {
    throw new Error("불꽃은 GIF 파일이어야 하옵니다.");
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
  if (mimeType == null) throw new Error(`지원하지 않는 이미지 형식이옵니다: ${extension}`);
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
  const rateLimit = payload?.rate_limit;
  if (rateLimit == null || typeof rateLimit !== "object") return null;
  const windows = [rateLimit.primary_window, rateLimit.secondary_window].filter((window2) => window2 != null && Number.isFinite(Number(window2.used_percent))).map((window2) => ({
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
    console.error(`[wallpaper] 사용량 캐시를 저장하지 못했사옵니다: ${error.message}`);
  }
}

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
      if (!sessionId) throw new Error("CDP 세션 ID를 받지 못했사옵니다.");
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
        throw new Error(result.exceptionDetails.text ?? "주입 중 예외가 발생했사옵니다.");
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
        this.logger.error(`[wallpaper] 적용 후 진단에 실패했사옵니다: ${error.message}`);
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

// src/page/runtime.mjs
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
    const OWNED_ATTRIBUTE = "data-codex-theme-owned";
    const USAGE_CACHE_KEY = "codex-theme-usage-cache";
    const USAGE_REFRESH_MS = 60 * 1e3;
    const ACTIVITY_REFRESH_MS = 500;
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
    let structureFrame = 0;
    let activityFrame = 0;
    let usageFetchInFlight = null;
    let activityState = null;
    let usageActivityActiveUntil = 0;
    let composerSurface = null;
    let composerCanvas = null;
    let composerResizeObserver = null;
    let composerAnimationFrame = 0;
    let composerLastDrawTimestamp = -Infinity;
    let composerMetricsKey = "";
    let composerGeometryKey = "";
    let composerSegments = [];
    let composerRadius = 22;
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
      fireLayerCreates: 0
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
      const rateLimit = payload?.rate_limit;
      if (rateLimit == null || typeof rateLimit !== "object") return null;
      const windows = [rateLimit.primary_window, rateLimit.secondary_window].filter((window2) => window2 != null && Number.isFinite(Number(window2.used_percent))).map((window2) => ({
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
          reject(new Error("앱 요청 통로를 찾지 못했사옵니다"));
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
            finish(reject, new Error(message.error || "사용량 요청이 실패했사옵니다"));
            return;
          }
          try {
            finish(resolve, JSON.parse(message.bodyJsonString || "null"));
          } catch (error) {
            finish(reject, error);
          }
        };
        timeout = setTimeout(() => {
          finish(reject, new Error("사용량 요청 시간이 초과되었사옵니다"));
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
          if (usage == null) throw new Error("사용량 응답 형식이 올바르지 않사옵니다");
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
    function findProfileContext() {
      const panel = document.querySelector(".app-shell-left-panel");
      if (!(panel instanceof HTMLElement)) return null;
      const scroll = panel.querySelector("[data-app-action-sidebar-scroll]");
      const profileButtons = Array.from(panel.querySelectorAll("button.sidebar-item")).filter((button) => !scroll?.contains(button) && isVisible(button)).sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom);
      const profileButton = profileButtons[0];
      if (!(profileButton instanceof HTMLButtonElement)) return null;
      const footerRow = profileButton.closest(".h-toolbar");
      if (!(footerRow instanceof HTMLElement)) return null;
      return { footerRow, panel, profileButton, scroll };
    }
    function renderUsagePanel() {
      const context = findProfileContext();
      if (context == null) return;
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
        'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder]'
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
      composerMetricsKey = "";
      composerGeometryKey = "";
      composerSegments = [];
      composerRadius = 22;
      composerActive = false;
      composerActiveUntil = 0;
      if (!(composerSurface instanceof HTMLElement)) return;
      setAttributeIfChanged(composerSurface, "data-codex-theme-rainbow-composer", "attached");
      setAttributeIfChanged(composerSurface, "data-codex-theme-rainbow-active", "false");
      const canvas = markOwned(document.createElement("canvas"));
      canvas.className = "codex-theme-rainbow-canvas";
      canvas.setAttribute("aria-hidden", "true");
      composerSurface.appendChild(canvas);
      composerCanvas = canvas;
      diagnostics.composerCanvasCreates += 1;
      if (typeof ResizeObserver === "function") {
        composerResizeObserver = new ResizeObserver(() => {
          composerMetricsKey = "";
          composerGeometryKey = "";
          if (composerActive) drawRainbowFrame(performance.now());
        });
        composerResizeObserver.observe(composerSurface);
      }
    }
    function pointOnRoundedRect(distance, width, height, radius) {
      const horizontal = Math.max(0, width - radius * 2);
      const vertical = Math.max(0, height - radius * 2);
      const arc = Math.PI * radius / 2;
      const perimeter = horizontal * 2 + vertical * 2 + arc * 4;
      let cursor = (distance % perimeter + perimeter) % perimeter;
      if (cursor <= horizontal) return { x: radius + cursor, y: 0 };
      cursor -= horizontal;
      if (cursor <= arc) {
        const angle2 = -Math.PI / 2 + cursor / radius;
        return { x: width - radius + Math.cos(angle2) * radius, y: radius + Math.sin(angle2) * radius };
      }
      cursor -= arc;
      if (cursor <= vertical) return { x: width, y: radius + cursor };
      cursor -= vertical;
      if (cursor <= arc) {
        const angle2 = cursor / radius;
        return { x: width - radius + Math.cos(angle2) * radius, y: height - radius + Math.sin(angle2) * radius };
      }
      cursor -= arc;
      if (cursor <= horizontal) return { x: width - radius - cursor, y: height };
      cursor -= horizontal;
      if (cursor <= arc) {
        const angle2 = Math.PI / 2 + cursor / radius;
        return { x: radius + Math.cos(angle2) * radius, y: height - radius + Math.sin(angle2) * radius };
      }
      cursor -= arc;
      if (cursor <= vertical) return { x: 0, y: height - radius - cursor };
      cursor -= vertical;
      const angle = Math.PI + cursor / radius;
      return { x: radius + Math.cos(angle) * radius, y: radius + Math.sin(angle) * radius };
    }
    function drawRainbowFrame(timestamp) {
      if (!(composerCanvas instanceof HTMLCanvasElement) || !(composerSurface instanceof HTMLElement)) {
        return;
      }
      const canvasRect = composerCanvas.getBoundingClientRect();
      const surfaceRect = composerSurface.getBoundingClientRect();
      const cssWidth = canvasRect.width || surfaceRect.width + 6;
      const cssHeight = canvasRect.height || surfaceRect.height + 6;
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
      const inset = 3;
      const width = Math.max(1, cssWidth - inset * 2);
      const height = Math.max(1, cssHeight - inset * 2);
      const metricsKey = `${Math.round(cssWidth * 10)}x${Math.round(cssHeight * 10)}`;
      if (composerMetricsKey !== metricsKey) {
        const surfaceRadius = Number.parseFloat(getComputedStyle(composerSurface).borderRadius);
        composerRadius = Math.min(
          Math.max(Number.isFinite(surfaceRadius) && surfaceRadius >= 8 ? surfaceRadius : 22, 8),
          width / 2,
          height / 2
        );
        composerMetricsKey = metricsKey;
      }
      const radius = composerRadius;
      const horizontal = Math.max(0, width - radius * 2);
      const vertical = Math.max(0, height - radius * 2);
      const perimeter = horizontal * 2 + vertical * 2 + Math.PI * radius * 2;
      const segmentCount = Math.min(720, Math.max(360, Math.ceil(perimeter / 3)));
      const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const duration = reducedMotion ? 8e3 : 2400;
      const phase = timestamp % duration / duration;
      const geometryKey = `${metricsKey}:${Math.round(radius * 10)}:${segmentCount}`;
      if (composerGeometryKey !== geometryKey) {
        composerGeometryKey = geometryKey;
        composerSegments = Array.from({ length: segmentCount }, (_, index) => ({
          start: pointOnRoundedRect(perimeter * index / segmentCount, width, height, radius),
          end: pointOnRoundedRect(perimeter * (index + 1.5) / segmentCount, width, height, radius)
        }));
      }
      context.lineWidth = 2;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (let index = 0; index < composerSegments.length; index += 1) {
        const { start, end } = composerSegments[index];
        const hue = ((index / segmentCount - phase) * 360 + 360) % 360;
        context.strokeStyle = `hsl(${hue}deg 100% 60%)`;
        context.beginPath();
        context.moveTo(start.x + inset, start.y + inset);
        context.lineTo(end.x + inset, end.y + inset);
        context.stroke();
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
      return Array.from(document.querySelectorAll(
        '[data-app-shell-main-surface], [class*="_MainContentSurface_"]'
      )).filter((surface) => surface instanceof HTMLElement && isVisible(surface)).sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
      })[0] ?? null;
    }
    function setFireSurface(nextSurface) {
      if (fireSurface === nextSurface && fireSurface?.isConnected) return;
      fireResizeObserver?.disconnect();
      fireResizeObserver = null;
      fireLayer?.remove();
      fireLayer = null;
      fireImages = [];
      fireSurface = nextSurface instanceof HTMLElement ? nextSurface : null;
      if (!(fireSurface instanceof HTMLElement)) return;
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
      renderServerLatencies();
      const nextComposerSurface = findComposerSurface();
      if (nextComposerSurface !== composerSurface) setComposerSurface(nextComposerSurface);
      const nextFireSurface = findMainSurface();
      if (nextFireSurface !== fireSurface) setFireSurface(nextFireSurface);
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
        usageTimer = setInterval(refreshUsage, USAGE_REFRESH_MS);
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
        void refreshUsage();
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
          composerAnimationFrame: composerAnimationFrame !== 0,
          fireTimer: fireTimer !== 0
        },
        nodes: {
          usagePanels: document.querySelectorAll(`#${USAGE_PANEL_ID}`).length,
          composerCanvases: document.querySelectorAll(".codex-theme-rainbow-canvas").length,
          fireLayers: document.querySelectorAll(".codex-theme-thumb-fire-layer").length,
          fireImages: document.querySelectorAll(".codex-theme-thumb-fire").length,
          serverSignals: document.querySelectorAll(".codex-theme-server-signal").length
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
      activityTimer = 0;
      usageTimer = 0;
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
      if (composerSurface instanceof HTMLElement) {
        removeAttributeIfPresent(composerSurface, "data-codex-theme-rainbow-composer");
        removeAttributeIfPresent(composerSurface, "data-codex-theme-rainbow-active");
      }
      composerCanvas?.remove();
      fireLayer?.remove();
      document.getElementById(USAGE_PANEL_ID)?.remove();
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

// src/page/styles.mjs
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

[data-app-shell-main-surface],
[class*="_MainContentSurface_"] {
  --color-token-main-surface-primary: transparent !important;
  --color-token-bg-primary: transparent !important;
  --color-token-bg-secondary: var(--codex-chat-secondary) !important;
  --color-token-input-background: var(--codex-chat-input) !important;
  --color-token-dropdown-background: var(--codex-chat-dropdown) !important;
  --color-token-text-code-block-background: var(--codex-chat-code) !important;

  background-color: transparent !important;
  background-image:
    linear-gradient(rgb(0 0 0 / 60%), rgb(0 0 0 / 60%)),
    url(${JSON.stringify(imageDataUrl)}) !important;
  background-position: center center !important;
  background-repeat: no-repeat !important;
  background-size: cover !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  position: relative !important;
  isolation: isolate;
}

:where(a, [role="menuitem"])[href*="pro_variant=2x"][href*="#pricing"],
[role="menuitem"]:has(a[href*="pro_variant=2x"][href*="#pricing"]) {
  display: none !important;
}

#codex-theme-usage-panel {
  box-sizing: border-box;
  width: 100%;
  flex: none;
  margin: 0;
  padding: 9px 14px 8px;
  border-top: 1px solid rgb(127 127 127 / 18%);
  color: var(--color-token-description-foreground);
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
  z-index: 20;
  inset: -3px;
  width: calc(100% + 6px);
  height: calc(100% + 6px);
  pointer-events: none;
  contain: strict;
  opacity: 0;
  transform: translateZ(0);
  backface-visibility: hidden;
  transition: opacity 240ms ease;
}

[data-codex-theme-rainbow-active="true"]
  > .codex-theme-rainbow-canvas[data-ready="true"] {
  opacity: 1;
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
  margin-left: 6px;
  color: rgb(54 204 134);
  transition: color 180ms ease, opacity 180ms ease;
}

.codex-theme-server-signal[data-bars="0"] {
  color: var(--color-token-description-foreground);
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

// src/page/source.mjs
var PAGE_RUNTIME_VERSION = 2;
function createPageSource(imageDataUrl, fireDataUrl, { rainbowPreview = false } = {}) {
  const config = {
    version: PAGE_RUNTIME_VERSION,
    css: createThemeCss(imageDataUrl),
    fireDataUrl,
    rainbowPreview,
    imageBytes: Buffer.byteLength(imageDataUrl, "utf8")
  };
  return `(${installPageRuntime.toString()})(${JSON.stringify(config)})`;
}

// src/main.mjs
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
    throw new Error("/Applications에서 ChatGPT 또는 Codex 앱을 찾지 못했사옵니다.");
  }
  validateAssets(options);
  console.log(`[wallpaper] 사진: ${options.imagePath}`);
  console.log(`[wallpaper] 불꽃: ${options.firePath}`);
  console.log(`[wallpaper] 앱: ${appExecutable}`);
  console.log(`[wallpaper] 전용 프로필: ${options.profilePath}`);
  if (options.dryRun) {
    console.log("[wallpaper] 검사 완료. 앱은 실행하지 않았사옵니다.");
    return;
  }
  fs2.mkdirSync(options.profilePath, { recursive: true, mode: 448 });
  const usageCachePath = path2.join(options.profilePath, "codex-theme-usage.json");
  const pinnedSshHosts = parsePinnedSshHosts(SSH_CONFIG_PATH);
  const source = createPageSource(assetDataUrl(options.imagePath), assetDataUrl(options.firePath), {
    rainbowPreview: options.inspectUi
  });
  const childEnvironment = { ...process.env };
  if (options.skipRemoteSshBoot) childEnvironment.CODEX_SSH_SKIP_APP_SERVER_BOOT = "true";
  const child = spawn(
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
  let controller = null;
  const terminate = () => {
    if (latencyTimer) clearInterval(latencyTimer);
    latencyTimer = 0;
    controller?.dispose();
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  process.once("exit", terminate);
  child.once("error", (error) => {
    console.error("[wallpaper] 앱을 실행하지 못했사옵니다:", error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    controller?.dispose();
    if (latencyTimer) clearInterval(latencyTimer);
    if (signal) console.log(`[wallpaper] Codex가 ${signal} 신호로 종료되었사옵니다.`);
    else console.log(`[wallpaper] Codex가 종료되었사옵니다. 코드=${code ?? "unknown"}`);
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
      throw new Error(result.exceptionDetails.text ?? "화면 상태 갱신에 실패했사옵니다.");
    }
  };
  const broadcastUiState = async () => {
    if (!controller) return;
    await Promise.allSettled(controller.sessionIds().map(pushUiState));
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
      throw new Error(result.exceptionDetails.text ?? "UI 진단에 실패했사옵니다.");
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
      console.error(`[wallpaper] 사용량 응답을 읽지 못했사옵니다: ${error.message}`);
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
        console.error(`[wallpaper] 새 문서 상태 갱신을 건너뛰었사옵니다: ${error.message}`);
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
  void refreshLatencies();
  latencyTimer = setInterval(() => void refreshLatencies(), LATENCY_REFRESH_MS);
  console.log("[wallpaper] 실행기를 닫으면 이 전용 Codex 인스턴스도 함께 종료되옵니다.");
}
main().catch((error) => {
  console.error(`[wallpaper] ${error.message}`);
  process.exitCode = 1;
});
