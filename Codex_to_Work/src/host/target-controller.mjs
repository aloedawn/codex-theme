export function isCodexPage(targetInfo) {
  if (targetInfo?.type !== "page") return false;
  const url = targetInfo.url ?? "";
  const title = targetInfo.title ?? "";
  if (/avatar-overlay|devtools:|chrome-extension:|web-sandbox/i.test(url)) return false;
  return /webview\/index\.html|app:\/\/|codex:\/\//i.test(url)
    || /^(Codex|ChatGPT)$/i.test(title);
}

export class TargetController {
  constructor({
    cdp,
    source,
    pushUiState,
    onReady = async () => {},
    eligible = isCodexPage,
    logger = console,
    retryDelaysMs = [250, 1_000, 3_000],
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
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
    this.records = new Map();
    this.sessionTargets = new Map();
    this.disposed = false;
  }

  sessionIds() {
    return Array.from(this.records.values())
      .map((record) => record.sessionId)
      .filter(Boolean);
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
        exhausted: false,
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
    if (
      this.disposed
      || this.records.get(targetId) !== record
      || record.sessionId
      || record.attachPromise
      || record.retryTimer
      || record.exhausted
    ) {
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
        flatten: true,
      });
      sessionId = attached.sessionId;
      if (!sessionId) throw new Error("CDP 세션 ID를 받지 못했습니다.");
      if (!this.#isCurrent(targetId, record, generation)) {
        await this.#detachQuietly(sessionId);
        return;
      }

      record.sessionId = sessionId;
      this.sessionTargets.set(sessionId, targetId);
      await Promise.all([
        this.cdp.send("Page.enable", {}, sessionId),
        this.cdp.send("Runtime.enable", {}, sessionId),
        this.cdp.send("Network.enable", {}, sessionId),
      ]);
      if (!this.#isCurrent(targetId, record, generation)) return;

      await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: this.source }, sessionId);
      const result = await this.cdp.send(
        "Runtime.evaluate",
        {
          expression: this.source,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "주입 중 예외가 발생했습니다.");
      }
      if (!this.#isCurrent(targetId, record, generation)) return;

      await this.pushUiState(sessionId);
      if (!this.#isCurrent(targetId, record, generation)) return;
      record.retryCount = 0;
      record.exhausted = false;
      this.logger.log(
        `[wallpaper] 적용 완료: ${record.targetInfo.title || record.targetInfo.url || targetId}`,
      );
      try {
        await this.onReady({ targetId, sessionId, targetInfo: record.targetInfo });
      } catch (error) {
        this.logger.error(`[wallpaper] 적용 후 진단에 실패했습니다: ${error.message}`);
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
    return !this.disposed
      && this.records.get(targetId) === record
      && record.generation === generation;
  }

  #scheduleRetry(targetId, record) {
    if (
      this.disposed
      || this.records.get(targetId) !== record
      || !this.eligible(record.targetInfo)
      || record.retryTimer
    ) {
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
    } catch {}
  }
}
