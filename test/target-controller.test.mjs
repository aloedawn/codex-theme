import assert from "node:assert/strict";
import test from "node:test";

import { TargetController } from "../src/host/target-controller.mjs";

const targetInfo = {
  targetId: "target-1",
  type: "page",
  url: "app://-/index.html",
  title: "Codex",
};

class FakeCdp {
  constructor(handler = null) {
    this.calls = [];
    this.handler = handler;
  }

  async send(method, params = {}, sessionId) {
    this.calls.push({ method, params, sessionId });
    if (this.handler) {
      const result = await this.handler(method, params, sessionId, this.calls.length);
      if (result !== undefined) return result;
    }
    if (method === "Target.attachToTarget") return { sessionId: "session-1" };
    return {};
  }

  count(method) {
    return this.calls.filter((call) => call.method === method).length;
  }
}

test("targetInfoChanged never reinjects an attached target", async () => {
  const cdp = new FakeCdp();
  let pushes = 0;
  const controller = new TargetController({
    cdp,
    source: "globalThis.__themeInstalled = true",
    pushUiState: async () => { pushes += 1; },
    logger: { log() {}, error() {} },
  });

  await controller.handleTargetInfo(targetInfo);
  for (let index = 0; index < 100; index += 1) {
    await controller.handleTargetInfo({ ...targetInfo, title: `Codex ${index}` });
  }

  assert.equal(cdp.count("Target.attachToTarget"), 1);
  assert.equal(cdp.count("Page.addScriptToEvaluateOnNewDocument"), 1);
  assert.equal(cdp.count("Runtime.evaluate"), 1);
  assert.equal(pushes, 1);
  assert.deepEqual(controller.sessionIds(), ["session-1"]);
  controller.dispose();
});

test("concurrent target events share one attachment", async () => {
  let releaseAttachment;
  const attachment = new Promise((resolve) => { releaseAttachment = resolve; });
  const cdp = new FakeCdp(async (method) => {
    if (method === "Target.attachToTarget") return attachment;
    return undefined;
  });
  const controller = new TargetController({
    cdp,
    source: "true",
    pushUiState: async () => {},
    logger: { log() {}, error() {} },
  });

  const first = controller.handleTargetInfo(targetInfo);
  const duplicates = Array.from({ length: 20 }, () => controller.handleTargetInfo(targetInfo));
  releaseAttachment({ sessionId: "session-1" });
  await Promise.all([first, ...duplicates]);

  assert.equal(cdp.count("Target.attachToTarget"), 1);
  assert.equal(cdp.count("Runtime.evaluate"), 1);
  controller.dispose();
});

test("destroying a target cancels its bounded retry", async () => {
  const timers = new Map();
  let nextTimerId = 1;
  const cdp = new FakeCdp(async (method) => {
    if (method === "Target.attachToTarget") throw new Error("Session with given id not found");
    return undefined;
  });
  const controller = new TargetController({
    cdp,
    source: "true",
    pushUiState: async () => {},
    logger: { log() {}, error() {} },
    setTimeoutFn(callback) {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
  });

  await controller.handleTargetInfo(targetInfo);
  assert.equal(cdp.count("Target.attachToTarget"), 1);
  assert.equal(timers.size, 1);

  const pendingCallback = timers.values().next().value;
  controller.handleTargetDestroyed(targetInfo.targetId);
  assert.equal(timers.size, 0);
  pendingCallback();
  await Promise.resolve();

  assert.equal(cdp.count("Target.attachToTarget"), 1);
  assert.deepEqual(controller.sessionIds(), []);
  controller.dispose();
});

test("retry exhaustion is stable across later title changes", async () => {
  const timers = [];
  const cdp = new FakeCdp(async (method) => {
    if (method === "Target.attachToTarget") throw new Error("Session with given id not found");
    return undefined;
  });
  const controller = new TargetController({
    cdp,
    source: "true",
    pushUiState: async () => {},
    logger: { log() {}, error() {} },
    retryDelaysMs: [1, 1, 1],
    setTimeoutFn(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeoutFn() {},
  });

  await controller.handleTargetInfo(targetInfo);
  while (timers.length > 0) {
    const callback = timers.shift();
    callback();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(cdp.count("Target.attachToTarget"), 4);

  for (let index = 0; index < 50; index += 1) {
    await controller.handleTargetInfo({ ...targetInfo, title: `Codex ${index}` });
  }
  assert.equal(cdp.count("Target.attachToTarget"), 4);
  controller.dispose();
});

test("an attachment resolved after target destruction never evaluates page code", async () => {
  let releaseAttachment;
  const attachment = new Promise((resolve) => { releaseAttachment = resolve; });
  const cdp = new FakeCdp(async (method) => {
    if (method === "Target.attachToTarget") return attachment;
    return undefined;
  });
  const controller = new TargetController({
    cdp,
    source: "true",
    pushUiState: async () => {},
    logger: { log() {}, error() {} },
  });

  const attaching = controller.handleTargetInfo(targetInfo);
  controller.handleTargetDestroyed(targetInfo.targetId);
  releaseAttachment({ sessionId: "stale-session" });
  await attaching;

  assert.equal(cdp.count("Runtime.evaluate"), 0);
  assert.equal(cdp.count("Target.detachFromTarget"), 1);
  controller.dispose();
});
