import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PROFILE_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Codex Theme",
);

export const SSH_CONFIG_PATH = path.join(os.homedir(), ".ssh", "config");
export const PINNED_SSH_ALIASES = new Set([
  "VPN",
  "Proxmox",
  "Homelab",
  "Oracle_seoul",
  "Oracle_osaka",
  "Oracle_chuncheon",
]);
export const LATENCY_REFRESH_MS = 15_000;
const LATENCY_TIMEOUT_MS = 2_000;

const APP_CANDIDATES = [
  "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
  "/Applications/Codex.app/Contents/MacOS/Codex",
];

export function parseArguments(argv, projectPath) {
  const options = {
    imagePath: path.join(projectPath, "image.jpg"),
    firePath: path.join(projectPath, "fire.gif"),
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

export function printHelp() {
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

export function findAppExecutable() {
  return APP_CANDIDATES.find((candidate) => fs.existsSync(candidate));
}

export function validateAssets(options) {
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

export function assetDataUrl(assetPath) {
  const extension = path.extname(assetPath).toLowerCase();
  const mimeTypes = {
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  const mimeType = mimeTypes[extension];
  if (mimeType == null) throw new Error(`지원하지 않는 이미지 형식이옵니다: ${extension}`);
  return `data:${mimeType};base64,${fs.readFileSync(assetPath).toString("base64")}`;
}

export function parsePinnedSshHosts(configPath) {
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

export async function measurePinnedSshLatencies(hosts) {
  const entries = await Promise.all(
    Object.entries(hosts).map(async ([alias, host]) => [alias, await measureTcpLatency(host)]),
  );
  return Object.fromEntries(entries);
}

export function normalizeUsagePayload(payload, capturedAtMs = Date.now()) {
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
      ? limitingWindow.resetAtSeconds * 1_000
      : null,
    capturedAtMs,
  };
}

export function readUsageCache(cachePath) {
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

export function writeUsageCache(cachePath, usage) {
  try {
    fs.writeFileSync(cachePath, `${JSON.stringify(usage)}\n`, { mode: 0o600 });
  } catch (error) {
    console.error(`[wallpaper] 사용량 캐시를 저장하지 못했사옵니다: ${error.message}`);
  }
}
