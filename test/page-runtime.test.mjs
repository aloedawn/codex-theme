import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import { installPageRuntime } from "../src/page/runtime.mjs";
import { createThemeCss } from "../src/page/styles.mjs";

const fixture = `<!doctype html>
<html class="dark">
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
        <div class="h-toolbar">
          <button class="sidebar-item" type="button">Dawn</button>
        </div>
      </div>
    </aside>
    <main data-app-shell-main-surface>
      <form style="border-radius: 22px">
        <textarea></textarea>
        <button class="activity-button" type="button" aria-label="Stop">Stop</button>
      </form>
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
    if (this.tagName === "FORM") return rectangle(820, 790, 900, 120);
    if (this.tagName === "TEXTAREA") return rectangle(850, 820, 760, 42);
    if (this.classList.contains("codex-theme-rainbow-canvas")) return rectangle(817, 787, 906, 126);
    if (this.classList.contains("server-label")) return rectangle(420, 140, 120, 28);
    if (this.classList.contains("server-row")) return rectangle(20, 130, 600, 48);
    if (this.classList.contains("h-toolbar")) return rectangle(0, 930, 640, 70);
    if (this.tagName === "BUTTON") return rectangle(40, 940, 560, 44);
    return rectangle(20, 100, 400, 40);
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({
    setTransform() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    set lineWidth(_) {},
    set lineCap(_) {},
    set lineJoin(_) {},
    set strokeStyle(_) {},
  });
  return dom;
}

function runtimeConfig(overrides = {}) {
  return {
    version: 2,
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

test("same-version evaluation is idempotent and keeps animation nodes", async () => {
  const dom = createDom();
  const { window } = dom;
  try {
    evaluateRuntime(window, runtimeConfig());
    await settle();
    const firstRuntime = window.__codexThemeRuntime;
    const firstCanvas = window.document.querySelector(".codex-theme-rainbow-canvas");
    const firstFireLayer = window.document.querySelector(".codex-theme-thumb-fire-layer");

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

    evaluateRuntime(window, runtimeConfig({ version: 3 }));
    await settle();
    const newRuntime = window.__codexThemeRuntime;

    assert.notEqual(newRuntime, oldRuntime);
    assert.equal(oldRuntime.inspect().disposed, true);
    assert.equal(newRuntime.inspect().nodes.usagePanels, 1);
    assert.equal(newRuntime.inspect().nodes.composerCanvases, 1);
    assert.equal(newRuntime.inspect().nodes.fireLayers, 1);
  } finally {
    window.__codexThemeRuntime?.dispose();
    dom.window.close();
  }
});
