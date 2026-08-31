import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PINNED_SSH_ALIASES,
  normalizeAppServerRateLimits,
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

test("usage normalization includes additional model limits", () => {
  const usage = normalizeUsagePayload({
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
    additional_rate_limits: [
      {
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
      },
    ],
  }, 1234);

  assert.deepEqual(usage, {
    remainingPercent: 39,
    resetAtMs: 2_000_300_000_000,
    capturedAtMs: 1234,
  });
});

test("app server usage normalization reads the canonical weekly Codex bucket", () => {
  const usage = normalizeAppServerRateLimits({
    rateLimits: {
      primary: {
        usedPercent: 0,
        windowDurationMins: 300,
        resetsAt: 2_000_000_000,
      },
    },
    rateLimitsByLimitId: {
      codex_bengalfox: {
        primary: {
          usedPercent: 0,
          windowDurationMins: 300,
          resetsAt: 2_000_100_000,
        },
      },
      codex: {
        primary: {
          usedPercent: 4,
          windowDurationMins: 10_080,
          resetsAt: 2_000_200_000,
        },
      },
    },
  }, 1234);

  assert.deepEqual(usage, {
    remainingPercent: 96,
    resetAtMs: 2_000_200_000_000,
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
