import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import { installPageRuntime } from "../src/page/runtime.mjs";
import { createThemeCss } from "../src/page/styles.mjs";

const fixture = `<!doctype html>
<html class="electron-dark" data-codex-window-type="electron">
  <head><title>Codex</title></head>
  <body>
    <aside class="app-shell-left-panel">
      <div data-app-action-sidebar-scroll>
        <div class="sidebar-item server-row">
          <span class="sidebar-item-icon"></span>
          <span class="server-label">Proxmox</span>
        </div>
      </div>
      <div class="footer-host">
        <div class="h-toolbar sidebar-footer">
          <button class="sidebar-item" type="button" aria-label="Open profile menu">Settings</button>
        </div>
      </div>
    </aside>
    <main data-app-shell-main-surface>
      <div
        class="composer-root"
        data-composer-layout="multiline"
        data-composer-radius-variant="default"
        data-composer-surface-variant="default"
        data-composer-utility-bar-variant="home"
      >
        <div class="composer-body" data-composer-layout="multiline" style="background: rgb(28 34 36 / 88%); border-radius: 25px">
          <div contenteditable="true" role="textbox" data-codex-composer="true"></div>
          <button class="activity-button" type="button" aria-label="Stop">Stop</button>
        </div>
      </div>
    </main>
  </body>
</html>`;

function rectangle(x, y, width, height) {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON() { return this; },
  };
}

function createDom() {
  const dom = new JSDOM(fixture, {
    url: "app://-/index.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.classList.contains("app-shell-left-panel")) return rectangle(0, 0, 640, 1_000);
    if (this.hasAttribute("data-app-action-sidebar-scroll")) return rectangle(0, 80, 640, 780);
    if (this.hasAttribute("data-app-shell-main-surface")) return rectangle(640, 0, 1_280, 1_000);
    if (this.classList.contains("composer-root")) return rectangle(820, 790, 900, 120);
    if (this.classList.contains("composer-body")) return rectangle(820, 790, 900, 120);
    if (this.hasAttribute("data-codex-composer")) return rectangle(850, 820, 760, 42);
    if (this.classList.contains("codex-theme-rainbow-canvas")) return rectangle(820, 790, 900, 120);
    if (this.classList.contains("server-label")) return rectangle(420, 140, 120, 28);
    if (this.classList.contains("server-row")) return rectangle(20, 130, 600, 48);
    if (this.classList.contains("h-toolbar")) return rectangle(0, 930, 640, 70);
    if (this.tagName === "BUTTON") return rectangle(40, 940, 560, 44);
    return rectangle(20, 100, 400, 40);
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({
    setTransform() {},
    clearRect() {},
    fillRect() {},
    set fillStyle(_) {},
  });
  return dom;
}

function runtimeConfig(overrides = {}) {
  return {
    version: 22,
    css: createThemeCss("data:image/jpeg;base64,aW1hZ2U="),
    fireDataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    rainbowPreview: true,
    imageBytes: 32,
    timings: { rainbowGraceMs: 10, usageGraceMs: 10 },
    ...overrides,
  };
}

function appendNativeQuickChatRow(window) {
  const panel = window.document.querySelector(".app-shell-left-panel");
  const row = window.document.createElement("div");
  row.className = "flex items-center gap-1";
  const primary = window.document.createElement("button");
  primary.type = "button";
  primary.textContent = "新しいチャット";
  const quickChatHost = window.document.createElement("div");
  quickChatHost.className = "pe-1";
  const quickChatButton = window.document.createElement("button");
  quickChatButton.type = "button";
  quickChatButton.setAttribute("aria-label", "クイックチャット");
  quickChatButton.innerHTML = [
    '<svg viewBox="0 0 16 16" aria-hidden="true">',
    '<path d="M7.9834 5.3042C8.27312 5.30446 8.50879 5.5398 8.50879 5.82959Z"></path>',
    "</svg>",
  ].join("");
  quickChatHost.append(quickChatButton);
  row.append(primary, quickChatHost);
  panel.prepend(row);
  return { primary, quickChatButton, quickChatHost, row };
}

function evaluateRuntime(window, config) {
  return window.eval(`(${installPageRuntime.toString()})(${JSON.stringify(config)})`);
}

function settle(milliseconds = 40) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendFakeAssistantActionRow(window, response) {
  const actionRow = window.document.createElement("div");
  actionRow.className = "mt-1.5 flex h-5 items-center justify-start gap-0.5";
  actionRow.innerHTML = [
    '<button type="button" aria-label="Copy response">Copy</button>',
    '<button type="button" aria-label="Good response">Good</button>',
    '<button type="button" aria-label="Bad response">Bad</button>',
    '<button type="button" aria-label="Fork chat from here">Fork</button>',
    '<span data-assistant-message-sent-time>15:00</span>',
  ].join("");
  response.append(actionRow);
  return actionRow;
}

function appendFakeExecRow(window, response, item, parentFiber) {
  const row = window.document.createElement("div");
  row.className = "exec-row";
  const header = window.document.createElement("div");
  header.className = "group/activity-header flex items-center";
  const summary = window.document.createElement("span");
  summary.className = "min-w-0 truncate";
  const icon = window.document.createElement("span");
  icon.className = "exec-icon";
  icon.setAttribute("aria-hidden", "true");
  const label = window.document.createElement("span");
  label.className = "exec-label text-secondary";
  label.textContent = item.status === "running" ? "Running command" : "Ran command";
  summary.append(icon, label);
  header.append(summary);
  const body = item.status === "running"
    ? null
    : window.document.createElement("div");
  if (body != null) body.dataset.testid = "exec-shell-body";
  row.append(header);
  if (body != null) row.append(body);
  response.insertBefore(row, response.lastElementChild);

  const itemFiber = {
    memoizedProps: { item },
    return: parentFiber,
    stateNode: null,
  };
  const headerFiber = {
    memoizedProps: {},
    return: itemFiber,
    stateNode: header,
  };
  Object.defineProperty(header, `__reactFiber$codexThemeExecHeader${response.children.length}`, {
    configurable: true,
    value: headerFiber,
  });
  if (body != null) {
    const bodyFiber = {
      memoizedProps: {},
      return: itemFiber,
      stateNode: body,
    };
    Object.defineProperty(body, `__reactFiber$codexThemeExecBody${response.children.length}`, {
      configurable: true,
      value: bodyFiber,
    });
  }
  return { body, icon, label, row, summary };
}

function attachFakeChatTurnDiffFiber(
  window,
  {
    actionRow = true,
    chatGptTranscript = false,
    extraItems = [],
    isTurnInProgress = false,
  } = {},
) {
  const main = window.document.querySelector("[data-app-shell-main-surface]");
  const host = window.document.createElement("div");
  host.className = "chat-turn-item-host";
  if (chatGptTranscript) {
    host.setAttribute("data-content-search-turn-key", "turn-1");
  }
  const response = window.document.createElement("div");
  response.className = "assistant-response";
  response.innerHTML = "<p>Response</p>";
  const assistantActionRow = actionRow
    ? appendFakeAssistantActionRow(window, response)
    : null;
  host.append(response);
  main.appendChild(host);
  const unifiedDiff = [
    "diff --git a/src/page/runtime.mjs b/src/page/runtime.mjs",
    "--- a/src/page/runtime.mjs",
    "+++ b/src/page/runtime.mjs",
    "@@ -1 +1,2 @@",
    "-old runtime",
    "+new runtime",
    "+more runtime",
    "diff --git a/src/page/source.mjs b/src/page/source.mjs",
    "--- a/src/page/source.mjs",
    "+++ b/src/page/source.mjs",
    "@@ -1 +1 @@",
    "-old source",
    "+new source",
    "diff --git a/src/page/styles.mjs b/src/page/styles.mjs",
    "--- a/src/page/styles.mjs",
    "+++ b/src/page/styles.mjs",
    "@@ -1 +1 @@",
    "-old styles",
    "+new styles",
    "diff --git a/test/page-runtime.test.mjs b/test/page-runtime.test.mjs",
    "--- a/test/page-runtime.test.mjs",
    "+++ b/test/page-runtime.test.mjs",
    "@@ -1 +1 @@",
    "-old test",
    "+new test",
  ].join("\n");
  const rootFiber = { child: null, return: null, sibling: null };
  const mainFiber = {
    child: null,
    memoizedProps: {},
    return: rootFiber,
    sibling: null,
    stateNode: main,
  };
  const hostFiber = {
    child: null,
    memoizedProps: {},
    return: mainFiber,
    sibling: null,
    stateNode: host,
  };
  const turnDiffItem = {
    id: "turn-diff-1",
    type: "turn-diff",
    unifiedDiff,
    patchBatches: [],
    cwd: "/Users/dawn/Code.noindex/codex-theme",
  };
  const itemFiberProps = {
    conversationId: "chat-thread-1",
    cwd: "/Users/dawn/Code.noindex/codex-theme",
    isTurnInProgress,
    turn: {
      id: "turn-1",
      items: [
        { id: "user-message-1", type: "user-message", content: "Update the theme" },
        ...extraItems,
        turnDiffItem,
      ],
    },
    turnId: "turn-1",
  };
  if (!chatGptTranscript) itemFiberProps.conversationDetailLevel = "STEPS_PROSE";
  const itemFiber = {
    child: null,
    memoizedProps: itemFiberProps,
    return: null,
    sibling: null,
    stateNode: null,
  };
  const providerType = { displayName: "TestCodexScope" };
  const providerValue = { scope: "native-card-test" };
  const providerFiber = {
    child: itemFiber,
    elementType: providerType,
    memoizedProps: { value: providerValue },
    return: hostFiber,
    sibling: null,
    stateNode: null,
    tag: 10,
    type: providerType,
  };
  const execRows = extraItems
    .filter((item) => ["command-execution", "exec"].includes(item?.type))
    .map((item) => appendFakeExecRow(window, response, item, itemFiber));
  itemFiber.return = providerFiber;
  rootFiber.child = mainFiber;
  mainFiber.child = hostFiber;
  hostFiber.child = providerFiber;
  Object.defineProperty(main, "__reactFiber$codexThemeTest", {
    configurable: true,
    value: mainFiber,
  });
  return {
    assistantActionRow,
    host,
    itemFiber,
    providerType,
    providerValue,
    response,
    execRows,
    unifiedDiff,
  };
}

function attachFakeTranscriptTurnDiffFibers(window, turnIds) {
  const main = window.document.querySelector("[data-app-shell-main-surface]");
  const rootFiber = { child: null, return: null, sibling: null };
  const mainFiber = {
    child: null,
    memoizedProps: {},
    return: rootFiber,
    sibling: null,
    stateNode: main,
  };
  rootFiber.child = mainFiber;
  let previousHostFiber = null;
  const turns = turnIds.map((turnId, index) => {
    const host = window.document.createElement("div");
    host.className = "chat-transcript-turn-host";
    host.setAttribute("data-content-search-turn-key", turnId);
    const response = window.document.createElement("div");
    response.className = "assistant-response";
    response.innerHTML = `<p>Response ${index + 1}</p>`;
    const actionRow = appendFakeAssistantActionRow(window, response);
    host.append(response);
    main.append(host);
    const item = {
      type: "turn-diff",
      unifiedDiff: [
        `diff --git a/file-${index + 1}.mjs b/file-${index + 1}.mjs`,
        `--- a/file-${index + 1}.mjs`,
        `+++ b/file-${index + 1}.mjs`,
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
      patchBatches: [],
      cwd: "/Users/dawn/Code.noindex/codex-theme",
    };
    const hostFiber = {
      child: null,
      memoizedProps: {},
      return: mainFiber,
      sibling: null,
      stateNode: host,
    };
    const providerType = { displayName: `TestCodexScope${index + 1}` };
    const providerFiber = {
      child: null,
      elementType: providerType,
      memoizedProps: { value: { turnId } },
      return: hostFiber,
      sibling: null,
      stateNode: null,
      tag: 10,
      type: providerType,
    };
    const itemFiber = {
      child: null,
      memoizedProps: {
        conversationId: "chat-thread-1",
        cwd: "/Users/dawn/Code.noindex/codex-theme",
        hostId: "local",
        turn: { id: turnId, items: [item] },
        turnId,
      },
      return: providerFiber,
      sibling: null,
      stateNode: null,
    };
    hostFiber.child = providerFiber;
    providerFiber.child = itemFiber;
    if (previousHostFiber == null) mainFiber.child = hostFiber;
    else previousHostFiber.sibling = hostFiber;
    previousHostFiber = hostFiber;
    return { actionRow, host, item, itemFiber, response, turnId };
  });
  Object.defineProperty(main, "__reactFiber$codexThemeTranscriptTest", {
    configurable: true,
    value: mainFiber,
  });
  return turns;
}

function installFakeNativeTurnDiffRuntime(window) {
  const calls = { createRoot: 0, renders: [], unmounts: 0 };
  function NativeTurnDiff() {}
  window.__codexThemeNativeTurnDiffLoader = async () => ({
    component: NativeTurnDiff,
    createRoot(container) {
      calls.createRoot += 1;
      return {
        render(rootElement) {
          const providers = [];
          let element = rootElement;
          while (element?.type !== NativeTurnDiff) {
            providers.push({ type: element?.type, value: element?.props?.value });
            element = element?.props?.children;
          }
          calls.renders.push({ componentProps: element?.props, providers });
          container.replaceChildren();
          const card = window.document.createElement("section");
          card.className = "native-turn-diff-test";
          card.innerHTML = [
            '<strong data-native-title>Edited files</strong>',
            '<button type="button">Undo</button>',
            '<button type="button">Review changes</button>',
          ].join("");
          container.append(card);
        },
        unmount() {
          calls.unmounts += 1;
          container.replaceChildren();
        },
      };
    },
  });
  return { calls, NativeTurnDiff };
}

test("same-version evaluation is idempotent and keeps animation nodes", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    evaluateRuntime(window, runtimeConfig());
    await settle(80);
    const firstRuntime = window.__codexThemeRuntime;
    const firstCanvas = window.document.querySelector(".codex-theme-rainbow-canvas");
    const firstFireLayer = window.document.querySelector(".codex-theme-thumb-fire-layer");
    assert.equal(firstCanvas?.parentElement?.classList.contains("composer-body"), true);
    assert.equal(firstCanvas?.dataset.effect, "surface-fill");
    assert.equal(firstCanvas?.style.getPropertyValue("--codex-theme-composer-radius"), "");

    evaluateRuntime(window, runtimeConfig());
    await settle();
    const inspection = window.__codexThemeRuntime.inspect();

    assert.equal(window.__codexThemeRuntime, firstRuntime);
    assert.equal(inspection.diagnostics.installs, 1);
    assert.equal(inspection.diagnostics.evaluations, 2);
    assert.equal(inspection.nodes.usagePanels, 1);
    assert.equal(inspection.nodes.composerCanvases, 1);
    assert.equal(inspection.nodes.fireLayers, 1);
    assert.equal(window.document.querySelector(".codex-theme-rainbow-canvas"), firstCanvas);
    assert.equal(window.document.querySelector(".codex-theme-thumb-fire-layer"), firstFireLayer);
    assert.equal(inspection.diagnostics.composerCanvasCreates, 1);
    assert.equal(inspection.diagnostics.fireLayerCreates, 1);

    const reconciles = inspection.diagnostics.structureReconciles;
    await settle(100);
    assert.equal(
      window.__codexThemeRuntime.inspect().diagnostics.structureReconciles,
      reconciles,
      "the runtime should settle instead of observing its own DOM writes forever",
    );
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("usage percentage clips a full-width rainbow instead of resizing it", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    evaluateRuntime(window, runtimeConfig());
    await settle();
    const runtime = window.__codexThemeRuntime;
    const panel = window.document.getElementById("codex-theme-usage-panel");
    const fill = panel.querySelector(".codex-theme-usage-fill");
    assert.equal(panel.nextElementSibling?.classList.contains("sidebar-footer"), true);
    assert.equal(
      window.document.querySelector(".sidebar-footer .sidebar-item")?.textContent,
      "Settings",
    );

    for (const [remainingPercent, expectedClip] of [
      [100, "0%"],
      [75, "25%"],
      [25, "75%"],
      [5, "95%"],
    ]) {
      runtime.updateState({
        usage: { remainingPercent, resetAtMs: Date.now() + 60_000, capturedAtMs: Date.now() },
      });
      await settle();
      assert.equal(
        fill.style.getPropertyValue("--codex-theme-usage-clip-right"),
        expectedClip,
      );
      assert.equal(fill.style.width, "");
      assert.equal(window.document.getElementById("codex-theme-usage-panel"), panel);
    }

    const css = createThemeCss("data:image/jpeg;base64,aW1hZ2U=");
    assert.match(css, /\.codex-theme-usage-fill \{[\s\S]*position: absolute;[\s\S]*inset: 0;/);
    assert.match(css, /clip-path: inset\(0 var\(--codex-theme-usage-clip-right\)/);
    assert.match(css, /\.codex-theme-usage-fill::before \{[\s\S]*width: 250%;/);
    assert.match(css, /animation: codex-theme-usage-rainbow 3s linear infinite;/);
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("usage fetch reflects the limiting additional model window", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    window.electronBridge = {
      sendMessageFromView(message) {
        window.setTimeout(() => {
          window.postMessage({
            type: "fetch-response",
            requestId: message.requestId,
            responseType: "success",
            bodyJsonString: JSON.stringify({
              rate_limit: {
                primary_window: {
                  used_percent: 0,
                  limit_window_seconds: 18_000,
                  reset_at: 2_000_000_000,
                },
                secondary_window: {
                  used_percent: 0,
                  limit_window_seconds: 604_800,
                  reset_at: 2_000_100_000,
                },
              },
              additional_rate_limits: [{
                limit_name: "gpt-5.6-sol",
                rate_limit: {
                  primary_window: {
                    used_percent: 37,
                    limit_window_seconds: 18_000,
                    reset_at: 2_000_200_000,
                  },
                  secondary_window: {
                    used_percent: 61,
                    limit_window_seconds: 604_800,
                    reset_at: 2_000_300_000,
                  },
                },
              }],
            }),
          }, "*");
        }, 0);
      },
    };

    evaluateRuntime(window, runtimeConfig({ version: 23 }));
    await settle(80);

    const usage = window.__codexThemeRuntime.inspect().usage.value;
    assert.equal(usage.remainingPercent, 39);
    assert.equal(usage.resetAtMs, 2_000_300_000_000);
    assert.equal(Number.isFinite(usage.capturedAtMs), true);
    assert.equal(
      window.__codexThemeRuntime.inspect().usage.clipRight,
      "61%",
    );
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("host-managed usage does not overwrite canonical state through the legacy fetch bridge", async () => {
  const dom = createDom();
  const { window } = dom;
  let legacyFetches = 0;
  try {
    window.electronBridge = {
      sendMessageFromView() {
        legacyFetches += 1;
      },
    };

    evaluateRuntime(window, runtimeConfig({
      version: 24,
      usageManagedByHost: true,
    }));
    window.__codexThemeRuntime.updateState({
      usage: {
        remainingPercent: 96,
        resetAtMs: 2_000_200_000_000,
        capturedAtMs: Date.now(),
      },
    });
    await settle(80);

    assert.equal(legacyFetches, 0);
    assert.equal(window.__codexThemeRuntime.inspect().usage.value.remainingPercent, 96);
    assert.equal(window.__codexThemeRuntime.inspect().usage.clipRight, "4%");
    assert.equal(window.__codexThemeRuntime.inspect().resources.usageTimer, false);
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("usage panel is absent on settings routes and returns to chat routes", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    evaluateRuntime(window, runtimeConfig());
    await settle();
    const runtime = window.__codexThemeRuntime;
    assert.ok(window.document.getElementById("codex-theme-usage-panel"));

    dom.reconfigure({ url: "app://-/settings/general" });
    runtime.refresh();
    await settle();
    assert.equal(window.location.pathname, "/settings/general");
    assert.equal(window.document.getElementById("codex-theme-usage-panel"), null);

    dom.reconfigure({ url: "app://-/" });
    runtime.refresh();
    await settle();
    assert.ok(window.document.getElementById("codex-theme-usage-panel"));
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("usage panel is absent in a separate settings window without a chat profile footer", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    evaluateRuntime(window, runtimeConfig());
    await settle();
    const runtime = window.__codexThemeRuntime;
    const scroll = window.document.querySelector("[data-app-action-sidebar-scroll]");
    const profileButton = window.document.querySelector(".sidebar-footer button.sidebar-item");
    assert.ok(window.document.getElementById("codex-theme-usage-panel"));
    assert.equal(window.location.pathname, "/index.html");

    scroll.removeAttribute("data-app-action-sidebar-scroll");
    profileButton.classList.remove("sidebar-item");
    profileButton.setAttribute("aria-label", "Back to app");
    runtime.refresh();
    await settle();
    assert.equal(
      window.document.getElementById("codex-theme-usage-panel"),
      null,
      "a base-route settings window must not retain the sidebar usage panel",
    );

    scroll.setAttribute("data-app-action-sidebar-scroll", "");
    profileButton.classList.add("sidebar-item");
    profileButton.setAttribute("aria-label", "Open profile menu");
    runtime.refresh();
    await settle();
    assert.ok(window.document.getElementById("codex-theme-usage-panel"));
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("Chat mode reuses Codex's native Quick chat button and popover handler", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const { quickChatButton, quickChatHost, row } = appendNativeQuickChatRow(window);
    let opens = 0;
    quickChatButton.__reactProps$test = {
      onClick() {
        opens += 1;
      },
    };

    evaluateRuntime(window, runtimeConfig());
    await settle();
    const runtime = window.__codexThemeRuntime;
    assert.equal(runtime.inspect().quickChat.handlerCaptured, true);
    assert.equal(runtime.inspect().diagnostics.quickChatHandlerCaptures, 1);
    assert.equal(
      window.document.getElementById("codex-theme-chat-quick-chat"),
      null,
      "Codex mode must keep the app's own button",
    );

    quickChatHost.remove();
    runtime.refresh();
    await settle();
    const restored = window.document.getElementById("codex-theme-chat-quick-chat");
    const restoredButton = restored?.querySelector("button");
    assert.equal(restored?.parentElement, row);
    assert.equal(restoredButton?.getAttribute("aria-label"), "クイックチャット");
    assert.ok(restoredButton?.querySelector('path[d^="M7.9834 5.3042"]'));

    restoredButton.click();
    assert.equal(opens, 1);
    assert.equal(runtime.inspect().diagnostics.quickChatOpens, 1);

    runtime.refresh();
    await settle();
    assert.equal(
      window.document.getElementById("codex-theme-chat-quick-chat"),
      restored,
      "Chat mode reconciliation must not duplicate or replace the restored button",
    );

    row.append(quickChatHost);
    runtime.refresh();
    await settle();
    assert.equal(
      window.document.getElementById("codex-theme-chat-quick-chat"),
      null,
      "returning to Codex mode must remove the themed copy",
    );
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("initial Chat mode opens Quick chat without visiting Codex mode first", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const { quickChatHost, row } = appendNativeQuickChatRow(window);
    quickChatHost.remove();

    const store = {
      chain: {},
      node: {},
      get() {},
      set() {},
      watch() {},
      when() {},
    };
    const storeFiber = {
      child: null,
      memoizedState: {
        baseState: null,
        memoizedState: { current: store },
        next: null,
      },
      return: null,
      sibling: null,
    };
    const rootFiber = {
      child: storeFiber,
      memoizedState: null,
      return: null,
      sibling: null,
    };
    storeFiber.return = rootFiber;
    window.document.body.__reactContainer$quickChatTest = { current: rootFiber };

    let opens = 0;
    window.__codexThemeQuickChatLoader = async () => ({
      open(actualStore, options) {
        assert.equal(actualStore, store);
        assert.equal(Object.keys(options).length, 0);
        opens += 1;
      },
    });

    evaluateRuntime(window, runtimeConfig());
    await settle();
    const runtime = window.__codexThemeRuntime;
    const restored = window.document.getElementById("codex-theme-chat-quick-chat");
    const restoredButton = restored?.querySelector("button");
    assert.equal(restored?.parentElement, row);
    assert.ok(restoredButton?.classList.contains("codex-theme-quick-chat-button"));
    assert.ok(restoredButton?.classList.contains("h-6"));
    assert.ok(restoredButton?.classList.contains("text-tertiary"));
    assert.equal(restoredButton?.querySelector("svg")?.getAttribute("width"), "16");
    assert.equal(restoredButton?.querySelector("svg")?.getAttribute("height"), "16");
    assert.ok(restoredButton?.querySelector('path[d^="M7.9834 5.3042"]'));
    assert.equal(runtime.inspect().quickChat.handlerCaptured, false);
    assert.equal(runtime.inspect().quickChat.liveStoreFound, true);

    restoredButton.click();
    await settle();
    assert.equal(opens, 1);
    assert.equal(runtime.inspect().quickChat.bridgeLoaded, true);
    assert.equal(runtime.inspect().diagnostics.quickChatBridgeLoads, 1);
    assert.equal(runtime.inspect().diagnostics.quickChatOpenErrors, 0);
  } finally {
    delete window.__codexThemeQuickChatLoader;
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("ChatGPT prose mode mounts the app's native turn-diff component with live providers", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const {
      host,
      assistantActionRow,
      itemFiber,
      providerType,
      providerValue,
      unifiedDiff,
    } = attachFakeChatTurnDiffFiber(window);
    const nativeRuntime = installFakeNativeTurnDiffRuntime(window);
    evaluateRuntime(window, runtimeConfig());
    await settle(80);

    const container = host.querySelector('[data-codex-theme-native-turn-diff="true"]');
    const card = container?.querySelector(".native-turn-diff-test");
    assert.ok(card);
    assert.equal(container.getAttribute("data-codex-theme-owned"), "true");
    assert.equal(container.nextElementSibling, assistantActionRow);
    assert.equal(host.querySelector(".codex-theme-chat-turn-diff"), null);
    assert.equal(card.textContent, "Edited filesUndoReview changes");
    assert.equal(nativeRuntime.calls.createRoot, 1);
    const latestRender = nativeRuntime.calls.renders.at(-1);
    assert.equal(latestRender.componentProps.item.unifiedDiff, unifiedDiff);
    assert.equal(latestRender.componentProps.conversationId, "chat-thread-1");
    assert.equal(latestRender.componentProps.cwd, "/Users/dawn/Code.noindex/codex-theme");
    assert.equal(latestRender.componentProps.isInProgress, false);
    assert.equal(latestRender.providers.length, 1);
    assert.equal(latestRender.providers[0].type, providerType);
    assert.equal(latestRender.providers[0].value, providerValue);

    itemFiber.memoizedProps.conversationDetailLevel = "STEPS_CODE";
    window.__codexThemeRuntime.refresh();
    await settle();
    assert.equal(host.querySelector('[data-codex-theme-native-turn-diff="true"]'), null);
    assert.equal(nativeRuntime.calls.unmounts, 1);
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("ChatGPT prose mode waits for turn completion before mounting the full native diff card", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const { host, itemFiber } = attachFakeChatTurnDiffFiber(window, {
      isTurnInProgress: true,
    });
    const nativeRuntime = installFakeNativeTurnDiffRuntime(window);
    evaluateRuntime(window, runtimeConfig());
    await settle(80);

    assert.equal(host.querySelector('[data-codex-theme-native-turn-diff="true"]'), null);
    assert.equal(nativeRuntime.calls.createRoot, 0);

    itemFiber.memoizedProps.isTurnInProgress = false;
    window.__codexThemeRuntime.refresh();
    await settle(80);

    assert.ok(host.querySelector('[data-codex-theme-native-turn-diff="true"]'));
    assert.equal(nativeRuntime.calls.createRoot, 1);
    assert.equal(nativeRuntime.calls.renders.at(-1).componentProps.isInProgress, false);
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("ChatGPT prose mode exposes completed and running commands inline and in redacted Codex details", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const { execRows, host, itemFiber } = attachFakeChatTurnDiffFiber(window, {
      extraItems: [
        {
          type: "command-execution",
          parsedCmd: {
            cmd: 'OPENAI_API_KEY=top-secret npm test --token "private token"',
          },
          status: "completed",
        },
        {
          type: "command-execution",
          parsedCmd: { cmd: "sleep 30" },
          status: "running",
        },
        { type: "patch-apply", path: "src/page/runtime.mjs" },
        {
          type: "proposed-plan",
          content: "Implement the panel\n```js\nconst ready = true;\n```",
        },
        {
          type: "todo-list",
          items: [{ status: "in_progress", text: "Add details panel" }],
        },
        { type: "mcp-tool-call", server: "github", tool: "get_pull_request" },
        { type: "web-search", query: "Codex code review" },
      ],
      isTurnInProgress: true,
    });
    installFakeNativeTurnDiffRuntime(window);
    evaluateRuntime(window, runtimeConfig());
    await settle(80);

    let panel = host.querySelector('[data-codex-theme-work-details="true"]');
    assert.ok(panel);
    assert.equal(panel.open, false);
    assert.match(panel.querySelector("summary").textContent, /Working/);
    assert.match(panel.textContent, /OPENAI_API_KEY=<redacted>/);
    assert.match(panel.textContent, /--token <redacted>/);
    assert.doesNotMatch(panel.textContent, /top-secret|private token/);
    assert.match(panel.textContent, /src\/page\/runtime\.mjs/);
    assert.match(panel.textContent, /const ready = true;/);
    assert.match(panel.textContent, /Add details panel/);
    assert.match(panel.textContent, /github · get_pull_request/);
    assert.match(panel.textContent, /Codex code review/);
    assert.equal(
      execRows[0].summary.textContent,
      "OPENAI_API_KEY=<redacted> npm test --token <redacted>",
    );
    assert.equal(execRows[0].icon.isConnected, true);
    assert.equal(execRows[0].label.className, "exec-label text-secondary");
    assert.equal(execRows[1].body, null);
    assert.equal(execRows[1].summary.textContent, "sleep 30");
    assert.equal(execRows[1].icon.isConnected, true);
    assert.equal(execRows[1].label.className, "exec-label text-secondary");
    assert.equal(
      execRows[0].summary.getAttribute("data-codex-theme-work-command-summary"),
      "true",
    );
    assert.equal(
      execRows[0].summary.getAttribute("data-codex-theme-work-command"),
      "OPENAI_API_KEY=<redacted> npm test --token <redacted>",
    );

    panel.open = true;
    window.__codexThemeRuntime.refresh();
    await settle();
    panel = host.querySelector('[data-codex-theme-work-details="true"]');
    assert.equal(panel.open, true);

    itemFiber.memoizedProps.conversationDetailLevel = "STEPS_CODE";
    window.__codexThemeRuntime.refresh();
    await settle();
    assert.equal(host.querySelector('[data-codex-theme-work-details="true"]'), null);
    assert.equal(execRows[0].summary.textContent, "Ran command");
    assert.equal(execRows[0].icon.isConnected, true);
    assert.equal(execRows[0].label.className, "exec-label text-secondary");
    assert.equal(
      execRows[0].summary.hasAttribute("data-codex-theme-work-command-summary"),
      false,
    );
    assert.equal(execRows[0].summary.hasAttribute("data-codex-theme-work-command"), false);
    assert.equal(execRows[1].summary.textContent, "Running command");
    assert.equal(execRows[1].icon.isConnected, true);
    assert.equal(execRows[1].label.className, "exec-label text-secondary");
    assert.equal(
      execRows[1].summary.hasAttribute("data-codex-theme-work-command-summary"),
      false,
    );
    assert.equal(execRows[1].summary.hasAttribute("data-codex-theme-work-command"), false);
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("ChatGPT transcript turns reuse the native card at their real turn-key host", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const { host, itemFiber } = attachFakeChatTurnDiffFiber(window, {
      chatGptTranscript: true,
    });
    const nativeRuntime = installFakeNativeTurnDiffRuntime(window);
    assert.equal(itemFiber.memoizedProps.conversationDetailLevel, undefined);

    evaluateRuntime(window, runtimeConfig());
    await settle(80);

    const container = host.querySelector(
      '[data-codex-theme-native-turn-diff="true"]',
    );
    assert.ok(container);
    assert.equal(container.dataset.diffKey, "chat-thread-1:turn-diff-1");
    assert.equal(nativeRuntime.calls.renders.length > 0, true);

    host.removeAttribute("data-content-search-turn-key");
    window.__codexThemeRuntime.refresh();
    await settle();
    assert.equal(host.querySelector('[data-codex-theme-native-turn-diff="true"]'), null);
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("each transcript turn places its native card before the assistant action row", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const turns = attachFakeTranscriptTurnDiffFibers(window, ["turn-a", "turn-b", "turn-c"]);
    const nativeRuntime = installFakeNativeTurnDiffRuntime(window);
    evaluateRuntime(window, runtimeConfig());
    await settle(100);

    assert.equal(nativeRuntime.calls.createRoot, 3);
    assert.equal(nativeRuntime.calls.renders.length >= 3, true);
    for (const { actionRow, host, response, turnId } of turns) {
      const container = host.querySelector(
        '[data-codex-theme-native-turn-diff="true"]',
      );
      assert.ok(container);
      assert.equal(container.dataset.diffKey, `chat-thread-1:${turnId}`);
      assert.equal(container.parentElement, response);
      assert.equal(container.nextElementSibling, actionRow);
      assert.equal(container.querySelector(".native-turn-diff-test") != null, true);
    }
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("a late assistant action row moves an existing native card into Codex order", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const { host, response } = attachFakeChatTurnDiffFiber(window, { actionRow: false });
    installFakeNativeTurnDiffRuntime(window);
    evaluateRuntime(window, runtimeConfig());
    await settle(80);

    const container = host.querySelector('[data-codex-theme-native-turn-diff="true"]');
    assert.ok(container);
    assert.equal(host.lastElementChild, container);

    const actionRow = appendFakeAssistantActionRow(window, response);
    window.__codexThemeRuntime.refresh();
    await settle(80);

    assert.equal(container.parentElement, response);
    assert.equal(container.nextElementSibling, actionRow);
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("current app surface tokens are themed without hiding pricing or upgrade UI", () => {
  const css = createThemeCss("data:image/jpeg;base64,aW1hZ2U=");

  assert.match(css, /--color-background-primary-soft: var\(--codex-chat-input\)/);
  assert.match(css, /--color-surface-elevated-secondary: var\(--codex-chat-input\)/);
  assert.match(css, /--color-codex-editor-inline-code-background: var\(--codex-chat-code\)/);
  assert.match(css, /\[data-codex-theme-wallpaper-root="true"\] \{/);
  assert.match(css, /\.app-shell-left-panel \{[\s\S]*border-inline-end-color: transparent/);
  assert.match(css, /\.codex-theme-work-details \{/);
  assert.match(
    css,
    /\[data-codex-theme-native-turn-diff="true"\] \{[\s\S]*?margin-block-start: 20px;[\s\S]*?margin-inline: 0;/,
  );
  assert.doesNotMatch(css, /data-codex-theme-work-command-summary/);
  assert.doesNotMatch(css, /\.codex-theme-chat-turn-diff/);
  assert.doesNotMatch(css, /pro_variant/);
  assert.doesNotMatch(css, /#pricing/);
});

test("the native top and bottom fades are removed without changing their layout", () => {
  const css = createThemeCss("data:image/jpeg;base64,aW1hZ2U=");

  assert.doesNotMatch(css, /--codex-chat-bottom-scrim/);
  assert.match(css, /background-size: cover, cover/);
  assert.match(css, /background-position: center center, center center/);
  assert.match(
    css,
    /:is\([\s\S]*?\[class\*="_MainContentTopFade_"\][\s\S]*?\.pointer-events-none\.absolute\.inset-x-0\.bottom-0\.z-0\.h-full\.bg-gradient-to-t\.from-surface\.via-surface[\s\S]*?\) \{[\s\S]*?background-image: none !important;/,
  );
  assert.doesNotMatch(
    css,
    /\.pointer-events-none\.absolute\.inset-x-0\.bottom-0[\s\S]{0,240}display: none/,
  );
});

test("active composer rainbow is the native surface background without corner gaps", () => {
  const css = createThemeCss("data:image/jpeg;base64,aW1hZ2U=");

  assert.match(
    css,
    /\.codex-theme-rainbow-canvas \{[\s\S]*?inset: 0;[\s\S]*?width: 100%;[\s\S]*?height: 100%;/,
  );
  assert.match(
    css,
    /\.codex-theme-rainbow-canvas \{[\s\S]*?z-index: -1;[\s\S]*?border-radius: inherit;/,
  );
  assert.match(
    css,
    /\.codex-theme-rainbow-canvas \{[\s\S]*?overflow: hidden;[\s\S]*?corner-shape: inherit;/,
  );
  assert.match(css, /\.codex-theme-rainbow-canvas \{[\s\S]*?mix-blend-mode: screen;/);
  assert.match(
    css,
    /\[data-codex-theme-rainbow-active="true"\][\s\S]*?opacity: 0\.68;/,
  );
  assert.doesNotMatch(css, /\.codex-theme-rainbow-canvas \{[\s\S]*?inset: -3px;/);
  assert.doesNotMatch(css, /\.codex-theme-rainbow-canvas \{[\s\S]*?calc\(100% \+ 6px\)/);
  assert.doesNotMatch(
    css,
    /\.codex-theme-rainbow-canvas \{[\s\S]*?clip-path: inset\(0 round/,
  );
});

test("one current main surface owns the wallpaper across nested layout surfaces", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const currentSurface = window.document.querySelector("[data-app-shell-main-surface]");
    const nestedSurface = window.document.createElement("section");
    nestedSurface.className = "abc_MainContentSurface_nested";
    currentSurface.appendChild(nestedSurface);

    evaluateRuntime(window, runtimeConfig());
    await settle();

    assert.equal(
      currentSurface.getAttribute("data-codex-theme-wallpaper-root"),
      "true",
    );
    assert.equal(nestedSurface.hasAttribute("data-codex-theme-wallpaper-root"), false);
    assert.equal(
      window.document.querySelectorAll('[data-codex-theme-wallpaper-root="true"]').length,
      1,
    );
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("rapid composer activity changes reuse one canvas through the fade", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    evaluateRuntime(window, runtimeConfig({ rainbowPreview: false }));
    await settle();
    const runtime = window.__codexThemeRuntime;
    const button = window.document.querySelector(".activity-button");
    const canvas = window.document.querySelector(".codex-theme-rainbow-canvas");
    assert.equal(runtime.inspect().composer.active, true);

    button.setAttribute("aria-label", "Send");
    button.textContent = "Send";
    await settle(60);
    assert.equal(runtime.inspect().composer.active, false);
    assert.equal(window.document.querySelector(".codex-theme-rainbow-canvas"), canvas);

    button.setAttribute("aria-label", "Stop");
    button.textContent = "Stop";
    await settle(30);
    assert.equal(runtime.inspect().composer.active, true);
    assert.equal(window.document.querySelector(".codex-theme-rainbow-canvas"), canvas);
    assert.equal(runtime.inspect().nodes.composerCanvases, 1);
    assert.equal(runtime.inspect().diagnostics.composerCanvasCreates, 1);
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("a collapsed active project keeps the global usage rainbow running", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const project = window.document.createElement("div");
    project.setAttribute("data-app-action-sidebar-project-row", "");
    project.setAttribute("data-app-action-sidebar-project-id", "project-1");
    project.setAttribute("data-app-action-sidebar-project-collapsed", "true");
    project.setAttribute("aria-current", "page");
    project.innerHTML = '<span aria-label="Subscribed: active"></span>';
    window.document.querySelector("[data-app-action-sidebar-scroll]").appendChild(project);
    const button = window.document.querySelector(".activity-button");
    button.setAttribute("aria-label", "Send");
    button.textContent = "Send";

    evaluateRuntime(window, runtimeConfig({ rainbowPreview: false }));
    await settle(70);
    const inspection = window.__codexThemeRuntime.inspect();

    assert.equal(inspection.composer.active, false);
    assert.equal(inspection.activity.collapsedProjectActive, true);
    assert.equal(inspection.activity.active, true);
    assert.equal(window.document.documentElement.dataset.codexThemeSessionActive, "true");
    assert.equal(inspection.fire.active, true);
    assert.equal(inspection.fire.sessionKey, "project:project-1");
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});

test("a version replacement disposes the old runtime once and preserves one UI set", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    evaluateRuntime(window, runtimeConfig());
    await settle();
    const oldRuntime = window.__codexThemeRuntime;

    evaluateRuntime(window, runtimeConfig({ version: 23 }));
    await settle();
    const newRuntime = window.__codexThemeRuntime;

    assert.notEqual(newRuntime, oldRuntime);
    assert.equal(oldRuntime.inspect().disposed, true);
    assert.equal(newRuntime.inspect().nodes.usagePanels, 1);
    assert.equal(newRuntime.inspect().nodes.composerCanvases, 1);
    assert.equal(newRuntime.inspect().nodes.fireLayers, 1);
    assert.equal(
      window.document.querySelectorAll('[data-codex-theme-wallpaper-root="true"]').length,
      1,
    );
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});
