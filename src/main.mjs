#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CdpPipe } from "./host/cdp-pipe.mjs";
import {
  LATENCY_REFRESH_MS,
  SSH_CONFIG_PATH,
  assetDataUrl,
  findAppExecutable,
  measurePinnedSshLatencies,
  normalizeUsagePayload,
  parseArguments,
  parsePinnedSshHosts,
  printHelp,
  readUsageCache,
  validateAssets,
  writeUsageCache,
} from "./host/support.mjs";
import { TargetController } from "./host/target-controller.mjs";
import { createPageSource } from "./page/source.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.basename(scriptDirectory) === "src"
  ? path.dirname(scriptDirectory)
  : scriptDirectory;

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

  fs.mkdirSync(options.profilePath, { recursive: true, mode: 0o700 });
  const usageCachePath = path.join(options.profilePath, "codex-theme-usage.json");
  const pinnedSshHosts = parsePinnedSshHosts(SSH_CONFIG_PATH);
  const source = createPageSource(assetDataUrl(options.imagePath), assetDataUrl(options.firePath), {
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
  const usageRequests = new Map();
  let latestUsage = readUsageCache(usageCachePath);
  let latestLatencies = Object.fromEntries(
    Object.keys(pinnedSshHosts).map((alias) => [alias, null]),
  );
  let screenshotCaptured = false;

  const pushUiState = async (sessionId) => {
    const expression = `globalThis.__codexThemeRuntime?.updateState(${JSON.stringify({
      usage: latestUsage,
      latencies: latestLatencies,
    })}) ?? false`;
    const result = await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      sessionId,
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
        returnByValue: true,
      },
      sessionId,
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
      sessionId,
    );
    fs.mkdirSync(path.dirname(options.screenshotPath), { recursive: true });
    fs.writeFileSync(options.screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.log(`[wallpaper] 검증 화면 저장: ${options.screenshotPath}`);
    if (options.exitAfterScreenshot) setTimeout(terminate, 100);
  };

  const onReady = async ({ sessionId }) => {
    if (options.inspectUi || options.screenshotPath) {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
    if (options.inspectUi) await inspectUi(sessionId);
    await captureScreenshot(sessionId);
  };

  controller = new TargetController({
    cdp,
    source,
    pushUiState,
    onReady,
  });

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
    if (
      message.method === "Page.loadEventFired"
      && message.sessionId
      && controller.targetIdForSession(message.sessionId)
    ) {
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
          sessionId: message.sessionId,
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
