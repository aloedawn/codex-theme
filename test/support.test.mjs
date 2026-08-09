import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PINNED_SSH_ALIASES,
  normalizeUsagePayload,
  parsePinnedSshHosts,
} from "../src/host/support.mjs";

test("usage normalization selects the limiting window", () => {
  const usage = normalizeUsagePayload({
    rate_limit: {
      primary_window: {
        used_percent: 20,
        limit_window_seconds: 18_000,
        reset_at: 2_000_000_000,
      },
      secondary_window: {
        used_percent: 75,
        limit_window_seconds: 604_800,
        reset_at: 2_000_100_000,
      },
    },
  }, 1234);

  assert.deepEqual(usage, {
    remainingPercent: 25,
    resetAtMs: 2_000_100_000_000,
    capturedAtMs: 1234,
  });
});

test("all documented Oracle aliases are parsed without wildcard hosts", () => {
  assert.equal(PINNED_SSH_ALIASES.has("Oracle_osaka"), true);
  assert.equal(PINNED_SSH_ALIASES.has("Oracle_chuncheon"), true);

  const temporaryPath = fs.mkdtempSync(path.join(os.tmpdir(), "codex-theme-ssh-"));
  const configPath = path.join(temporaryPath, "config");
  try {
    fs.writeFileSync(configPath, [
      "Host Oracle_osaka",
      "  HostName osaka.example.invalid",
      "  Port 2201",
      "Host Oracle_chuncheon",
      "  HostName chuncheon.example.invalid",
      "Host *",
      "  Port 9999",
    ].join("\n"));

    assert.deepEqual(parsePinnedSshHosts(configPath), {
      Oracle_osaka: {
        alias: "Oracle_osaka",
        hostname: "osaka.example.invalid",
        port: 2201,
      },
      Oracle_chuncheon: {
        alias: "Oracle_chuncheon",
        hostname: "chuncheon.example.invalid",
        port: 22,
      },
    });
  } finally {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
});
