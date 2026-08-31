import { spawn } from "node:child_process";

import { normalizeAppServerRateLimits } from "./support.mjs";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class AppServerRateLimitClient {
  constructor(executablePath, {
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    spawnProcess = spawn,
  } = {}) {
    this.executablePath = executablePath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.spawnProcess = spawnProcess;
    this.child = null;
    this.startPromise = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.nextRequestId = 1;
    this.pendingRequests = new Map();
  }

  async read(capturedAtMs = Date.now()) {
    await this.ensureStarted();
    try {
      const response = await this.request("account/rateLimits/read", null);
      const usage = normalizeAppServerRateLimits(response, capturedAtMs);
      if (usage == null) throw new Error("Codex 앱 서버의 한도 응답 형식이 올바르지 않습니다");
      return usage;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async ensureStarted() {
    if (this.child != null && this.child.exitCode == null) return;
    if (this.startPromise != null) return this.startPromise;
    this.startPromise = this.start().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async start() {
    const child = this.spawnProcess(
      this.executablePath,
      ["app-server", "--listen", "stdio://"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-4_000);
    });
    child.once("error", (error) => this.handleTermination(error));
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      const detail = this.stderrBuffer.trim();
      const reason = signal
        ? `Codex 앱 서버가 ${signal} 신호로 종료되었습니다`
        : `Codex 앱 서버가 종료되었습니다. 코드=${code ?? "unknown"}`;
      this.handleTermination(new Error(detail ? `${reason}: ${detail}` : reason));
    });

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "codex-theme",
          title: "Codex Theme",
          version: "2.0.0",
        },
      });
      this.notify("initialized");
    } catch (error) {
      this.close();
      throw error;
    }
  }

  request(method, params) {
    const child = this.child;
    if (child == null || child.exitCode != null || !child.stdin.writable) {
      return Promise.reject(new Error("Codex 앱 서버 연결이 열려 있지 않습니다"));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex 앱 서버 요청 시간이 초과되었습니다: ${method}`));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(id, { method, reject, resolve, timeout });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error == null) return;
        const pending = this.pendingRequests.get(id);
        if (pending == null) return;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(id);
        pending.reject(error);
      });
    });
  }

  notify(method, params) {
    const child = this.child;
    if (child == null || child.exitCode != null || !child.stdin.writable) return false;
    child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
    return true;
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = this.pendingRequests.get(message?.id);
      if (pending == null) continue;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      if (message.error != null) {
        pending.reject(new Error(
          message.error.message || `Codex 앱 서버 요청이 실패했습니다: ${pending.method}`,
        ));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  handleTermination(error) {
    this.child = null;
    this.stdoutBuffer = "";
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  close() {
    const child = this.child;
    this.child = null;
    this.startPromise = null;
    this.stdoutBuffer = "";
    const error = new Error("Codex 앱 서버 연결을 닫았습니다");
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    if (child != null && child.exitCode == null && !child.killed) child.kill("SIGTERM");
  }
}
