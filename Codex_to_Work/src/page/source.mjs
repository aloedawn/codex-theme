import { installPageRuntime } from "./runtime.mjs";
import { createThemeCss } from "./styles.mjs";

export const PAGE_RUNTIME_VERSION = 24;

export function createPageSource(
  imageDataUrl,
  fireDataUrl,
  { rainbowPreview = false, usageManagedByHost = false } = {},
) {
  const config = {
    version: PAGE_RUNTIME_VERSION,
    css: createThemeCss(imageDataUrl),
    fireDataUrl,
    rainbowPreview,
    usageManagedByHost,
    imageBytes: Buffer.byteLength(imageDataUrl, "utf8"),
  };
  return `(${installPageRuntime.toString()})(${JSON.stringify(config)})`;
}
