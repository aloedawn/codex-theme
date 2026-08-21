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
    version: 14,
    css: createThemeCss("data:image/jpeg;base64,aW1hZ2U="),
    fireDataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    rainbowPreview: true,
    imageBytes: 32,
    timings: { rainbowGraceMs: 10, usageGraceMs: 10 },
    ...overrides,
  };
}

function evaluateRuntime(window, config) {
  return window.eval(`(${installPageRuntime.toString()})(${JSON.stringify(config)})`);
}

function settle(milliseconds = 40) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function attachFakeChatTurnDiffFiber(window, { chatGptTranscript = false } = {}) {
  const main = window.document.querySelector("[data-app-shell-main-surface]");
  const host = window.document.createElement("div");
  host.className = "chat-turn-item-host";
  if (chatGptTranscript) {
    host.setAttribute("data-content-search-turn-key", "turn-1");
  }
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
    turn: {
      id: "turn-1",
      items: [
        { id: "user-message-1", type: "user-message", content: "Update the theme" },
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
  itemFiber.return = providerFiber;
  rootFiber.child = mainFiber;
  mainFiber.child = hostFiber;
  hostFiber.child = providerFiber;
  Object.defineProperty(main, "__reactFiber$codexThemeTest", {
    configurable: true,
    value: mainFiber,
  });
  return { host, itemFiber, providerType, providerValue, unifiedDiff };
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
    const response = window.document.createElement("p");
    response.textContent = `Response ${index + 1}`;
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
    return { host, item, itemFiber, turnId };
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
    assert.equal(
      firstCanvas?.style.getPropertyValue("--codex-theme-composer-radius"),
      "25px",
    );

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

test("ChatGPT prose mode mounts the app's native turn-diff component with live providers", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const {
      host,
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
      ':scope > [data-codex-theme-native-turn-diff="true"]',
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

test("each transcript turn with file changes ends with its own native card", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    const turns = attachFakeTranscriptTurnDiffFibers(window, ["turn-a", "turn-b", "turn-c"]);
    const nativeRuntime = installFakeNativeTurnDiffRuntime(window);
    evaluateRuntime(window, runtimeConfig());
    await settle(100);

    assert.equal(nativeRuntime.calls.createRoot, 3);
    assert.equal(nativeRuntime.calls.renders.length >= 3, true);
    for (const { host, turnId } of turns) {
      const container = host.querySelector(
        ':scope > [data-codex-theme-native-turn-diff="true"]',
      );
      assert.ok(container);
      assert.equal(container.dataset.diffKey, `chat-thread-1:${turnId}`);
      assert.equal(host.lastElementChild, container);
      assert.equal(container.querySelector(".native-turn-diff-test") != null, true);
    }
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

test("active composer rainbow fills the surface without creating overflow", () => {
  const css = createThemeCss("data:image/jpeg;base64,aW1hZ2U=");

  assert.match(
    css,
    /\.codex-theme-rainbow-canvas \{[\s\S]*?inset: 0;[\s\S]*?width: 100%;[\s\S]*?height: 100%;/,
  );
  assert.match(
    css,
    /\.codex-theme-rainbow-canvas \{[\s\S]*?border-radius: var\(--codex-theme-composer-radius, inherit\);/,
  );
  assert.match(
    css,
    /clip-path: inset\(0 round var\(--codex-theme-composer-radius, 25px\)\);/,
  );
  assert.match(css, /\.codex-theme-rainbow-canvas \{[\s\S]*?mix-blend-mode: screen;/);
  assert.match(
    css,
    /\[data-codex-theme-rainbow-active="true"\][\s\S]*?opacity: 0\.68;/,
  );
  assert.doesNotMatch(css, /\.codex-theme-rainbow-canvas \{[\s\S]*?inset: -3px;/);
  assert.doesNotMatch(css, /\.codex-theme-rainbow-canvas \{[\s\S]*?calc\(100% \+ 6px\)/);
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

    evaluateRuntime(window, runtimeConfig({ version: 15 }));
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
