import { installPageRuntime } from "./runtime.mjs";
import { createThemeCss } from "./styles.mjs";

export const PAGE_RUNTIME_VERSION = 2;

export function createPageSource(imageDataUrl, fireDataUrl, { rainbowPreview = false } = {}) {
  const config = {
    version: PAGE_RUNTIME_VERSION,
    css: createThemeCss(imageDataUrl),
    fireDataUrl,
    rainbowPreview,
    imageBytes: Buffer.byteLength(imageDataUrl, "utf8"),
  };
  return `(${installPageRuntime.toString()})(${JSON.stringify(config)})`;
}
