import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = path.join(repositoryPath, "src", "main.mjs");
const outputPath = path.join(repositoryPath, "codex-theme.mjs");

async function buildBundle(destination) {
  await build({
    entryPoints: [entryPath],
    outfile: destination,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    legalComments: "none",
    charset: "utf8",
    sourcemap: false,
    minify: false,
  });
  const bundle = fs.readFileSync(destination, "utf8");
  assert.ok(bundle.startsWith("#!/usr/bin/env node\n"), "bundle must retain one shebang");
  assert.doesNotMatch(
    bundle,
    /\b__name\(/,
    "bundle must not inject an out-of-scope helper into the stringified page runtime",
  );
  fs.chmodSync(destination, 0o755);
}

if (process.argv.includes("--check")) {
  const temporaryPath = fs.mkdtempSync(path.join(os.tmpdir(), "codex-theme-build-"));
  const candidatePath = path.join(temporaryPath, "codex-theme.mjs");
  try {
    await buildBundle(candidatePath);
    assert.equal(
      fs.readFileSync(candidatePath, "utf8"),
      fs.readFileSync(outputPath, "utf8"),
      "codex-theme.mjs is stale; run npm run build",
    );
    console.log("[build] codex-theme.mjs is current.");
  } finally {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
} else {
  await buildBundle(outputPath);
  console.log(`[build] wrote ${path.relative(repositoryPath, outputPath)}`);
}
