#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_PATH = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE_PATH = path.join(PROJECT_PATH, "image.jpg");
const DEFAULT_PROFILE_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Codex Theme",
);
const SSH_CONFIG_PATH = path.join(os.homedir(), ".ssh", "config");
const PINNED_SSH_ALIASES = new Set(["VPN", "Proxmox", "Homelab", "Oracle_seoul"]);
const LATENCY_REFRESH_MS = 15_000;
const LATENCY_TIMEOUT_MS = 2_000;

const APP_CANDIDATES = [
  "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
  "/Applications/Codex.app/Contents/MacOS/Codex",
];

function parseArguments(argv) {
  const options = {
    imagePath: DEFAULT_IMAGE_PATH,
    profilePath: DEFAULT_PROFILE_PATH,
    skipRemoteSshBoot: false,
    dryRun: false,
    screenshotPath: undefined,
    exitAfterScreenshot: false,
    inspectUi: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--image") {
      options.imagePath = path.resolve(argv[++index] ?? "");
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
  --profile <경로>            전용 Electron 프로필 경로
  --skip-remote-ssh-boot      검증용: 원격 SSH 앱 서버 부팅 생략
  --dry-run                   파일만 검사하고 앱은 실행하지 않음
  --screenshot <경로>         검증용: 주입 후 화면을 PNG로 저장
  --exit-after-screenshot     검증용: 화면 저장 뒤 앱 종료
  --inspect-ui                검증용: 사이드바 DOM과 사용량 요청 상태 출력
  -h, --help                  도움말 표시`);
}

function findAppExecutable() {
  return APP_CANDIDATES.find((candidate) => fs.existsSync(candidate));
}

function imageDataUrl(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : "image/jpeg";
  return `data:${mimeType};base64,${fs.readFileSync(imagePath).toString("base64")}`;
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
        (alias) => PINNED_SSH_ALIASES.has(alias) && !/[*!?]/.test(alias),
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
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      finish(Math.max(1, Math.round(elapsedMs)));
    });
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
  });
}

async function measurePinnedSshLatencies(hosts) {
  const entries = await Promise.all(
    Object.entries(hosts).map(async ([alias, host]) => [alias, await measureTcpLatency(host)]),
  );
  return Object.fromEntries(entries);
}

function normalizeUsagePayload(payload) {
  const rateLimit = payload?.rate_limit;
  if (rateLimit == null || typeof rateLimit !== "object") return null;

  const windows = [rateLimit.primary_window, rateLimit.secondary_window]
    .filter((window) => window != null && Number.isFinite(Number(window.used_percent)))
    .map((window) => ({
      usedPercent: Number(window.used_percent),
      windowSeconds: Number(window.limit_window_seconds) || 0,
      resetAtSeconds: Number(window.reset_at),
    }));
  if (windows.length === 0) return null;

  const limitingWindow = windows.reduce((current, candidate) => {
    if (candidate.usedPercent > current.usedPercent) return candidate;
    if (
      candidate.usedPercent === current.usedPercent &&
      candidate.windowSeconds > current.windowSeconds
    ) {
      return candidate;
    }
    return current;
  });
  const resetAtMs = Number.isFinite(limitingWindow.resetAtSeconds)
    ? limitingWindow.resetAtSeconds * 1_000
    : null;

  return {
    remainingPercent: Math.round(
      Math.min(100, Math.max(0, 100 - limitingWindow.usedPercent)),
    ),
    resetAtMs,
    capturedAtMs: Date.now(),
  };
}

function readUsageCache(cachePath) {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (!Number.isFinite(cached?.remainingPercent)) return null;
    if (!Number.isFinite(cached?.capturedAtMs)) return null;
    if (Date.now() - cached.capturedAtMs > 6 * 60 * 60 * 1_000) return null;
    if (Number.isFinite(cached.resetAtMs) && cached.resetAtMs <= Date.now()) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeUsageCache(cachePath, usage) {
  try {
    fs.writeFileSync(cachePath, `${JSON.stringify(usage)}\n`, { mode: 0o600 });
  } catch (error) {
    console.error(`[wallpaper] 사용량 캐시를 저장하지 못했사옵니다: ${error.message}`);
  }
}

function wallpaperSource(dataUrl, { rainbowPreview = false } = {}) {
  const css = `
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
    url(${JSON.stringify(dataUrl)}) !important;
  background-position: center center !important;
  background-repeat: no-repeat !important;
  background-size: cover !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
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
  height: 3px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(127 127 127 / 22%);
}

#codex-theme-usage-panel .codex-theme-usage-fill {
  position: relative;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  background: currentColor;
  opacity: 0.72;
  transition: width 180ms ease, opacity 240ms ease;
}

:root[data-codex-theme-session-active="true"] #codex-theme-usage-panel .codex-theme-usage-fill {
  opacity: 1;
}

#codex-theme-usage-panel .codex-theme-usage-fill::before {
  position: absolute;
  inset: 0;
  width: 200%;
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
  transform: translateX(0);
  animation: codex-theme-usage-rainbow 2.4s linear infinite;
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
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  #codex-theme-usage-panel .codex-theme-usage-fill::before {
    animation-duration: 8s;
  }
}

[data-codex-theme-rainbow-composer="active"] {
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
  will-change: transform;
}

.codex-theme-rainbow-canvas[data-ready="true"] {
  opacity: 1;
}

.codex-theme-server-latency {
  margin-left: 6px;
  color: var(--color-token-description-foreground);
  font-size: 0.72em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

`;

  return `(() => {
    const STYLE_ID = "codex-theme-style";
    const USAGE_PANEL_ID = "codex-theme-usage-panel";
    const RAINBOW_PREVIEW = ${JSON.stringify(rainbowPreview)};
    const CSS = ${JSON.stringify(css)};
    const state = globalThis.__codexThemeUiState || { usage: null, latencies: {} };
    globalThis.__codexThemeUiState = state;
    const USAGE_CACHE_KEY = "codex-theme-usage-cache";
    const USAGE_REFRESH_MS = 60 * 1000;

    try {
      const cachedUsage = JSON.parse(localStorage.getItem(USAGE_CACHE_KEY) || "null");
      const cacheIsFresh = Number.isFinite(cachedUsage?.capturedAtMs)
        && Date.now() - cachedUsage.capturedAtMs <= 6 * 60 * 60 * 1000;
      const resetIsValid = !Number.isFinite(cachedUsage?.resetAtMs)
        || cachedUsage.resetAtMs > Date.now();
      if (state.usage == null && cacheIsFresh && resetIsValid) state.usage = cachedUsage;
    } catch {}

    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const normalizeUsagePayload = (payload) => {
      const rateLimit = payload?.rate_limit;
      if (rateLimit == null || typeof rateLimit !== "object") return null;
      const windows = [rateLimit.primary_window, rateLimit.secondary_window]
        .filter((window) => window != null && Number.isFinite(Number(window.used_percent)))
        .map((window) => ({
          usedPercent: Number(window.used_percent),
          windowSeconds: Number(window.limit_window_seconds) || 0,
          resetAtSeconds: Number(window.reset_at),
        }));
      if (windows.length === 0) return null;
      const limitingWindow = windows.reduce((current, candidate) => {
        if (candidate.usedPercent > current.usedPercent) return candidate;
        if (
          candidate.usedPercent === current.usedPercent
          && candidate.windowSeconds > current.windowSeconds
        ) {
          return candidate;
        }
        return current;
      });
      return {
        remainingPercent: Math.round(
          Math.min(100, Math.max(0, 100 - limitingWindow.usedPercent)),
        ),
        resetAtMs: Number.isFinite(limitingWindow.resetAtSeconds)
          ? limitingWindow.resetAtSeconds * 1000
          : null,
        capturedAtMs: Date.now(),
      };
    };

    const fetchUsagePayload = () => new Promise((resolve, reject) => {
      const bridge = globalThis.electronBridge;
      if (typeof bridge?.sendMessageFromView !== "function") {
        reject(new Error("앱 요청 통로를 찾지 못했사옵니다"));
        return;
      }
      const requestId = crypto.randomUUID();
      let settled = false;
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
      const timeout = setTimeout(() => {
        finish(reject, new Error("사용량 요청 시간이 초과되었사옵니다"));
      }, 10000);
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
          originator: "Codex Desktop",
        },
      })).catch((error) => finish(reject, error));
    });

    const refreshUsage = async () => {
      try {
        const usage = normalizeUsagePayload(await fetchUsagePayload());
        if (usage == null) throw new Error("사용량 응답 형식이 올바르지 않사옵니다");
        state.usage = usage;
        state.usageError = null;
        try {
          localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(usage));
        } catch {}
      } catch (error) {
        state.usageError = error instanceof Error ? error.message : String(error);
      }
      scheduleRender();
    };

    const formatUsage = (usage) => {
      if (!usage || !Number.isFinite(usage.remainingPercent)) {
        return {
          value: state.usageError ? "使用量を取得できません" : "使用量を確認中…",
          reset: "",
          title: state.usageError || "使用量を確認中です",
          remainingPercent: 0,
        };
      }
      let resetLabel = "更新時刻を確認中…";
      let resetTitle = "";
      if (typeof usage.resetLabel === "string" && usage.resetLabel.trim()) {
        resetLabel = usage.resetLabel.trim() + "リセット";
        resetTitle = usage.resetLabel.trim();
      } else if (Number.isFinite(usage.resetAtMs)) {
        const resetDate = new Date(usage.resetAtMs);
        resetLabel = String(resetDate.getMonth() + 1)
          + "月"
          + String(resetDate.getDate())
          + "日リセット";
        resetTitle = new Intl.DateTimeFormat("ja-JP", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(resetDate);
      }
      return {
        value: String(usage.remainingPercent) + "% 残り",
        reset: resetLabel,
        title: resetTitle
          ? "使用量 " + String(usage.remainingPercent) + "% 残り · " + resetTitle + "リセット"
          : "使用量 " + String(usage.remainingPercent) + "% 残り",
        remainingPercent: Math.min(100, Math.max(0, usage.remainingPercent)),
      };
    };

    const findProfileContext = () => {
      const panel = document.querySelector(".app-shell-left-panel");
      if (!(panel instanceof HTMLElement)) return null;
      const scroll = panel.querySelector("[data-app-action-sidebar-scroll]");
      const profileButtons = Array.from(panel.querySelectorAll("button.sidebar-item"))
        .filter((button) => !scroll?.contains(button) && isVisible(button))
        .sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom);
      const profileButton = profileButtons[0];
      if (!(profileButton instanceof HTMLButtonElement)) return null;
      const footerRow = profileButton.closest(".h-toolbar");
      if (!(footerRow instanceof HTMLElement)) return null;
      return { footerRow, panel, profileButton, scroll };
    };

    const findRateLimitsInReactTree = (element) => {
      const fiberKey = Reflect.ownKeys(element)
        .find((key) => typeof key === "string" && key.startsWith("__reactFiber$"));
      let fiber = fiberKey == null ? null : element[fiberKey];
      for (let depth = 0; fiber && depth < 80; depth += 1, fiber = fiber.return) {
        const rateLimits = fiber.memoizedProps?.rateLimits;
        if (Array.isArray(rateLimits)) return rateLimits;
      }
      return null;
    };

    const findRateBucketInReactTree = (element) => {
      const fiberKey = Reflect.ownKeys(element)
        .find((key) => typeof key === "string" && key.startsWith("__reactFiber$"));
      let fiber = fiberKey == null ? null : element[fiberKey];
      for (let depth = 0; fiber && depth < 80; depth += 1, fiber = fiber.return) {
        const bucket = fiber.memoizedProps?.bucket;
        if (Number.isFinite(bucket?.usedPercent)) return bucket;
      }
      return null;
    };

    const activateProfileButton = (button) => {
      button.focus({ preventScroll: true });
      button.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter",
      }));
    };

    const usageFromRateLimits = (rateLimits, displayedRemaining) => {
      const buckets = rateLimits.flatMap((entry) => [
        entry?.snapshot?.primary,
        entry?.snapshot?.secondary,
      ]).filter((bucket) => Number.isFinite(bucket?.usedPercent));
      if (buckets.length === 0) return null;

      const matchingBuckets = buckets.filter((bucket) =>
        Math.round(Math.min(100, Math.max(0, 100 - bucket.usedPercent))) === displayedRemaining,
      );
      const candidates = matchingBuckets.length > 0 ? matchingBuckets : buckets;
      const limitingBucket = candidates.reduce((current, candidate) => {
        if (candidate.usedPercent > current.usedPercent) return candidate;
        if (
          candidate.usedPercent === current.usedPercent
          && (candidate.windowDurationMins || 0) > (current.windowDurationMins || 0)
        ) {
          return candidate;
        }
        return current;
      });
      return {
        remainingPercent: Math.round(
          Math.min(100, Math.max(0, 100 - limitingBucket.usedPercent)),
        ),
        resetAtMs: Number.isFinite(limitingBucket.resetsAt)
          ? limitingBucket.resetsAt * 1000
          : null,
        capturedAtMs: Date.now(),
      };
    };

    let usageProbeInProgress = false;
    const probeUsageFromProfileMenu = async () => {
      if (usageProbeInProgress) return false;
      const context = findProfileContext();
      if (context == null || context.profileButton.getAttribute("aria-expanded") === "true") {
        state.probeDebug = context == null ? "C0" : "OPEN";
        scheduleRender();
        return false;
      }

      usageProbeInProgress = true;
      state.probeDebug = "CLICK";
      scheduleRender();
      document.documentElement.dataset.codexThemeUsageProbe = "true";
      let menuOpenedByProbe = false;
      try {
        const visibleMenusBefore = new Set(
          Array.from(document.querySelectorAll(
            '[role="menu"], [data-radix-popper-content-wrapper]',
          )).filter(isVisible),
        );
        const visiblePercentagesBefore = new Set(
          Array.from(document.querySelectorAll("span")).filter((element) =>
            element.id !== USAGE_BADGE_ID
            && isVisible(element)
            && /^\\s*\\d{1,3}\\s*%\\s*$/.test(element.textContent || ""),
          ),
        );
        activateProfileButton(context.profileButton);
        await new Promise((resolve) => setTimeout(resolve, 180));
        const menuRoots = Array.from(document.querySelectorAll(
          '[role="menu"], [data-radix-popper-content-wrapper]',
        )).filter(isVisible);
        state.probeDebug = "M" + String(menuRoots.length);
        scheduleRender();
        menuOpenedByProbe = menuRoots.some((menu) => !visibleMenusBefore.has(menu));
        const percentageElements = Array.from(document.querySelectorAll("span"))
          .filter((element) =>
            element.id !== USAGE_BADGE_ID
            && !visiblePercentagesBefore.has(element)
            && isVisible(element)
            && /^\\s*\\d{1,3}\\s*%\\s*$/.test(element.textContent || ""),
          );
        state.probeDebug = "P" + String(percentageElements.length);
        scheduleRender();
        for (const percentageElement of percentageElements) {
            const displayedRemaining = Number.parseInt(percentageElement.textContent, 10);
            const rateLimits = findRateLimitsInReactTree(percentageElement);
            state.probeDebug = "P" + String(percentageElements.length)
              + (rateLimits == null ? "N" : "R");
            scheduleRender();
            let usage = rateLimits == null
              ? null
              : usageFromRateLimits(rateLimits, displayedRemaining);
            if (usage == null) {
              let row = percentageElement.parentElement;
              let resetLabel = null;
              for (let depth = 0; row && depth < 7; depth += 1, row = row.parentElement) {
                const resetElement = Array.from(row.querySelectorAll("span[title]"))
                  .find((element) => {
                    const title = element.getAttribute("title")?.trim() || "";
                    return title.length > 0 && !/^\\s*\\d{1,3}\\s*%\\s*$/.test(title);
                  });
                if (resetElement) {
                  resetLabel = resetElement.getAttribute("title")?.trim() || null;
                  break;
                }
                const rowText = (row.textContent || "").replace(/\\s+/g, " ").trim();
                const percentageText = String(displayedRemaining) + "%";
                const percentageIndex = rowText.indexOf(percentageText);
                if (percentageIndex >= 0) {
                  const trailingText = rowText
                    .slice(percentageIndex + percentageText.length)
                    .replace(/^[\\s·→›-]+/, "")
                    .trim();
                  if (trailingText.length > 0 && trailingText.length <= 32) {
                    resetLabel = trailingText;
                    break;
                  }
                }
              }
              if (resetLabel != null) {
                const parsedResetAt = Date.parse(resetLabel);
                usage = {
                  remainingPercent: displayedRemaining,
                  resetAtMs: Number.isFinite(parsedResetAt) && parsedResetAt > Date.now() - 86400000
                    ? parsedResetAt
                    : null,
                  resetLabel,
                  capturedAtMs: Date.now(),
                };
              }
            }
            if (usage == null) continue;
            state.usage = usage;
            state.probeDebug = "OK";
            try {
              localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(usage));
            } catch {}
            scheduleRender();
            return true;
        }

        const usageSubmenuTrigger = percentageElements[0]?.closest(
          '[role="menuitem"], [role="menuitemradio"], button',
        );
        if (usageSubmenuTrigger instanceof HTMLElement) {
          usageSubmenuTrigger.dispatchEvent(new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            pointerType: "mouse",
          }));
          await new Promise((resolve) => setTimeout(resolve, 320));
          const detailedPercentages = Array.from(document.querySelectorAll("span"))
            .filter((element) =>
              element.id !== USAGE_BADGE_ID
              && isVisible(element)
              && /^\\s*\\d{1,3}\\s*%\\s*$/.test(element.textContent || ""),
            );
          const detailedUsages = [];
          for (const percentageElement of detailedPercentages) {
            const displayedRemaining = Number.parseInt(percentageElement.textContent, 10);
            const bucket = findRateBucketInReactTree(percentageElement);
            if (bucket != null) {
              detailedUsages.push({
                remainingPercent: Math.round(
                  Math.min(100, Math.max(0, 100 - bucket.usedPercent)),
                ),
                resetAtMs: Number.isFinite(bucket.resetsAt) ? bucket.resetsAt * 1000 : null,
                capturedAtMs: Date.now(),
                usedPercent: bucket.usedPercent,
                windowDurationMins: bucket.windowDurationMins || 0,
              });
              continue;
            }
            let row = percentageElement.parentElement;
            for (let depth = 0; row && depth < 7; depth += 1, row = row.parentElement) {
              const resetElement = Array.from(row.querySelectorAll("span[title]"))
                .find((element) => {
                  const title = element.getAttribute("title")?.trim() || "";
                  return title.length > 0 && !/^\\s*\\d{1,3}\\s*%\\s*$/.test(title);
                });
              const resetLabel = resetElement?.getAttribute("title")?.trim() || null;
              if (resetLabel == null) continue;
              detailedUsages.push({
                remainingPercent: displayedRemaining,
                resetAtMs: null,
                resetLabel,
                capturedAtMs: Date.now(),
                usedPercent: 100 - displayedRemaining,
                windowDurationMins: 0,
              });
              break;
            }
          }
          state.probeDebug = "S" + String(detailedPercentages.length)
            + (detailedUsages.length > 0 ? "B" : "N");
          scheduleRender();
          if (detailedUsages.length > 0) {
            const usage = detailedUsages.reduce((current, candidate) => {
              if (candidate.usedPercent > current.usedPercent) return candidate;
              if (
                candidate.usedPercent === current.usedPercent
                && candidate.windowDurationMins > current.windowDurationMins
              ) {
                return candidate;
              }
              return current;
            });
            delete usage.usedPercent;
            delete usage.windowDurationMins;
            state.usage = usage;
            state.probeDebug = "OK";
            try {
              localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(usage));
            } catch {}
            scheduleRender();
            return true;
          }
        }
        return false;
      } finally {
        if (menuOpenedByProbe) {
          activateProfileButton(context.profileButton);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        delete document.documentElement.dataset.codexThemeUsageProbe;
        usageProbeInProgress = false;
      }
    };

    const renderUsagePanel = () => {
      const context = findProfileContext();
      if (context == null) return;
      const { footerRow } = context;
      const host = footerRow.parentElement;
      if (!(host instanceof HTMLElement)) return;

      document.getElementById("codex-theme-usage-badge")?.remove();
      for (const hiddenHelp of document.querySelectorAll('[data-codex-theme-help-hidden="true"]')) {
        delete hiddenHelp.dataset.codexThemeHelpHidden;
      }

      let panel = document.getElementById(USAGE_PANEL_ID);
      if (!(panel instanceof HTMLElement)) {
        panel = document.createElement("section");
        panel.id = USAGE_PANEL_ID;
        panel.setAttribute("aria-live", "polite");
        panel.innerHTML = [
          '<div class="codex-theme-usage-row">',
          '<span class="codex-theme-usage-value">使用量を確認中…</span>',
          '<span class="codex-theme-usage-reset"></span>',
          '</div>',
          '<div class="codex-theme-usage-track" aria-hidden="true">',
          '<div class="codex-theme-usage-fill"></div>',
          '</div>',
        ].join("");
      }
      if (panel.parentElement !== host || panel.nextElementSibling !== footerRow) {
        host.insertBefore(panel, footerRow);
      }
      const formatted = formatUsage(state.usage);
      const value = panel.querySelector(".codex-theme-usage-value");
      const reset = panel.querySelector(".codex-theme-usage-reset");
      const fill = panel.querySelector(".codex-theme-usage-fill");
      if (value?.textContent !== formatted.value) value.textContent = formatted.value;
      if (reset?.textContent !== formatted.reset) reset.textContent = formatted.reset;
      if (fill instanceof HTMLElement) fill.style.width = String(formatted.remainingPercent) + "%";
      if (panel.title !== formatted.title) panel.title = formatted.title;
      if (panel.getAttribute("aria-label") !== formatted.title) {
        panel.setAttribute("aria-label", formatted.title);
      }
    };

    const renderServerLatencies = () => {
      const panel = document.querySelector(".app-shell-left-panel");
      const scroll = panel?.querySelector("[data-app-action-sidebar-scroll]");
      if (!(panel instanceof HTMLElement) || !(scroll instanceof HTMLElement)) return;
      const panelRect = panel.getBoundingClientRect();

      for (const badge of scroll.querySelectorAll(".codex-theme-server-latency")) {
        const alias = badge.getAttribute("data-host-alias");
        const latency = alias == null ? null : state.latencies?.[alias];
        if (!Number.isFinite(latency)) badge.remove();
      }

      for (const [alias, latency] of Object.entries(state.latencies || {})) {
        if (!Number.isFinite(latency)) continue;
        let badge = Array.from(scroll.querySelectorAll(".codex-theme-server-latency"))
          .find((candidate) => candidate.getAttribute("data-host-alias") === alias);
        if (!(badge instanceof HTMLElement)) {
          const matches = [];
          const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);
          let textNode;
          while ((textNode = walker.nextNode())) {
            if (textNode.nodeValue?.trim().toLocaleLowerCase() !== alias.toLocaleLowerCase()) continue;
            const parent = textNode.parentElement;
            if (!(parent instanceof HTMLElement) || !isVisible(parent)) continue;
            const rect = parent.getBoundingClientRect();
            if (rect.left < panelRect.left + panelRect.width * 0.38) continue;
            matches.push(parent);
          }
          matches.sort((left, right) => right.getBoundingClientRect().left - left.getBoundingClientRect().left);
          const label = matches[0];
          if (!(label instanceof HTMLElement)) continue;
          badge = document.createElement("span");
          badge.className = "codex-theme-server-latency";
          badge.dataset.hostAlias = alias;
          badge.setAttribute("aria-hidden", "true");
          label.appendChild(badge);
        }
        const latencyLabel = "· " + String(Math.round(latency)) + " ms";
        if (badge.textContent !== latencyLabel) badge.textContent = latencyLabel;
      }
    };

    let rainbowCanvas = null;
    let rainbowSurface = null;
    let rainbowAnimationFrame = 0;
    let rainbowLastDrawTimestamp = -Infinity;
    let rainbowMetricsKey = "";
    let rainbowGeometryKey = "";
    let rainbowSegments = [];
    let rainbowRadius = 22;
    let rainbowActiveUntil = 0;
    const RAINBOW_FRAME_INTERVAL_MS = 1000 / 30;
    const RAINBOW_ACTIVE_GRACE_MS = 900;
    const RAINBOW_FADE_DURATION_MS = 240;

    const findComposerSurface = () => {
      const editors = Array.from(document.querySelectorAll(
        'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder]',
      ))
        .filter((element) => {
          if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
          const rect = element.getBoundingClientRect();
          return rect.width >= 240 && rect.height >= 20;
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return rightRect.bottom - leftRect.bottom || rightRect.width - leftRect.width;
        });
      const editor = editors[0];
      if (!(editor instanceof HTMLElement)) return null;

      if (
        rainbowSurface instanceof HTMLElement
        && rainbowSurface.isConnected
        && isVisible(rainbowSurface)
        && rainbowSurface.contains(editor)
      ) {
        return rainbowSurface;
      }

      const form = editor.closest("form");
      if (form instanceof HTMLElement && isVisible(form)) return form;

      let surface = editor.parentElement;
      let candidate = null;
      for (let depth = 0; surface && depth < 8; depth += 1, surface = surface.parentElement) {
        const rect = surface.getBoundingClientRect();
        if (
          rect.width >= 320
          && rect.height >= 48
          && rect.height <= 260
          && surface.querySelector("button")
        ) {
          candidate = surface;
        }
        if (rect.width >= window.innerWidth * 0.92) break;
      }
      return candidate;
    };

    const composerIsActive = (surface) => {
      if (RAINBOW_PREVIEW) return true;
      const stopPattern = /(?:stop|cancel|interrupt|停止|中止|キャンセル|중지|정지|취소)/i;
      const controls = Array.from(surface.querySelectorAll("button, [role=button]"))
        .filter((element) => element instanceof HTMLElement && isVisible(element));
      if (controls.some((element) => stopPattern.test([
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.textContent,
      ].filter(Boolean).join(" ")))) {
        return true;
      }
      if (surface.querySelector('[aria-busy="true"], [data-state="streaming"], [data-status="running"]')) {
        return true;
      }
      return false;
    };

    const stopRainbowAnimation = () => {
      if (rainbowAnimationFrame) cancelAnimationFrame(rainbowAnimationFrame);
      rainbowAnimationFrame = 0;
      const canvasToRemove = rainbowCanvas;
      if (canvasToRemove?.isConnected && canvasToRemove.dataset.ready === "true") {
        delete canvasToRemove.dataset.ready;
        setTimeout(() => canvasToRemove.remove(), RAINBOW_FADE_DURATION_MS);
      } else {
        canvasToRemove?.remove();
      }
      rainbowCanvas = null;
      rainbowSurface = null;
      rainbowLastDrawTimestamp = -Infinity;
      rainbowMetricsKey = "";
      rainbowGeometryKey = "";
      rainbowSegments = [];
      rainbowRadius = 22;
    };

    const pointOnRoundedRect = (distance, width, height, radius) => {
      const horizontal = Math.max(0, width - radius * 2);
      const vertical = Math.max(0, height - radius * 2);
      const arc = Math.PI * radius / 2;
      const perimeter = horizontal * 2 + vertical * 2 + arc * 4;
      let cursor = ((distance % perimeter) + perimeter) % perimeter;

      if (cursor <= horizontal) return { x: radius + cursor, y: 0, perimeter };
      cursor -= horizontal;
      if (cursor <= arc) {
        const angle = -Math.PI / 2 + cursor / radius;
        return {
          x: width - radius + Math.cos(angle) * radius,
          y: radius + Math.sin(angle) * radius,
          perimeter,
        };
      }
      cursor -= arc;
      if (cursor <= vertical) return { x: width, y: radius + cursor, perimeter };
      cursor -= vertical;
      if (cursor <= arc) {
        const angle = cursor / radius;
        return {
          x: width - radius + Math.cos(angle) * radius,
          y: height - radius + Math.sin(angle) * radius,
          perimeter,
        };
      }
      cursor -= arc;
      if (cursor <= horizontal) return { x: width - radius - cursor, y: height, perimeter };
      cursor -= horizontal;
      if (cursor <= arc) {
        const angle = Math.PI / 2 + cursor / radius;
        return {
          x: radius + Math.cos(angle) * radius,
          y: height - radius + Math.sin(angle) * radius,
          perimeter,
        };
      }
      cursor -= arc;
      if (cursor <= vertical) return { x: 0, y: height - radius - cursor, perimeter };
      cursor -= vertical;
      const angle = Math.PI + cursor / radius;
      return {
        x: radius + Math.cos(angle) * radius,
        y: radius + Math.sin(angle) * radius,
        perimeter,
      };
    };

    const drawRainbowFrame = (timestamp) => {
      if (!(rainbowCanvas instanceof HTMLCanvasElement) || !(rainbowSurface instanceof HTMLElement)) {
        return;
      }
      const cssWidth = rainbowCanvas.clientWidth;
      const cssHeight = rainbowCanvas.clientHeight;
      if (cssWidth < 2 || cssHeight < 2) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
      const pixelWidth = Math.round(cssWidth * pixelRatio);
      const pixelHeight = Math.round(cssHeight * pixelRatio);
      if (rainbowCanvas.width !== pixelWidth || rainbowCanvas.height !== pixelHeight) {
        rainbowCanvas.width = pixelWidth;
        rainbowCanvas.height = pixelHeight;
      }
      const context = rainbowCanvas.getContext("2d");
      if (context == null) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);

      const inset = 3;
      const width = Math.max(1, cssWidth - inset * 2);
      const height = Math.max(1, cssHeight - inset * 2);
      const metricsKey = String(cssWidth) + "x" + String(cssHeight);
      if (rainbowMetricsKey !== metricsKey) {
        const surfaceRadius = Number.parseFloat(getComputedStyle(rainbowSurface).borderRadius);
        rainbowRadius = Math.min(
          Math.max(Number.isFinite(surfaceRadius) && surfaceRadius >= 8 ? surfaceRadius : 22, 8),
          width / 2,
          height / 2,
        );
        rainbowMetricsKey = metricsKey;
      }
      const radius = rainbowRadius;
      const horizontal = Math.max(0, width - radius * 2);
      const vertical = Math.max(0, height - radius * 2);
      const perimeter = horizontal * 2 + vertical * 2 + Math.PI * radius * 2;
      const segmentCount = Math.min(180, Math.max(120, Math.ceil(perimeter / 10)));
      const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 8_000 : 2_400;
      const phase = (timestamp % duration) / duration;

      const geometryKey = metricsKey + ":" + String(Math.round(radius * 10)) + ":" + String(segmentCount);
      if (rainbowGeometryKey !== geometryKey) {
        rainbowGeometryKey = geometryKey;
        rainbowSegments = Array.from({ length: segmentCount }, (_, index) => {
          const startDistance = perimeter * index / segmentCount;
          const endDistance = perimeter * (index + 1.35) / segmentCount;
          return {
            start: pointOnRoundedRect(startDistance, width, height, radius),
            end: pointOnRoundedRect(endDistance, width, height, radius),
          };
        });
      }

      context.lineWidth = 2;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (let index = 0; index < rainbowSegments.length; index += 1) {
        const { start, end } = rainbowSegments[index];
        const hue = ((index / segmentCount - phase) * 360 + 360) % 360;
        context.strokeStyle = "hsl(" + String(hue) + "deg 100% 60%)";
        context.beginPath();
        context.moveTo(start.x + inset, start.y + inset);
        context.lineTo(end.x + inset, end.y + inset);
        context.stroke();
      }
      rainbowCanvas.dataset.ready = "true";
    };

    const animateRainbow = (timestamp) => {
      if (
        !(rainbowCanvas instanceof HTMLCanvasElement)
        || !rainbowCanvas.isConnected
        || !(rainbowSurface instanceof HTMLElement)
        || rainbowSurface.getAttribute("data-codex-theme-rainbow-composer") !== "active"
      ) {
        stopRainbowAnimation();
        return;
      }
      if (timestamp - rainbowLastDrawTimestamp >= RAINBOW_FRAME_INTERVAL_MS) {
        drawRainbowFrame(timestamp);
        rainbowLastDrawTimestamp = timestamp;
      }
      rainbowAnimationFrame = requestAnimationFrame(animateRainbow);
    };

    const startRainbowAnimation = (surface) => {
      if (rainbowSurface === surface && rainbowCanvas?.isConnected && rainbowAnimationFrame) return;
      stopRainbowAnimation();
      const canvas = document.createElement("canvas");
      canvas.className = "codex-theme-rainbow-canvas";
      canvas.setAttribute("aria-hidden", "true");
      surface.appendChild(canvas);
      rainbowCanvas = canvas;
      rainbowSurface = surface;
      rainbowLastDrawTimestamp = -Infinity;
      rainbowMetricsKey = "";
      rainbowGeometryKey = "";
      rainbowSegments = [];
      rainbowAnimationFrame = requestAnimationFrame(animateRainbow);
    };

    const setSessionActive = (active) => {
      const value = active ? "true" : "false";
      if (document.documentElement.dataset.codexThemeSessionActive !== value) {
        document.documentElement.dataset.codexThemeSessionActive = value;
      }
    };

    const renderComposerActivity = () => {
      const surface = findComposerSurface();
      if (!(surface instanceof HTMLElement)) {
        if (
          rainbowSurface instanceof HTMLElement
          && rainbowSurface.isConnected
          && performance.now() < rainbowActiveUntil
        ) {
          setSessionActive(true);
          return;
        }
        for (const previous of document.querySelectorAll('[data-codex-theme-rainbow-composer]')) {
          previous.removeAttribute("data-codex-theme-rainbow-composer");
        }
        setSessionActive(false);
        stopRainbowAnimation();
        return;
      }
      for (const previous of document.querySelectorAll('[data-codex-theme-rainbow-composer]')) {
        if (previous !== surface) {
          previous.removeAttribute("data-codex-theme-rainbow-composer");
        }
      }
      const now = performance.now();
      const detectedActive = composerIsActive(surface);
      if (detectedActive) rainbowActiveUntil = now + RAINBOW_ACTIVE_GRACE_MS;
      const active = detectedActive || (rainbowSurface === surface && now < rainbowActiveUntil);
      if (!active) {
        rainbowActiveUntil = 0;
        setSessionActive(false);
        surface.removeAttribute("data-codex-theme-rainbow-composer");
        stopRainbowAnimation();
        return;
      }
      setSessionActive(true);
      surface.setAttribute("data-codex-theme-rainbow-composer", "active");
      startRainbowAnimation(surface);
    };

    let renderFrame = 0;
    let renderTimer = 0;
    const scheduleRender = () => {
      if (renderFrame || renderTimer) return;
      renderTimer = setTimeout(() => {
        renderTimer = 0;
        renderFrame = requestAnimationFrame(() => {
          renderFrame = 0;
          renderUsagePanel();
          renderServerLatencies();
          renderComposerActivity();
        });
      }, 100);
    };

    const install = () => {
      let style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
      }
      if (style.textContent !== CSS) style.textContent = CSS;
      document.documentElement.dataset.codexThemeWallpaper = "enabled";
      globalThis.__codexThemeUiObserver?.disconnect();
      const observer = new MutationObserver(scheduleRender);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-busy", "aria-label", "data-state", "data-status", "data-testid"],
      });
      globalThis.__codexThemeUiObserver = observer;
      clearInterval(globalThis.__codexThemeComposerTimer);
      globalThis.__codexThemeComposerTimer = setInterval(scheduleRender, 500);
      clearInterval(globalThis.__codexThemeUsageTimer);
      globalThis.__codexThemeUsageTimer = setInterval(refreshUsage, USAGE_REFRESH_MS);
      void refreshUsage();
      scheduleRender();
      return {
        installed: true,
        imageBytes: ${Buffer.byteLength(dataUrl, "utf8")},
        title: document.title,
        url: location.href,
      };
    };

    globalThis.__setCodexThemeUsage = (usage) => {
      if (usage != null) {
        state.usage = usage;
        try {
          localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(usage));
        } catch {}
      }
      scheduleRender();
    };
    globalThis.__setCodexThemeLatencies = (latencies) => {
      state.latencies = latencies || {};
      scheduleRender();
    };
    globalThis.__prepareCodexThemeUsageProbe = () => {
      const context = findProfileContext();
      if (context == null) return null;
      const profileState = context.profileButton.getAttribute("data-state");
      const expanded = context.profileButton.getAttribute("aria-expanded");
      if (profileState === "open" || expanded === "true") return { busy: true };
      document.documentElement.dataset.codexThemeUsageProbe = "true";
      const rect = context.profileButton.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      return {
        busy: false,
        profilePoint: point,
      };
    };
    globalThis.__collectCodexThemeUsageProbe = () => {
      const visibleSpans = Array.from(document.querySelectorAll("span"))
        .filter((element) => element.id !== USAGE_BADGE_ID && isVisible(element));
      for (const span of visibleSpans) {
        const rateLimits = findRateLimitsInReactTree(span);
        const rateLimitUsage = rateLimits == null
          ? null
          : usageFromRateLimits(rateLimits, Number.NaN);
        if (rateLimitUsage == null) continue;
        state.usage = rateLimitUsage;
        try {
          localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(rateLimitUsage));
        } catch {}
        scheduleRender();
        return { success: true };
      }

      const percentageElements = visibleSpans
        .filter((element) =>
          /^\\s*\\d{1,3}\\s*%\\s*$/.test(element.textContent || ""),
        );
      const bucketUsages = [];
      let submenuPoint = null;
      for (const percentageElement of percentageElements) {
        const displayedRemaining = Number.parseInt(percentageElement.textContent, 10);
        const rateLimits = findRateLimitsInReactTree(percentageElement);
        const rateLimitUsage = rateLimits == null
          ? null
          : usageFromRateLimits(rateLimits, displayedRemaining);
        if (rateLimitUsage != null) {
          state.usage = rateLimitUsage;
          try {
            localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(rateLimitUsage));
          } catch {}
          scheduleRender();
          return { success: true };
        }

        const bucket = findRateBucketInReactTree(percentageElement);
        if (bucket != null) {
          bucketUsages.push({
            remainingPercent: Math.round(
              Math.min(100, Math.max(0, 100 - bucket.usedPercent)),
            ),
            resetAtMs: Number.isFinite(bucket.resetsAt) ? bucket.resetsAt * 1000 : null,
            capturedAtMs: Date.now(),
            usedPercent: bucket.usedPercent,
            windowDurationMins: bucket.windowDurationMins || 0,
          });
        }

        if (submenuPoint == null) {
          const trigger = percentageElement.closest(
            '[role="menuitem"], [role="menuitemradio"], button',
          );
          if (trigger instanceof HTMLElement) {
            const rect = trigger.getBoundingClientRect();
            submenuPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
        }
      }
      if (bucketUsages.length > 0) {
        const usage = bucketUsages.reduce((current, candidate) => {
          if (candidate.usedPercent > current.usedPercent) return candidate;
          if (
            candidate.usedPercent === current.usedPercent
            && candidate.windowDurationMins > current.windowDurationMins
          ) {
            return candidate;
          }
          return current;
        });
        delete usage.usedPercent;
        delete usage.windowDurationMins;
        state.usage = usage;
        try {
          localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(usage));
        } catch {}
        scheduleRender();
        return { success: true };
      }
      return { success: false, submenuPoint };
    };
    globalThis.__finishCodexThemeUsageProbe = () => {
      delete document.documentElement.dataset.codexThemeUsageProbe;
      scheduleRender();
      return true;
    };
    globalThis.__installCodexThemeWallpaper = install;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
    return install();
  })()`;
}

class CdpPipe {
  constructor(child) {
    this.child = child;
    this.input = child.stdio[3];
    this.output = child.stdio[4];
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.eventHandler = undefined;

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
      }, 15_000);

      this.pending.set(id, { resolve, reject, timeout });
      this.input.write(`${JSON.stringify(message)}\0`);
    });
  }
}

function isCodexPage(targetInfo) {
  if (targetInfo.type !== "page") return false;
  const url = targetInfo.url ?? "";
  const title = targetInfo.title ?? "";
  if (/avatar-overlay|devtools:|chrome-extension:|web-sandbox/i.test(url)) return false;
  return /webview\/index\.html|app:\/\/|codex:\/\//i.test(url) || /^(Codex|ChatGPT)$/i.test(title);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const appExecutable = findAppExecutable();
  if (!appExecutable) throw new Error("/Applications에서 ChatGPT 또는 Codex 앱을 찾지 못했사옵니다.");
  if (!fs.existsSync(options.imagePath)) throw new Error(`배경 사진이 없사옵니다: ${options.imagePath}`);
  if (!fs.statSync(options.imagePath).isFile()) throw new Error(`배경 경로가 파일이 아니옵니다: ${options.imagePath}`);

  const extension = path.extname(options.imagePath).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(extension)) {
    throw new Error("배경은 JPEG 또는 PNG 파일이어야 하옵니다.");
  }

  console.log(`[wallpaper] 사진: ${options.imagePath}`);
  console.log(`[wallpaper] 앱: ${appExecutable}`);
  console.log(`[wallpaper] 전용 프로필: ${options.profilePath}`);

  if (options.dryRun) {
    console.log("[wallpaper] 검사 완료. 앱은 실행하지 않았사옵니다.");
    return;
  }

  fs.mkdirSync(options.profilePath, { recursive: true, mode: 0o700 });
  const usageCachePath = path.join(options.profilePath, "codex-theme-usage.json");
  const pinnedSshHosts = parsePinnedSshHosts(SSH_CONFIG_PATH);
  const source = wallpaperSource(imageDataUrl(options.imagePath), {
    rainbowPreview: options.inspectUi,
  });
  const childEnvironment = { ...process.env };
  if (options.skipRemoteSshBoot) childEnvironment.CODEX_SSH_SKIP_APP_SERVER_BOOT = "true";

  const child = spawn(
    appExecutable,
    [
      "--remote-debugging-pipe",
      `--user-data-dir=${options.profilePath}`,
      "--no-first-run",
    ],
    {
      env: childEnvironment,
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    },
  );

  let latencyTimer;
  const terminate = () => {
    if (latencyTimer) clearInterval(latencyTimer);
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
    if (signal) console.log(`[wallpaper] Codex가 ${signal} 신호로 종료되었사옵니다.`);
    else console.log(`[wallpaper] Codex가 종료되었사옵니다. 코드=${code ?? "unknown"}`);
    process.exit(code ?? 0);
  });

  const cdp = new CdpPipe(child);
  const sessions = new Map();
  const injecting = new Set();
  const usageRequests = new Map();
  const usageProbeTimers = new Map();
  const usageProbesInFlight = new Set();
  let latestUsage = readUsageCache(usageCachePath);
  let latestLatencies = Object.fromEntries(
    Object.keys(pinnedSshHosts).map((alias) => [alias, null]),
  );
  let screenshotCaptured = false;

  const pushUiState = async (sessionId) => {
    const expression = `(() => {
      globalThis.__setCodexThemeUsage?.(${JSON.stringify(latestUsage)});
      globalThis.__setCodexThemeLatencies?.(${JSON.stringify(latestLatencies)});
      return true;
    })()`;
    await cdp.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  };

  const broadcastUiState = async () => {
    await Promise.allSettled(Array.from(sessions.values()).map(pushUiState));
  };

  const evaluateValue = async (sessionId, expression) => {
    const result = await cdp.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "화면 상태 평가에 실패했사옵니다.");
    }
    return result.result?.value;
  };

  const dispatchTrustedClick = async (sessionId, point) => {
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 },
      sessionId,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 },
      sessionId,
    );
  };

  const scheduleTrustedUsageProbe = (targetId, sessionId, delayMs) => {
    if (usageProbeTimers.has(targetId)) return;
    const timer = setTimeout(() => {
      usageProbeTimers.delete(targetId);
      void runTrustedUsageProbe(targetId, sessionId);
    }, delayMs);
    usageProbeTimers.set(targetId, timer);
  };

  const runTrustedUsageProbe = async (targetId, sessionId) => {
    if (usageProbesInFlight.has(targetId) || sessions.get(targetId) !== sessionId) return;
    usageProbesInFlight.add(targetId);
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const prepared = await evaluateValue(
          sessionId,
          "globalThis.__prepareCodexThemeUsageProbe?.() ?? null",
        );
        if (prepared?.busy || prepared?.profilePoint == null) {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          continue;
        }

        await dispatchTrustedClick(sessionId, prepared.profilePoint);
        await new Promise((resolve) => setTimeout(resolve, 260));
        let collected = await evaluateValue(
          sessionId,
          "globalThis.__collectCodexThemeUsageProbe?.() ?? { success: false }",
        );
        if (!collected?.success && collected?.submenuPoint != null) {
          await cdp.send(
            "Input.dispatchMouseEvent",
            {
              type: "mouseMoved",
              x: collected.submenuPoint.x,
              y: collected.submenuPoint.y,
              button: "none",
              buttons: 0,
            },
            sessionId,
          );
          await new Promise((resolve) => setTimeout(resolve, 360));
          collected = await evaluateValue(
            sessionId,
            "globalThis.__collectCodexThemeUsageProbe?.() ?? { success: false }",
          );
        }
        await dispatchTrustedClick(sessionId, prepared.profilePoint);
        await evaluateValue(
          sessionId,
          "globalThis.__finishCodexThemeUsageProbe?.() ?? true",
        );
        if (collected?.success) return;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
    } catch (error) {
      console.error(`[wallpaper] 사용량 표시를 갱신하지 못했사옵니다: ${error.message}`);
      try {
        await evaluateValue(
          sessionId,
          "globalThis.__finishCodexThemeUsageProbe?.() ?? true",
        );
      } catch {}
    } finally {
      usageProbesInFlight.delete(targetId);
      if (sessions.get(targetId) === sessionId) {
        scheduleTrustedUsageProbe(targetId, sessionId, 60_000);
      }
    }
  };

  const refreshLatencies = async () => {
    latestLatencies = await measurePinnedSshLatencies(pinnedSshHosts);
    await broadcastUiState();
  };

  const captureUsageResponse = async (sessionId, requestId) => {
    try {
      const responseBody = await cdp.send("Network.getResponseBody", { requestId }, sessionId);
      const body = responseBody.base64Encoded
        ? Buffer.from(responseBody.body, "base64").toString("utf8")
        : responseBody.body;
      const usage = normalizeUsagePayload(JSON.parse(body));
      if (usage == null) return;
      latestUsage = usage;
      writeUsageCache(usageCachePath, usage);
      console.log(
        `[wallpaper] 사용량 갱신: ${usage.remainingPercent}% 남음`,
      );
      await broadcastUiState();
    } catch (error) {
      console.error(`[wallpaper] 사용량 응답을 읽지 못했사옵니다: ${error.message}`);
    }
  };

  const inject = async (targetInfo) => {
    if (!isCodexPage(targetInfo) || injecting.has(targetInfo.targetId)) return;
    injecting.add(targetInfo.targetId);
    try {
      let sessionId = sessions.get(targetInfo.targetId);
      if (!sessionId) {
        const attached = await cdp.send("Target.attachToTarget", {
          targetId: targetInfo.targetId,
          flatten: true,
        });
        sessionId = attached.sessionId;
        sessions.set(targetInfo.targetId, sessionId);
        await cdp.send("Page.enable", {}, sessionId);
        await cdp.send("Runtime.enable", {}, sessionId);
        await cdp.send("Network.enable", {}, sessionId);
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source }, sessionId);
      }

      const result = await cdp.send(
        "Runtime.evaluate",
        {
          expression: source,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );

      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "주입 중 예외가 발생했사옵니다.");
      }
      await pushUiState(sessionId);
      console.log(`[wallpaper] 적용 완료: ${targetInfo.title || targetInfo.url || targetInfo.targetId}`);

      if (options.inspectUi) {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        const inspection = await cdp.send(
          "Runtime.evaluate",
          {
            expression: `(() => {
              const panel = document.querySelector(".app-shell-left-panel");
              const scroll = panel?.querySelector("[data-app-action-sidebar-scroll]");
              const rectOf = (element) => {
                const rect = element.getBoundingClientRect();
                return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
              };
              const outsideButtons = panel == null ? [] : Array.from(panel.querySelectorAll("button"))
                .filter((button) => !scroll?.contains(button))
                .map((button) => ({
                  aria: button.getAttribute("aria-label"),
                  className: button.className,
                  text: button.textContent?.trim(),
                  rect: rectOf(button),
                  toolbarClass: button.closest(".h-toolbar")?.className ?? null,
                }));
              const aliases = [];
              if (scroll) {
                const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                  const value = node.nodeValue?.trim() ?? "";
                  if (/^(VPN|Proxmox|Homelab|Oracle[_-]Seoul)$/i.test(value)) {
                    aliases.push({ value, parentClass: node.parentElement?.className ?? null, rect: node.parentElement ? rectOf(node.parentElement) : null });
                  }
                }
              }
              return {
                panel: panel ? rectOf(panel) : null,
                scroll: scroll ? rectOf(scroll) : null,
                usageState: globalThis.__codexThemeUiState?.usage ?? null,
                usageBadge: document.getElementById("codex-theme-usage-badge")?.outerHTML ?? null,
                usageRainbow: (() => {
                  const fill = document.querySelector("#codex-theme-usage-panel .codex-theme-usage-fill");
                  const pseudoStyle = fill ? getComputedStyle(fill, "::before") : null;
                  return fill ? {
                    sessionActive: document.documentElement.dataset.codexThemeSessionActive ?? null,
                    width: getComputedStyle(fill).width,
                    animationName: pseudoStyle?.animationName ?? null,
                    animationDuration: pseudoStyle?.animationDuration ?? null,
                    animationPlayState: pseudoStyle?.animationPlayState ?? null,
                    opacity: pseudoStyle?.opacity ?? null,
                    transitionDuration: pseudoStyle?.transitionDuration ?? null,
                    transform: pseudoStyle?.transform ?? null,
                  } : null;
                })(),
                rainbowComposer: (() => {
                  const composer = document.querySelector('[data-codex-theme-rainbow-composer="active"]');
                  const canvas = composer?.querySelector(".codex-theme-rainbow-canvas");
                  const canvasStyle = canvas ? getComputedStyle(canvas) : null;
                  return composer ? {
                    tag: composer.tagName,
                    className: composer.className,
                    rect: rectOf(composer),
                    canvasCount: composer.querySelectorAll(".codex-theme-rainbow-canvas").length,
                    canvas: canvas ? {
                      rect: rectOf(canvas),
                      ready: canvas.dataset.ready ?? null,
                      contain: canvasStyle?.contain ?? null,
                      filter: canvasStyle?.filter ?? null,
                      opacity: canvasStyle?.opacity ?? null,
                      transitionDuration: canvasStyle?.transitionDuration ?? null,
                    } : null,
                  } : null;
                })(),
                mainSurfaces: Array.from(document.querySelectorAll('[data-app-shell-main-surface], [class*="_MainContentSurface_"]'))
                  .map((surface) => ({ tag: surface.tagName, className: surface.className, rect: rectOf(surface) })),
                outsideButtons,
                aliases,
                usageResources: performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/wham/usage")),
              };
            })()`,
            returnByValue: true,
          },
          sessionId,
        );
        console.log(`[wallpaper] UI 진단: ${JSON.stringify(inspection.result?.value ?? null)}`);
      }

      if (options.screenshotPath && !screenshotCaptured) {
        screenshotCaptured = true;
        if (!options.inspectUi) await new Promise((resolve) => setTimeout(resolve, 2_500));
        const screenshot = await cdp.send(
          "Page.captureScreenshot",
          { format: "png", fromSurface: true },
          sessionId,
        );
        fs.mkdirSync(path.dirname(options.screenshotPath), { recursive: true });
        fs.writeFileSync(options.screenshotPath, Buffer.from(screenshot.data, "base64"));
        console.log(`[wallpaper] 검증 화면 저장: ${options.screenshotPath}`);
        if (options.exitAfterScreenshot) setTimeout(terminate, 100);
      }
    } catch (error) {
      console.error(`[wallpaper] 적용 재시도 예정: ${error.message}`);
      sessions.delete(targetInfo.targetId);
      setTimeout(() => void inject(targetInfo), 1_000);
    } finally {
      injecting.delete(targetInfo.targetId);
    }
  };

  cdp.eventHandler = async (message) => {
    if (message.method === "Target.targetCreated" || message.method === "Target.targetInfoChanged") {
      await inject(message.params.targetInfo);
    } else if (message.method === "Network.responseReceived" && message.sessionId) {
      const responseUrl = message.params.response?.url ?? "";
      if (/\/wham\/usage(?:[?#]|$)/.test(responseUrl)) {
        usageRequests.set(`${message.sessionId}:${message.params.requestId}`, {
          requestId: message.params.requestId,
          sessionId: message.sessionId,
        });
      }
    } else if (message.method === "Network.loadingFinished" && message.sessionId) {
      const key = `${message.sessionId}:${message.params.requestId}`;
      const usageRequest = usageRequests.get(key);
      if (usageRequest) {
        usageRequests.delete(key);
        await captureUsageResponse(usageRequest.sessionId, usageRequest.requestId);
      }
    } else if (message.method === "Network.loadingFailed" && message.sessionId) {
      usageRequests.delete(`${message.sessionId}:${message.params.requestId}`);
    } else if (message.method === "Target.targetDestroyed") {
      const sessionId = sessions.get(message.params.targetId);
      const usageProbeTimer = usageProbeTimers.get(message.params.targetId);
      if (usageProbeTimer) clearTimeout(usageProbeTimer);
      usageProbeTimers.delete(message.params.targetId);
      usageProbesInFlight.delete(message.params.targetId);
      sessions.delete(message.params.targetId);
      injecting.delete(message.params.targetId);
      if (sessionId) {
        for (const key of usageRequests.keys()) {
          if (key.startsWith(`${sessionId}:`)) usageRequests.delete(key);
        }
      }
    }
  };

  await cdp.send("Target.setDiscoverTargets", { discover: true });
  const { targetInfos = [] } = await cdp.send("Target.getTargets");
  await Promise.all(targetInfos.map(inject));
  void refreshLatencies();
  latencyTimer = setInterval(() => void refreshLatencies(), LATENCY_REFRESH_MS);
  console.log("[wallpaper] 실행기를 닫으면 이 전용 Codex 인스턴스도 함께 종료되옵니다.");
}

main().catch((error) => {
  console.error(`[wallpaper] ${error.message}`);
  process.exitCode = 1;
});
