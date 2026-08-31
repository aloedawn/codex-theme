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
    const QUICK_CHAT_BUTTON_ID = "codex-theme-chat-quick-chat";
    const OWNED_ATTRIBUTE = "data-codex-theme-owned";
    const USAGE_CACHE_KEY = "codex-theme-usage-cache";
    const USAGE_REFRESH_MS = 60 * 1_000;
    const ACTIVITY_REFRESH_MS = 500;
    const CHAT_TURN_DIFF_REFRESH_MS = 1_000;
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
      "[data-composer-surface-variant]",
      "[data-codex-composer]",
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
    let chatTurnDiffTimer = 0;
    let nativeTurnDiffRuntime = null;
    let nativeTurnDiffRuntimePromise = null;
    let nativeTurnDiffRenderInFlight = false;
    let nativeTurnDiffRenderRequested = false;
    let nativeTurnDiffLastError = null;
    const nativeTurnDiffRoots = new Map();
    const workCommandSummaryNodes = new Map();
    const workTechnicalDetailNodes = new Map();
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
      quickChatOpenErrors: 0,
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
      const rateLimits = [
        payload?.rate_limit,
        ...(Array.isArray(payload?.additional_rate_limits)
          ? payload.additional_rate_limits.map((limit) => limit?.rate_limit)
          : []),
      ].filter((rateLimit) => rateLimit != null && typeof rateLimit === "object");
      const windows = rateLimits
        .flatMap((rateLimit) => [rateLimit.primary_window, rateLimit.secondary_window])
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
          reject(new Error("앱 요청 통로를 찾지 못했습니다"));
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

    function findSidebarFooterContext() {
      const panel = document.querySelector(".app-shell-left-panel");
      if (!(panel instanceof HTMLElement)) return null;
      const scroll = panel.querySelector("[data-app-action-sidebar-scroll]");
      if (!(scroll instanceof HTMLElement)) return null;
      const profileButtons = Array.from(panel.querySelectorAll("button.sidebar-item"))
        .filter((button) => !scroll.contains(button) && isVisible(button))
        .sort((left, right) => (
          right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom
        ));
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
      return normalized.includes("quickchat")
        || normalized.includes("クイックチャット")
        || normalized.includes("빠른채팅");
    }

    function quickChatRow(button, panel) {
      for (let current = button.parentElement; current != null && current !== panel; current = current.parentElement) {
        if (
          current instanceof HTMLElement
          && current.classList.contains("flex")
          && current.classList.contains("items-center")
          && current.classList.contains("gap-1")
        ) {
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
      if (
        !(row instanceof HTMLElement)
        || !(branch instanceof HTMLElement)
        || typeof onClick !== "function"
      ) {
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
      return String(value ?? "")
        .toLocaleLowerCase()
        .replace(/[\s_\-:：。、・!！?？()\[\]{}]+/g, "");
    }

    function isNewChatLabel(value) {
      const normalized = normalizedQuickChatText(value);
      return normalized === "newchat"
        || normalized === "新しいチャット"
        || normalized === "새채팅"
        || normalized === "새로운채팅"
        || normalized === "新聊天"
        || normalized === "新建聊天";
    }

    function rowLooksLikeNewChat(row) {
      if (!(row instanceof HTMLElement) || isOwnedNode(row) || !isVisible(row)) return false;
      if (
        quickChatPrimaryLabel
        && quickChatRowClassName
        && row.className === quickChatRowClassName
        && row.textContent?.trim() === quickChatPrimaryLabel
      ) {
        return true;
      }
      if (
        !row.classList.contains("flex")
        || !row.classList.contains("items-center")
        || !row.classList.contains("gap-1")
      ) {
        return false;
      }
      return Array.from(row.querySelectorAll("button, a")).some((candidate) => (
        !isOwnedNode(candidate)
        && isNewChatLabel(candidate.textContent)
      ));
    }

    function chatNewChatRow(panel) {
      const rows = Array.from(panel.querySelectorAll("div")).filter(rowLooksLikeNewChat);
      rows.sort((left, right) => (
        left.getBoundingClientRect().top - right.getBoundingClientRect().top
      ));
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
        "</button>",
      ].join("");
      return sanitizeQuickChatTemplate(branch);
    }

    function isQuickChatStore(value) {
      try {
        return value != null
          && typeof value === "object"
          && typeof value.get === "function"
          && typeof value.set === "function"
          && typeof value.watch === "function"
          && typeof value.when === "function"
          && value.node != null
          && value.chain != null;
      } catch {
        return false;
      }
    }

    function quickChatStoreFromFiberTree() {
      const root = currentReactFiberRoot();
      if (root == null) return null;
      const stack = [root];
      const visitedFibers = new Set();
      while (stack.length > 0 && visitedFibers.size < 100_000) {
        const fiber = stack.pop();
        if (fiber == null || visitedFibers.has(fiber)) continue;
        visitedFibers.add(fiber);
        let hook = fiber.memoizedState;
        const visitedHooks = new Set();
        while (hook != null && typeof hook === "object" && visitedHooks.size < 1_000) {
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
        return source.includes("chatgpt.quick-chat")
          && source.includes("projectId")
          && source.includes("projectName")
          && source.includes("hasConversation");
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
      const appInitialUrl = resourceAssetUrl(appInitialPattern)
        ?? linkedAssetUrl(appInitialPattern);
      if (appInitialUrl == null) throw new Error("The Quick chat app runtime was not found");
      const moduleNamespace = await import(appInitialUrl);
      const open = nativeQuickChatOpen(moduleNamespace);
      if (open == null) throw new Error("The native Quick chat command was not found");
      return { appInitialUrl, open };
    }

    async function ensureQuickChatRuntime() {
      if (quickChatRuntime != null) return quickChatRuntime;
      if (quickChatRuntimePromise == null) {
        quickChatRuntimePromise = loadQuickChatRuntime()
          .then((loaded) => {
            quickChatRuntime = loaded;
            quickChatLastError = null;
            diagnostics.quickChatBridgeLoads += 1;
            return loaded;
          })
          .catch((error) => {
            quickChatLastError = String(error?.stack || error);
            diagnostics.quickChatBridgeLoadErrors += 1;
            quickChatRuntimePromise = null;
            throw error;
          });
      }
      return quickChatRuntimePromise;
    }

    async function openQuickChatThroughApp() {
      const runtime2 = await ensureQuickChatRuntime();
      const store = quickChatStoreFromFiberTree();
      if (store == null) throw new Error("The live Quick chat state store was not found");
      return runtime2.open(store, {});
    }

    function openQuickChat(event) {
      event.preventDefault();
      event.stopPropagation();
      try {
        const result = typeof quickChatHandler === "function"
          ? quickChatHandler(event)
          : openQuickChatThroughApp();
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
      const existing = document.getElementById(QUICK_CHAT_BUTTON_ID);
      if (!(panel instanceof HTMLElement) || !usagePanelIsAllowed()) {
        existing?.remove();
        return;
      }

      const nativeButton = captureNativeQuickChat(panel);
      if (nativeButton instanceof HTMLButtonElement) {
        existing?.remove();
        return;
      }
      const row = chatNewChatRow(panel);
      if (!(row instanceof HTMLElement)) {
        existing?.remove();
        return;
      }
      if (existing instanceof HTMLElement && existing.parentElement === row) return;
      existing?.remove();

      const branch = quickChatTemplate instanceof HTMLElement
        ? sanitizeQuickChatTemplate(quickChatTemplate.cloneNode(true))
        : createQuickChatFallback();
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

    /*
     * ChatGPT Work keeps the same turn-diff item as Codex, but STEPS_PROSE
     * intentionally skips the native card. Reuse the app's own component and
     * the live provider values from the Work tree so typography, controls,
     * review behavior, and undo behavior stay native instead of being copied.
     */
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
          '[data-app-shell-main-surface], [class*="_MainContentSurface_"]',
        ),
        document.body,
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
        if (
          current.stateNode instanceof HTMLElement
          && current.stateNode.closest(
            '[data-app-shell-main-surface], [class*="_MainContentSurface_"]',
          ) != null
        ) {
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
        ...(Array.isArray(props.items) ? props.items : []),
        ...(Array.isArray(props.turn?.items) ? props.turn.items : []),
        ...(Array.isArray(props.turnState?.items) ? props.turnState.items : []),
        ...(Array.isArray(props.mcpTurn?.items) ? props.mcpTurn.items : []),
      ];
      const items = [];
      const seen = new Set();
      for (const item of candidates) {
        if (
          item == null
          || typeof item !== "object"
          || item.type !== "turn-diff"
          || typeof item.unifiedDiff !== "string"
          || item.unifiedDiff.length === 0
          || seen.has(item)
        ) {
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
      if (
        [
          "cancelled",
          "canceled",
          "complete",
          "completed",
          "done",
          "failed",
          "interrupted",
          "stopped",
        ].includes(normalized)
      ) {
        return false;
      }
      return null;
    }

    function turnInProgressFromProps(props) {
      if (props == null || typeof props !== "object") return null;
      const explicit = [
        props.isTurnInProgress,
        props.turn?.isTurnInProgress,
        props.turnState?.isTurnInProgress,
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
      return [props.items, props.turn?.items, props.turnState?.items, props.mcpTurn?.items]
        .filter(Array.isArray)
        .sort((left, right) => right.length - left.length)[0] ?? [];
    }

    function itemsLookInProgress(items) {
      const streamingTypes = new Set([
        "command-execution",
        "dynamic-tool-call",
        "mcp-tool-call",
        "web-search",
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
      let conversationDetailLevel = initialProps?.conversationDetailLevel
        ?? initialProps?.threadDetailLevel
        ?? null;
      let conversationId = initialProps?.conversationId
        ?? initialProps?.turn?.conversationId
        ?? initialProps?.turnState?.conversationId
        ?? null;
      let cwd = initialProps?.cwd
        ?? item?.cwd
        ?? initialProps?.turn?.cwd
        ?? initialProps?.turnState?.cwd
        ?? null;
      let hostId = initialProps?.hostId
        ?? initialProps?.turn?.hostId
        ?? initialProps?.turnState?.hostId
        ?? null;
      let turnId = initialProps?.turnId
        ?? initialProps?.turn?.id
        ?? initialProps?.turnState?.turnId
        ?? null;
      let isTurnInProgress = turnInProgressFromProps(initialProps);
      let turnItems = turnItemsFromProps(initialProps);
      for (let current = fiber?.return; current != null; current = current.return) {
        const props = fiberProps(current);
        if (props == null) continue;
        conversationDetailLevel = firstDefined(
          conversationDetailLevel,
          props.conversationDetailLevel ?? props.threadDetailLevel,
        );
        conversationId = firstDefined(
          conversationId,
          props.conversationId ?? props.turn?.conversationId ?? props.turnState?.conversationId,
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
        turnItems,
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
      } catch {}
      return null;
    }

    function linkedAssetUrl(pattern) {
      try {
        for (const link of document.querySelectorAll("link[href]")) {
          const href = typeof link.href === "string" && link.href
            ? link.href
            : new URL(link.getAttribute("href"), document.baseURI).href;
          if (pattern.test(href)) return href;
        }
      } catch {}
      return null;
    }

    async function nativeTurnDiffAssetUrls() {
      const appInitialPattern = /\/app-initial-[^/]+\.js(?:[?#]|$)/;
      const nativeComponentPattern = /\/subagent-activity-chip-group-[^/]+\.js(?:[?#]|$)/;
      const turnModulePattern = /\/local-conversation-turn-[^/]+\.js(?:[?#]|$)/;
      const appInitialUrl = resourceAssetUrl(appInitialPattern)
        ?? linkedAssetUrl(appInitialPattern);
      let nativeComponentUrl = resourceAssetUrl(nativeComponentPattern)
        ?? linkedAssetUrl(nativeComponentPattern);
      if (nativeComponentUrl == null) {
        const turnModuleUrl = resourceAssetUrl(turnModulePattern)
          ?? linkedAssetUrl(turnModulePattern);
        if (turnModuleUrl != null) {
          const turnModuleSource = await fetch(turnModuleUrl).then((response) => response.text());
          const match = turnModuleSource.match(
            /["']\.\/((?:subagent-activity-chip-group)-[^"']+\.js)["']/,
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
      const wrapperMatch = source.slice(markerIndex, markerIndex + 5_000).match(
        /\}\)\),([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\(\(\(/,
      );
      const wrapperName = wrapperMatch?.[1];
      if (!wrapperName) return null;
      const exportBlockIndex = source.lastIndexOf("export{");
      if (exportBlockIndex < 0) return null;
      const aliasMatch = source.slice(exportBlockIndex).match(
        new RegExp(`(?:^|,)${escapeRegExp(wrapperName)} as ([A-Za-z_$][\\w$]*)`),
      );
      return aliasMatch?.[1] ?? null;
    }

    function nativeTurnDiffComponent(moduleNamespace) {
      return Object.values(moduleNamespace).find((value) => {
        if (typeof value !== "function") return false;
        const source = Function.prototype.toString.call(value);
        return source.includes("inProgressDiffSummary")
          && source.includes("showRevertButton")
          && source.includes("deferOffscreenRendering");
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
        fetch(appInitialUrl).then((response) => response.text()),
      ]);
      const component = nativeTurnDiffComponent(componentModule);
      if (component == null) throw new Error("Codex native turn-diff component was not found");
      const factoryExportName = reactDomFactoryExportName(appInitialSource);
      const reactDomFactory = factoryExportName == null
        ? appInitialModule.mNt
        : appInitialModule[factoryExportName];
      const reactDom = typeof reactDomFactory === "function" ? reactDomFactory() : null;
      if (typeof reactDom?.createRoot !== "function") {
        throw new Error("Codex ReactDOM createRoot runtime was not found");
      }
      return {
        component,
        createRoot: reactDom.createRoot,
        appInitialUrl,
        nativeComponentUrl,
      };
    }

    async function ensureNativeTurnDiffRuntime() {
      if (nativeTurnDiffRuntime != null) return nativeTurnDiffRuntime;
      if (nativeTurnDiffRuntimePromise == null) {
        nativeTurnDiffRuntimePromise = loadNativeTurnDiffRuntime()
          .then((loaded) => {
            nativeTurnDiffRuntime = loaded;
            nativeTurnDiffLastError = null;
            diagnostics.nativeTurnDiffLoads += 1;
            return loaded;
          })
          .catch((error) => {
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
        $$typeof: Symbol.for("react.transitional.element"),
        type,
        key: null,
        props,
        _owner: null,
      };
    }

    function nativeTurnDiffElement(runtime2, entry) {
      let element = reactElement(runtime2.component, {
        isInProgress: false,
        item: entry.item,
        deferOffscreenRendering: false,
        conversationId: entry.context.conversationId,
        cwd: entry.context.cwd,
        hostId: entry.context.hostId,
      });
      for (const provider of entry.providers) {
        const providerType = provider.elementType ?? provider.type;
        if (providerType == null) continue;
        element = reactElement(providerType, {
          value: fiberProps(provider)?.value,
          children: element,
        });
      }
      return element;
    }

    function removeNativeTurnDiffRoot(key, record = nativeTurnDiffRoots.get(key)) {
      if (record == null) return;
      nativeTurnDiffRoots.delete(key);
      try {
        record.root.unmount();
      } catch {}
      record.container.remove();
    }

    function reportNativeTurnDiffRenderError(error) {
      nativeTurnDiffLastError = String(error?.stack || error);
      diagnostics.nativeTurnDiffRenderErrors += 1;
    }

    function assistantActionRow(host) {
      if (!(host instanceof HTMLElement)) return null;
      const rows = Array.from(host.querySelectorAll("div")).filter((element) => (
        element instanceof HTMLElement
        && !isOwnedNode(element)
        && element.classList.contains("mt-1.5")
        && element.classList.contains("h-5")
        && element.classList.contains("items-center")
        && element.classList.contains("justify-start")
        && element.classList.contains("gap-0.5")
      ));
      return rows.at(-1) ?? null;
    }

    function placeNativeTurnDiffContainer(host, container) {
      const actionRow = assistantActionRow(host);
      if (actionRow?.parentElement instanceof HTMLElement) {
        if (container.parentElement !== actionRow.parentElement
          || container.nextElementSibling !== actionRow) {
          actionRow.before(container);
        }
        return;
      }
      if (container.parentElement !== host || host.lastElementChild !== container) {
        host.append(container);
      }
    }

    function mountNativeTurnDiff(runtime2, entry) {
      let record = nativeTurnDiffRoots.get(entry.key);
      if (
        record != null
        && (record.host !== entry.host || !record.container.isConnected)
      ) {
        removeNativeTurnDiffRoot(entry.key, record);
        record = null;
      }
      if (record == null) {
        const container = markOwned(document.createElement("div"));
        container.setAttribute("data-codex-theme-native-turn-diff", "true");
        container.dataset.diffKey = entry.key;
        placeNativeTurnDiffContainer(entry.host, container);
        const root = runtime2.createRoot(container, {
          onCaughtError: reportNativeTurnDiffRenderError,
          onUncaughtError: reportNativeTurnDiffRenderError,
          onRecoverableError: reportNativeTurnDiffRenderError,
        });
        record = { container, host: entry.host, root };
        nativeTurnDiffRoots.set(entry.key, record);
      }
      placeNativeTurnDiffContainer(entry.host, record.container);
      try {
        record.root.render(nativeTurnDiffElement(runtime2, entry));
        diagnostics.nativeTurnDiffRenders += 1;
      } catch (error) {
        reportNativeTurnDiffRenderError(error);
        removeNativeTurnDiffRoot(entry.key, record);
      }
    }

    function discoverNativeTurnDiffs(nativeComponent = null) {
      const root = currentReactFiberRoot();
      if (root == null) return new Map();
      const discovered = new Map();
      const stack = [root];
      const visited = new Set();
      while (stack.length > 0 && visited.size < 100_000) {
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
            const identity = item.id
              || context.turnId
              || hashText(`${context.conversationId}\n${item.unifiedDiff}`);
            const key = `${context.conversationId}:${identity}`;
            const providers = reactProviderFibers(fiber);
            const nativeAlreadyRendered = nativeComponent != null
              && (fiber.type === nativeComponent || fiber.elementType === nativeComponent);
            const score = providers.length
              + (context.hostId != null ? 100 : 0)
              + (context.turnId != null ? 100 : 0)
              + (context.conversationDetailLevel === "STEPS_PROSE" ? 50 : 0)
              + (Array.isArray(item.patchBatches) ? 10 : 0);
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
                score,
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
      let runtime2;
      try {
        runtime2 = await ensureNativeTurnDiffRuntime();
      } catch {
        return;
      }
      if (disposed) return;
      discovered = discoverNativeTurnDiffs(runtime2.component);
      for (const [key, record] of nativeTurnDiffRoots) {
        const entry = discovered.get(key);
        if (entry == null || entry.host !== record.host || entry.nativeAlreadyRendered) {
          removeNativeTurnDiffRoot(key, record);
        }
      }
      for (const entry of discovered.values()) {
        if (!entry.nativeAlreadyRendered && entry.host.isConnected) {
          mountNativeTurnDiff(runtime2, entry);
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
      void renderChatModeTurnDiffs()
        .catch(reportNativeTurnDiffRenderError)
        .finally(() => {
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
        item?.arguments?.command,
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
      const argument = '(?:"[^"\\n]*"|\'[^\'\\n]*\'|[^\\s]+)';
      return String(value)
        .replace(new RegExp(`\\b(${secretName})=(${argument})`, "gi"), "$1=<redacted>")
        .replace(new RegExp(`(--${secretFlag})(?:=|\\s+)(${argument})`, "gi"), "$1 <redacted>");
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
          language: match[1].trim(),
        });
      }
      return blocks;
    }

    function addUnique(values, seen, value, limit = 100) {
      if (values.length >= limit || value == null) return;
      const text = String(value).trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      values.push(text.slice(0, 8_000));
    }

    function workTechnicalDetails(items) {
      const details = {
        commands: [],
        files: [],
        planCode: [],
        planSteps: [],
        searches: [],
        tools: [],
      };
      const seen = Object.fromEntries(
        Object.keys(details).map((key) => [key, new Set()]),
      );
      for (const item of items.slice(0, 500)) {
        if (item == null || typeof item !== "object") continue;
        const command = commandText(item);
        if (command) addUnique(details.commands, seen.commands, redactCommand(command));

        for (const path of [item.path, item.filePath, item.fsPath, item.parsedCmd?.path]) {
          addUnique(details.files, seen.files, path);
        }
        for (const change of Array.isArray(item.changes) ? item.changes : []) {
          addUnique(details.files, seen.files, change?.path ?? change?.filePath);
        }
        for (const path of diffPaths(item.unifiedDiff)) {
          addUnique(details.files, seen.files, path);
        }

        if (item.type === "proposed-plan") {
          const content = item.content ?? item.plan ?? item.text;
          for (const block of fencedCodeBlocks(content)) {
            const key = `${block.language}\n${block.code}`;
            if (seen.planCode.has(key) || details.planCode.length >= 30) continue;
            seen.planCode.add(key);
            details.planCode.push(block);
          }
        }

        if (["todo-list", "plan", "proposed-plan"].includes(item.type)) {
          const steps = [item.items, item.steps, item.todos, item.plan]
            .find(Array.isArray) ?? [];
          for (const step of steps) {
            const text = typeof step === "string"
              ? step
              : step?.step ?? step?.text ?? step?.content ?? step?.title;
            const status = typeof step === "object"
              ? step?.status ?? step?.state
              : null;
            addUnique(
              details.planSteps,
              seen.planSteps,
              status && text ? `[${status}] ${text}` : text,
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
            ...(Array.isArray(item.queries) ? item.queries : []),
          ]) {
            addUnique(details.searches, seen.searches, query?.q ?? query);
          }
        }
      }
      return details;
    }

    function workTechnicalDetailsCount(details) {
      return details.commands.length
        + details.files.length
        + details.planCode.length
        + details.planSteps.length
        + details.searches.length
        + details.tools.length;
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
        row.className = code
          ? "codex-theme-work-details-code"
          : "codex-theme-work-details-row";
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
      if (root == null) return new Map();
      const discovered = new Map();
      const stack = [root];
      const visited = new Set();
      while (stack.length > 0 && visited.size < 100_000) {
        const fiber = stack.pop();
        if (fiber == null || visited.has(fiber)) continue;
        visited.add(fiber);
        const props = fiberProps(fiber);
        const items = turnItemsFromProps(props);
        if (items.length > 0) {
          const context = turnDiffContext(fiber, props, null);
          if (
            context.conversationDetailLevel === "STEPS_PROSE"
            && context.conversationId != null
            && context.turnId != null
          ) {
            const host = chatTurnDiffHost(fiber, context);
            const details = workTechnicalDetails(context.turnItems);
            const count = workTechnicalDetailsCount(details);
            if (host instanceof HTMLElement && count > 0) {
              const key = `${context.conversationId}:${context.turnId}`;
              const signature = hashText(JSON.stringify({
                details,
                isTurnInProgress: context.isTurnInProgress,
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
        if (
          previous != null
          && previous.host === entry.host
          && previous.signature === entry.signature
          && previous.node.isConnected
        ) {
          continue;
        }
        const open = previous?.node?.open === true;
        const node = createWorkTechnicalDetailsNode(entry, open);
        if (previous?.node?.isConnected) previous.node.replaceWith(node);
        else entry.host.append(node);
        workTechnicalDetailNodes.set(entry.key, {
          host: entry.host,
          node,
          signature: entry.signature,
        });
        diagnostics.workTechnicalDetailRenders += 1;
      }
    }

    function commandEntryForElement(element) {
      for (let current = reactFiberForElement(element); current != null; current = current.return) {
        const props = fiberProps(current);
        const item = props?.item;
        if (
          item != null
          && typeof item === "object"
          && ["command-execution", "exec"].includes(item.type)
          && commandText(item)
        ) {
          return { context: turnDiffContext(current, props, item), fiber: current, item };
        }
      }
      return null;
    }

    function commandSummaryFromHeader(header) {
      const summary = Array.from(header.querySelectorAll("span")).find((element) => (
        element instanceof HTMLElement
        && element.classList.contains("min-w-0")
        && element.classList.contains("truncate")
      ));
      return summary instanceof HTMLElement ? summary : null;
    }

    function commandSummaryNode(body, host) {
      for (
        let current = body.parentElement;
        current instanceof HTMLElement && host.contains(current);
        current = current.parentElement
      ) {
        const header = Array.from(current.querySelectorAll("div")).find((element) => (
          element instanceof HTMLElement
          && element.classList.contains("group/activity-header")
          && !element.contains(body)
        ));
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
      while ((node = walker.nextNode())) {
        if (node.nodeValue?.trim()) candidates.push(node);
      }
      return candidates.sort((left, right) => (
        right.nodeValue.trim().length - left.nodeValue.trim().length
      ))[0] ?? null;
    }

    function commandTextWithNativeWhitespace(originalText, command) {
      const leading = originalText.match(/^\s*/)?.[0] ?? "";
      const trailing = originalText.match(/\s*$/)?.[0] ?? "";
      return `${leading}${command}${trailing}`;
    }

    function restoreWorkCommandSummary(node, record = workCommandSummaryNodes.get(node)) {
      if (
        record?.textNode?.isConnected
        && record.textNode.nodeValue === record.renderedText
      ) {
        record.textNode.nodeValue = record.originalText;
      }
      removeAttributeIfPresent(node, "data-codex-theme-work-command-summary");
      removeAttributeIfPresent(node, "data-codex-theme-work-command");
      diagnostics.workCommandSummaryRestores += 1;
    }

    function renderWorkCommandSummaries() {
      const desired = new Map();
      const candidates = new Set([
        ...document.querySelectorAll('[data-testid="exec-shell-body"]'),
        ...document.getElementsByClassName("group/activity-header"),
      ]);
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement) || isOwnedNode(candidate)) continue;
        const entry = commandEntryForElement(candidate);
        if (entry?.context.conversationDetailLevel !== "STEPS_PROSE") continue;
        const host = chatTurnDiffHost(entry.fiber, entry.context);
        if (!(host instanceof HTMLElement)) continue;
        const summary = candidate.classList.contains("group/activity-header")
          ? commandSummaryFromHeader(candidate)
          : commandSummaryNode(candidate, host);
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
            textNode,
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
        setAttributeIfChanged(node, "data-codex-theme-work-command", command.slice(0, 8_000));
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
        '[data-codex-composer="true"], textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder]',
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

      const layoutRoot = editor.closest(
        "[data-composer-layout][data-composer-surface-variant]",
      );
      if (layoutRoot instanceof HTMLElement && isVisible(layoutRoot)) {
        for (
          let surface = editor.parentElement;
          surface && layoutRoot.contains(surface);
          surface = surface.parentElement
        ) {
          const rect = surface.getBoundingClientRect();
          const radius = Number.parseFloat(getComputedStyle(surface).borderRadius);
          if (
            rect.width >= 320
            && rect.height >= 48
            && rect.height <= 260
            && Number.isFinite(radius)
            && radius >= 8
            && surface.querySelector("button")
          ) {
            return surface;
          }
          if (surface === layoutRoot) break;
        }
        return layoutRoot;
      }

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
      const duration = reducedMotion ? 8_000 : 2_400;
      const phase = (timestamp % duration) / duration;
      const geometryKey = `${metricsKey}:${segmentCount}`;
      if (composerGeometryKey !== geometryKey) {
        composerGeometryKey = geometryKey;
        const bandWidth = cssWidth / segmentCount;
        composerSegments = Array.from({ length: segmentCount }, (_, index) => ({
          x: index * bandWidth,
          width: bandWidth + 1,
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
      const visibleSurfaces = (selector) => Array.from(document.querySelectorAll(selector))
        .filter((surface) => surface instanceof HTMLElement && isVisible(surface));
      const currentSurfaces = visibleSurfaces("[data-app-shell-main-surface]");
      const candidates = currentSurfaces.length > 0
        ? currentSurfaces
        : visibleSurfaces('[class*="_MainContentSurface_"]');
      return candidates
        .sort((left, right) => {
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
        if (config.usageManagedByHost !== true) {
          usageTimer = setInterval(refreshUsage, USAGE_REFRESH_MS);
        }
        chatTurnDiffTimer = setInterval(
          scheduleWorkModeEnhancements,
          CHAT_TURN_DIFF_REFRESH_MS,
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
          chatTurnDiffTimer: chatTurnDiffTimer !== 0,
          composerAnimationFrame: composerAnimationFrame !== 0,
          fireTimer: fireTimer !== 0,
        },
        nodes: {
          usagePanels: document.querySelectorAll(`#${USAGE_PANEL_ID}`).length,
          chatQuickChatButtons: document.querySelectorAll(`#${QUICK_CHAT_BUTTON_ID}`).length,
          composerCanvases: document.querySelectorAll(".codex-theme-rainbow-canvas").length,
          fireLayers: document.querySelectorAll(".codex-theme-thumb-fire-layer").length,
          fireImages: document.querySelectorAll(".codex-theme-thumb-fire").length,
          serverSignals: document.querySelectorAll(".codex-theme-server-signal").length,
          chatTurnDiffCards: document.querySelectorAll(
            '[data-codex-theme-native-turn-diff="true"]',
          ).length,
          nativeTurnDiffCards: nativeTurnDiffRoots.size,
          workCommandSummaries: workCommandSummaryNodes.size,
          workTechnicalDetails: workTechnicalDetailNodes.size,
        },
        nativeTurnDiff: {
          loaded: nativeTurnDiffRuntime != null,
          loading: nativeTurnDiffRuntimePromise != null && nativeTurnDiffRuntime == null,
          lastError: nativeTurnDiffLastError,
        },
        quickChat: {
          handlerCaptured: typeof quickChatHandler === "function",
          bridgeLoaded: quickChatRuntime != null,
          bridgeLoading: quickChatRuntimePromise != null && quickChatRuntime == null,
          liveStoreFound: quickChatStoreFromFiberTree() != null,
          lastError: quickChatLastError,
          label: quickChatLabel || null,
          primaryLabel: quickChatPrimaryLabel || null,
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
        '[data-codex-theme-native-turn-diff="true"]',
      )) {
        container.remove();
      }
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
