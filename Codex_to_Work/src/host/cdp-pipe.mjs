export class CdpPipe {
  constructor(child, { requestTimeoutMs = 15_000 } = {}) {
    this.child = child;
    this.input = child.stdio[3];
    this.output = child.stdio[4];
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.eventHandler = undefined;

    this.output.setEncoding("utf8");
    this.output.on("data", (chunk) => this.handleChunk(chunk));
    this.output.on("error", (error) => this.failAll(error));
    this.output.on("close", () => this.failAll(new Error("디버깅 파이프가 닫혔습니다.")));
  }

  handleChunk(chunk) {
    this.buffer += chunk;
    while (true) {
      const separator = this.buffer.indexOf("\0");
      if (separator < 0) break;
      const raw = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 1);
      if (!raw) continue;

      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        console.error("[wallpaper] CDP 메시지를 해석하지 못했습니다:", error.message);
        continue;
      }

      if (message.id != null) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result ?? {});
      } else if (this.eventHandler) {
        void this.eventHandler(message);
      }
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 응답 시간이 초과되었습니다.`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.input.write(`${JSON.stringify(message)}\0`);
    });
  }
}
