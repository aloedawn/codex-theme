export function installPageRuntime(initialConfig) {
  const RUNTIME_KEY = "__codexThemeRuntime";
  const requestedVersion = Number(initialConfig?.version) || 1;
  const existing = globalThis[RUNTIME_KEY];
  if (existing?.version === requestedVersion) {
    return existing.install(initialConfig);
  }

  let retainedState = null;
  try {
    retainedState = existing?.dispose?.({ preserveStyle: true }) ?? null;
  } catch {}

  globalThis.__codexThemeUiObserver?.disconnect?.();
  clearInterval(globalThis.__codexThemeComposerTimer);
  clearInterval(globalThis.__codexThemeUsageTimer);
  try {
    globalThis.__codexThemeDisposeThumbFire?.();
  } catch {}
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
    const USAGE_REFRESH_MS = 60 * 1_000;
    const ACTIVITY_REFRESH_MS = 500;
    const RAINBOW_FRAME_INTERVAL_MS = 1_000 / 30;
    const RAINBOW_ACTIVE_GRACE_MS = Number(startingConfig?.timings?.rainbowGraceMs) || 900;
    const USAGE_ACTIVITY_GRACE_MS = Number(startingConfig?.timings?.usageGraceMs) || 1_200;
    const FIRE_FRAME_INTERVAL_MS = 250;
    const THUMB_FIRE_GROWTH_DURATION_MS = 5 * 60 * 1_000;
    const WALLPAPER_IMAGE_WIDTH = 2662;
    const WALLPAPER_IMAGE_HEIGHT = 1776;
    const THUMB_FIRE_POINTS = [
      { side: "left", x: 404, y: 1180 },
      { side: "right", x: 2370, y: 1174 },
    ];
    const RELEVANT_STRUCTURE_SELECTOR = [
      ".app-shell-left-panel",
      "[data-app-action-sidebar-scroll]",
      "[data-app-action-sidebar-thread-row]",
      "[data-app-action-sidebar-project-row]",
      "[data-app-shell-main-surface]",
      "[class*=\"_MainContentSurface_\"]",
      "textarea",
      "[contenteditable=\"true\"][role=\"textbox\"]",
      "[contenteditable=\"true\"][data-placeholder]",
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
      latencies: retained?.latencies && typeof retained.latencies === "object"
        ? retained.latencies
        : {},
      usageError: null,
    };
    const sessionStarts = retained?.sessionStarts && typeof retained.sessionStarts === "object"
      ? retained.sessionStarts
      : Object.create(null);
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
    };

    loadCachedUsage();

    const runtime = {
      version: Number(startingConfig?.version) || 1,
      install,
      updateState,
      refresh,
      inspect,
      dispose,
    };
    return runtime;

    function loadCachedUsage() {
      if (uiState.usage != null) return;
      try {
        const cached = JSON.parse(localStorage.getItem(USAGE_CACHE_KEY) || "null");
        const cacheIsFresh = Number.isFinite(cached?.capturedAtMs)
          && Date.now() - cached.capturedAtMs <= 6 * 60 * 60 * 1_000;
        const resetIsValid = !Number.isFinite(cached?.resetAtMs)
          || cached.resetAtMs > Date.now();
        if (cacheIsFresh && resetIsValid) uiState.usage = cached;
      } catch {}
    }

    function isVisible(element) {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function isOwnedNode(node) {
      const element = node instanceof Element ? node : node?.parentElement;
      if (!(element instanceof Element)) return false;
      return element.id === STYLE_ID
        || element.hasAttribute(OWNED_ATTRIBUTE)
        || element.closest(`[${OWNED_ATTRIBUTE}="true"]`) != null;
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
      return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
        && Object.is(left[key], right[key]));
    }

    function usageEqual(left, right) {
      return left === right || (
        left != null
        && right != null
        && left.remainingPercent === right.remainingPercent
        && left.resetAtMs === right.resetAtMs
        && left.resetLabel === right.resetLabel
        && left.capturedAtMs === right.capturedAtMs
      );
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
        capturedAtMs: Date.now(),
      };
    }

    function fetchUsagePayload() {
      return new Promise((resolve, reject) => {
        const bridge = globalThis.electronBridge;
        if (typeof bridge?.sendMessageFromView !== "function") {
          reject(new Error("앱 요청 통로를 찾지 못했사옵니다"));
          return;
        }
        const requestId = globalThis.crypto?.randomUUID?.()
          || `codex-theme-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
        }, 10_000);
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
    }

    async function refreshUsage() {
      if (disposed || usageFetchInFlight) return usageFetchInFlight;
      usageFetchInFlight = (async () => {
        try {
          const usage = normalizeUsagePayload(await fetchUsagePayload());
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
          remainingPercent: 0,
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
          timeStyle: "short",
        }).format(resetDate);
      }
      return {
        value: `${usage.remainingPercent}% 残り`,
        reset: resetLabel,
        title: resetTitle
          ? `使用量 ${usage.remainingPercent}% 残り · ${resetTitle}リセット`
          : `使用量 ${usage.remainingPercent}% 残り`,
        remainingPercent: Math.min(100, Math.max(0, usage.remainingPercent)),
      };
    }

    function findProfileContext() {
      const panel = document.querySelector(".app-shell-left-panel");
      if (!(panel instanceof HTMLElement)) return null;
      const scroll = panel.querySelector("[data-app-action-sidebar-scroll]");
      const profileButtons = Array.from(panel.querySelectorAll("button.sidebar-item"))
        .filter((button) => !scroll?.contains(button) && isVisible(button))
        .sort((left, right) => (
          right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom
        ));
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
          "</div>",
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
        { x: 12.4, y: 2, width: 2.5, height: 13 },
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
      while ((textNode = walker.nextNode())) {
        if (textNode.nodeValue?.trim().toLocaleLowerCase() !== normalizedAlias) continue;
        const parent = textNode.parentElement;
        if (!(parent instanceof HTMLElement) || isOwnedNode(parent) || !isVisible(parent)) continue;
        const rect = parent.getBoundingClientRect();
        if (rect.left < panelRect.left + panelRect.width * 0.38) continue;
        matches.push(parent);
      }
      matches.sort((left, right) => (
        right.getBoundingClientRect().left - left.getBoundingClientRect().left
      ));
      return matches[0] ?? null;
    }

    function renderServerLatencies() {
      const panel = document.querySelector(".app-shell-left-panel");
      const scroll = panel?.querySelector("[data-app-action-sidebar-scroll]");
      if (!(panel instanceof HTMLElement) || !(scroll instanceof HTMLElement)) return;

      const latencies = uiState.latencies || {};
      const panelRect = panel.getBoundingClientRect();
      const desiredSignals = new Set();
      const desiredNativeStatuses = new Set();
      const existingSignals = new Map(
        Array.from(scroll.querySelectorAll(".codex-theme-server-signal"))
          .filter((signal) => signal instanceof HTMLElement)
          .map((signal) => [signal.dataset.hostAlias, signal]),
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
        const description = roundedLatency == null
          ? "未接続、信号 0/4"
          : `応答 ${roundedLatency}ミリ秒、信号 ${barCount}/4`;
        setAttributeIfChanged(signal, "aria-label", description);
        if (signal.title !== description) signal.title = description;
      }

      for (const signal of existingSignals.values()) {
        if (!desiredSignals.has(signal)) signal.remove();
      }
      for (const nativeStatus of scroll.querySelectorAll(
        '[data-codex-theme-native-server-status="true"]',
      )) {
        if (!desiredNativeStatuses.has(nativeStatus)) {
          removeAttributeIfPresent(nativeStatus, "data-codex-theme-native-server-status");
        }
      }
    }

    function findComposerSurface() {
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
        composerSurface instanceof HTMLElement
        && composerSurface.isConnected
        && isVisible(composerSurface)
        && composerSurface.contains(editor)
      ) {
        return composerSurface;
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
    }

    function composerIsActive(surface) {
      if (!(surface instanceof HTMLElement)) return false;
      if (config.rainbowPreview) return true;
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
      return surface.querySelector(
        '[aria-busy="true"], [data-state="streaming"], [data-status="running"]',
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
      let cursor = ((distance % perimeter) + perimeter) % perimeter;
      if (cursor <= horizontal) return { x: radius + cursor, y: 0 };
      cursor -= horizontal;
      if (cursor <= arc) {
        const angle = -Math.PI / 2 + cursor / radius;
        return { x: width - radius + Math.cos(angle) * radius, y: radius + Math.sin(angle) * radius };
      }
      cursor -= arc;
      if (cursor <= vertical) return { x: width, y: radius + cursor };
      cursor -= vertical;
      if (cursor <= arc) {
        const angle = cursor / radius;
        return { x: width - radius + Math.cos(angle) * radius, y: height - radius + Math.sin(angle) * radius };
      }
      cursor -= arc;
      if (cursor <= horizontal) return { x: width - radius - cursor, y: height };
      cursor -= horizontal;
      if (cursor <= arc) {
        const angle = Math.PI / 2 + cursor / radius;
        return { x: radius + Math.cos(angle) * radius, y: height - radius + Math.sin(angle) * radius };
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
          height / 2,
        );
        composerMetricsKey = metricsKey;
      }
      const radius = composerRadius;
      const horizontal = Math.max(0, width - radius * 2);
      const vertical = Math.max(0, height - radius * 2);
      const perimeter = horizontal * 2 + vertical * 2 + Math.PI * radius * 2;
      const segmentCount = Math.min(720, Math.max(360, Math.ceil(perimeter / 3)));
      const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const duration = reducedMotion ? 8_000 : 2_400;
      const phase = (timestamp % duration) / duration;
      const geometryKey = `${metricsKey}:${Math.round(radius * 10)}:${segmentCount}`;
      if (composerGeometryKey !== geometryKey) {
        composerGeometryKey = geometryKey;
        composerSegments = Array.from({ length: segmentCount }, (_, index) => ({
          start: pointOnRoundedRect(perimeter * index / segmentCount, width, height, radius),
          end: pointOnRoundedRect(perimeter * (index + 1.5) / segmentCount, width, height, radius),
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
      if (
        disposed
        || !composerActive
        || !(composerCanvas instanceof HTMLCanvasElement)
        || !composerCanvas.isConnected
        || !(composerSurface instanceof HTMLElement)
      ) {
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
          active ? "true" : "false",
        );
      }
      if (active) startComposerAnimation();
      else stopComposerAnimation();
    }

    function findMainSurface() {
      return Array.from(document.querySelectorAll(
        '[data-app-shell-main-surface], [class*="_MainContentSurface_"]',
      ))
        .filter((surface) => surface instanceof HTMLElement && isVisible(surface))
        .sort((left, right) => {
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
      if (
        !(fireSurface instanceof HTMLElement)
        || (
          fireLayer?.isConnected
          && fireImages.length === THUMB_FIRE_POINTS.length
          && fireImages.every((fire) => fire.image.isConnected)
        )
      ) {
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
      if (
        !(fireSurface instanceof HTMLElement)
        || !(fireLayer instanceof HTMLElement)
        || !isVisible(fireSurface)
      ) {
        return false;
      }
      const surfaceRect = fireSurface.getBoundingClientRect();
      const scale = Math.max(
        surfaceRect.width / WALLPAPER_IMAGE_WIDTH,
        surfaceRect.height / WALLPAPER_IMAGE_HEIGHT,
      );
      const imageWidth = WALLPAPER_IMAGE_WIDTH * scale;
      const imageHeight = WALLPAPER_IMAGE_HEIGHT * scale;
      const imageOffsetX = (surfaceRect.width - imageWidth) / 2;
      const imageOffsetY = (surfaceRect.height - imageHeight) / 2;
      const baseWidth = Math.max(72, Math.min(112, 160 * scale));
      const baseHeight = Math.max(118, Math.min(180, 255 * scale));
      const elapsedMs = fireActive && fireActiveStartedAt > 0
        ? Math.max(0, Date.now() - fireActiveStartedAt)
        : 0;
      const growthStepCount = Math.max(1, Math.round(THUMB_FIRE_GROWTH_DURATION_MS / 1_000));
      const growthStep = Math.min(growthStepCount, Math.floor(elapsedMs / 1_000));
      const growthProgress = growthStep / growthStepCount;
      const easedGrowth = Math.pow(growthProgress, 0.72);
      const secondPhase = (elapsedMs % 1_000) / 1_000;
      const secondPulse = Math.sin(secondPhase * Math.PI);
      const pulseScaleX = 1 + secondPulse * (0.035 + growthProgress * 0.075);
      const pulseScaleY = 1 + secondPulse * (0.025 + growthProgress * 0.055);
      const previousCanvasWidth = baseWidth * 2;
      const previousCanvasHeight = baseHeight * 2.35;
      const maximumScaleX = Math.max(1, surfaceRect.width * 0.9 / previousCanvasWidth);
      const maximumScaleY = Math.max(1, surfaceRect.height * 1.12 / previousCanvasHeight);
      const transformScaleX = (
        (1 + easedGrowth)
        * (1 + easedGrowth * (maximumScaleX - 1))
        * pulseScaleX
      );
      const transformScaleY = (
        (1 + easedGrowth * 1.35)
        * (1 + easedGrowth * (maximumScaleY - 1))
        * pulseScaleY
      );

      for (const fire of fireImages) {
        const anchorX = imageOffsetX + fire.point.x * scale;
        const anchorY = imageOffsetY + fire.point.y * scale;
        setStylePropertyIfChanged(
          fire.image,
          "left",
          `${Math.round((anchorX - baseWidth / 2) * 10) / 10}px`,
        );
        setStylePropertyIfChanged(
          fire.image,
          "top",
          `${Math.round((anchorY - baseHeight) * 10) / 10}px`,
        );
        setStylePropertyIfChanged(fire.image, "width", `${Math.round(baseWidth * 10) / 10}px`);
        setStylePropertyIfChanged(fire.image, "height", `${Math.round(baseHeight * 10) / 10}px`);
        setStylePropertyIfChanged(
          fire.image,
          "--codex-theme-fire-scale-x",
          String(transformScaleX),
        );
        setStylePropertyIfChanged(
          fire.image,
          "--codex-theme-fire-scale-y",
          String(transformScaleY),
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
        "[data-app-action-sidebar-thread-row]",
      )).filter((row) => row instanceof HTMLElement);
      const currentThread = threadRows.find(
        (row) => row.dataset.appActionSidebarThreadActive === "true",
      ) || threadRows.find((row) => row.getAttribute("aria-current") === "page");
      if (currentThread instanceof HTMLElement) {
        const threadId = currentThread.dataset.appActionSidebarThreadId;
        const projectList = currentThread.closest("[data-app-action-sidebar-project-list-id]");
        const projectId = projectList instanceof HTMLElement
          ? projectList.dataset.appActionSidebarProjectListId
          : null;
        if (threadId) {
          return { key: `thread:${threadId}`, fallbackKey: projectId ? `project:${projectId}` : null };
        }
      }
      const projectRows = Array.from(document.querySelectorAll(
        "[data-app-action-sidebar-project-row]",
      )).filter((row) => row instanceof HTMLElement);
      const currentProject = projectRows.find((row) => row.getAttribute("aria-current") === "page");
      const projectId = currentProject?.dataset.appActionSidebarProjectId;
      if (projectId) return { key: `project:${projectId}`, fallbackKey: null };
      return { key: "view:unkeyed", fallbackKey: null };
    }

    function pruneSessionStarts() {
      const entries = Object.entries(sessionStarts)
        .filter((entry) => Number.isFinite(entry[1]))
        .sort((left, right) => right[1] - left[1]);
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
      return row.querySelector('[aria-label="Subscribed: active"]') != null
        || Array.from(row.querySelectorAll('.animate-spin, [style*="animation-duration"]'))
          .some((element) => {
            if (!(element instanceof HTMLElement)) return false;
            const duration = element.style.animationDuration;
            const statusContainer = element.parentElement;
            return element.querySelector("svg") != null
              && (
                duration === "2000ms"
                || (
                  element.classList.contains("animate-spin")
                  && statusContainer?.classList.contains("text-token-foreground/70") === true
                )
              );
          });
    }

    function activeSidebarSessionRows() {
      const seenThreadIds = new Set();
      return Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-row]"))
        .filter((row) => {
          if (!(row instanceof HTMLElement) || !rowHasActiveSessionIndicator(row)) return false;
          const threadId = row.dataset.appActionSidebarThreadId;
          if (!threadId) return true;
          if (seenThreadIds.has(threadId)) return false;
          seenThreadIds.add(threadId);
          return true;
        });
    }

    function activeCollapsedProjectRows() {
      const seenProjectIds = new Set();
      return Array.from(document.querySelectorAll(
        '[data-app-action-sidebar-project-row][data-app-action-sidebar-project-collapsed="true"]',
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
      const activeThreadIds = new Set();
      for (const row of activeThreadRows) {
        const threadId = row.dataset.appActionSidebarThreadId;
        if (!threadId) continue;
        activeThreadIds.add(threadId);
        const threadKey = `thread:${threadId}`;
        const projectList = row.closest("[data-app-action-sidebar-project-list-id]");
        const projectId = projectList instanceof HTMLElement
          ? projectList.dataset.appActionSidebarProjectListId
          : null;
        const projectKey = projectId ? `project:${projectId}` : null;
        const inheritedStart = Number.isFinite(sessionStarts[threadKey])
          ? sessionStarts[threadKey]
          : projectKey && Number.isFinite(sessionStarts[projectKey])
            ? sessionStarts[projectKey]
            : now;
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
        if (
          threadId
          && !activeThreadIds.has(threadId)
          && row.dataset.appActionSidebarThreadActive !== "true"
        ) {
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
      const currentComposerActive = detectedComposerActive
        || (composerSurface instanceof HTMLElement && now < composerActiveUntil);
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
      const currentIdentityIsActive = activeThreadRows.some((row) => (
        identity.key === `thread:${row.dataset.appActionSidebarThreadId}`
      )) || activeProjectRows.some((row) => (
        identity.key === `project:${row.dataset.appActionSidebarProjectId}`
      ));
      setFireActive(currentComposerActive || currentIdentityIsActive, identity);
      activityState = {
        currentComposerActive,
        sidebarActive,
        sidebarActiveCount: activeThreadRows.length,
        sidebarThreadIds: activeThreadRows
          .map((row) => row.dataset.appActionSidebarThreadId || null)
          .filter(Boolean),
        collapsedProjectActive,
        collapsedProjectActiveCount: activeProjectRows.length,
        collapsedProjectIds: activeProjectRows
          .map((row) => row.dataset.appActionSidebarProjectId || null)
          .filter(Boolean),
        active: usageActive,
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
      return element.matches(RELEVANT_STRUCTURE_SELECTOR)
        || element.querySelector(RELEVANT_STRUCTURE_SELECTOR) != null;
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
      if (
        target instanceof Element
        && composerSurface instanceof HTMLElement
        && (composerSurface.contains(target) || target.contains(composerSurface))
      ) {
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
        attributeFilter: ["aria-busy", "aria-label", "data-state", "data-status", "data-testid"],
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
        runtime: inspect(),
      };
    }

    function updateState(nextState) {
      if (disposed || nextState == null || typeof nextState !== "object") return false;
      let changed = false;
      if (
        Object.prototype.hasOwnProperty.call(nextState, "usage")
        && nextState.usage != null
        && !usageEqual(uiState.usage, nextState.usage)
      ) {
        uiState.usage = nextState.usage;
        uiState.usageError = null;
        try {
          localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(nextState.usage));
        } catch {}
        changed = true;
      }
      if (
        Object.prototype.hasOwnProperty.call(nextState, "latencies")
        && !shallowEqualObject(uiState.latencies, nextState.latencies || {})
      ) {
        uiState.latencies = { ...(nextState.latencies || {}) };
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
        `#${USAGE_PANEL_ID} .codex-theme-usage-fill`,
      );
      const canvas = composerCanvas;
      return {
        version: runtime.version,
        installed,
        disposed,
        diagnostics: { ...diagnostics },
        resources: {
          observer: observer != null,
          activityTimer: activityTimer !== 0,
          usageTimer: usageTimer !== 0,
          composerAnimationFrame: composerAnimationFrame !== 0,
          fireTimer: fireTimer !== 0,
        },
        nodes: {
          usagePanels: document.querySelectorAll(`#${USAGE_PANEL_ID}`).length,
          composerCanvases: document.querySelectorAll(".codex-theme-rainbow-canvas").length,
          fireLayers: document.querySelectorAll(".codex-theme-thumb-fire-layer").length,
          fireImages: document.querySelectorAll(".codex-theme-thumb-fire").length,
          serverSignals: document.querySelectorAll(".codex-theme-server-signal").length,
        },
        usage: {
          value: uiState.usage,
          clipRight: fill instanceof HTMLElement
            ? fill.style.getPropertyValue("--codex-theme-usage-clip-right")
            : null,
          layoutWidth: fill instanceof HTMLElement ? fill.style.width : null,
        },
        activity: activityState,
        composer: {
          attached: composerSurface instanceof HTMLElement && composerSurface.isConnected,
          active: composerActive,
          ready: canvas?.dataset.ready === "true",
          segmentCount: Number(canvas?.dataset.segmentCount) || 0,
        },
        fire: {
          attached: fireLayer instanceof HTMLElement && fireLayer.isConnected,
          active: fireActive,
          sessionKey: fireCurrentSessionKey,
          elapsedMs: fireActiveStartedAt > 0 ? Math.max(0, Date.now() - fireActiveStartedAt) : 0,
          retainedSessionCount: Object.keys(sessionStarts).length,
        },
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
        '[data-codex-theme-native-server-status="true"]',
      )) {
        removeAttributeIfPresent(nativeStatus, "data-codex-theme-native-server-status");
      }
      removeAttributeIfPresent(document.documentElement, "data-codex-theme-session-active");
      if (!preserveStyle) {
        document.getElementById(STYLE_ID)?.remove();
        removeAttributeIfPresent(document.documentElement, "data-codex-theme-wallpaper");
      }
      if (globalThis[RUNTIME_KEY] === runtime) delete globalThis[RUNTIME_KEY];
      return { usage: uiState.usage, latencies: uiState.latencies, sessionStarts };
    }
  }
}
