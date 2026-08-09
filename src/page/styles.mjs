export function createThemeCss(imageDataUrl) {
  return `
:root {
  --codex-chat-secondary: rgb(250 251 250 / 80%);
  --codex-chat-input: rgb(255 255 255 / 86%);
  --codex-chat-dropdown: rgb(255 255 255 / 94%);
  --codex-chat-code: rgb(246 248 248 / 90%);
}

:root:is(.dark, .electron-dark) {
  --codex-chat-secondary: rgb(24 29 31 / 82%);
  --codex-chat-input: rgb(28 34 36 / 88%);
  --codex-chat-dropdown: rgb(24 29 31 / 94%);
  --codex-chat-code: rgb(16 21 23 / 92%);
}

[data-app-shell-main-surface],
[class*="_MainContentSurface_"] {
  --color-token-main-surface-primary: transparent !important;
  --color-token-bg-primary: transparent !important;
  --color-token-bg-secondary: var(--codex-chat-secondary) !important;
  --color-token-input-background: var(--codex-chat-input) !important;
  --color-token-dropdown-background: var(--codex-chat-dropdown) !important;
  --color-token-text-code-block-background: var(--codex-chat-code) !important;

  background-color: transparent !important;
  background-image:
    linear-gradient(rgb(0 0 0 / 60%), rgb(0 0 0 / 60%)),
    url(${JSON.stringify(imageDataUrl)}) !important;
  background-position: center center !important;
  background-repeat: no-repeat !important;
  background-size: cover !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  position: relative !important;
  isolation: isolate;
}

:where(a, [role="menuitem"])[href*="pro_variant=2x"][href*="#pricing"],
[role="menuitem"]:has(a[href*="pro_variant=2x"][href*="#pricing"]) {
  display: none !important;
}

#codex-theme-usage-panel {
  box-sizing: border-box;
  width: 100%;
  flex: none;
  margin: 0;
  padding: 9px 14px 8px;
  border-top: 1px solid rgb(127 127 127 / 18%);
  color: var(--color-token-description-foreground);
}

#codex-theme-usage-panel .codex-theme-usage-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

#codex-theme-usage-panel :is(.codex-theme-usage-value, .codex-theme-usage-reset) {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#codex-theme-usage-panel .codex-theme-usage-value {
  flex: 0 1 auto;
}

#codex-theme-usage-panel .codex-theme-usage-reset {
  flex: 0 1 auto;
  text-align: right;
}

#codex-theme-usage-panel .codex-theme-usage-track {
  position: relative;
  height: 3px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(127 127 127 / 22%);
  contain: paint;
}

#codex-theme-usage-panel .codex-theme-usage-fill {
  --codex-theme-usage-clip-right: 100%;
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  background: currentColor;
  clip-path: inset(0 var(--codex-theme-usage-clip-right) 0 0 round 999px);
  opacity: 0.72;
  transition: clip-path 180ms ease, opacity 240ms ease;
  will-change: clip-path;
}

:root[data-codex-theme-session-active="true"] #codex-theme-usage-panel .codex-theme-usage-fill {
  opacity: 1;
}

#codex-theme-usage-panel .codex-theme-usage-fill::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 250%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    hsl(0deg 100% 60%) 0%,
    hsl(60deg 100% 60%) 8.333%,
    hsl(120deg 100% 60%) 16.667%,
    hsl(180deg 100% 60%) 25%,
    hsl(240deg 100% 60%) 33.333%,
    hsl(300deg 100% 60%) 41.667%,
    hsl(360deg 100% 60%) 50%,
    hsl(60deg 100% 60%) 58.333%,
    hsl(120deg 100% 60%) 66.667%,
    hsl(180deg 100% 60%) 75%,
    hsl(240deg 100% 60%) 83.333%,
    hsl(300deg 100% 60%) 91.667%,
    hsl(360deg 100% 60%) 100%
  );
  content: "";
  opacity: 0;
  transform: translate3d(0, 0, 0);
  animation: codex-theme-usage-rainbow 3s linear infinite;
  animation-play-state: paused;
  transition: opacity 240ms ease;
  will-change: transform;
}

:root[data-codex-theme-session-active="true"] #codex-theme-usage-panel .codex-theme-usage-fill::before {
  opacity: 1;
  animation-play-state: running;
}

@keyframes codex-theme-usage-rainbow {
  to {
    transform: translate3d(-50%, 0, 0);
  }
}

[data-codex-theme-rainbow-composer="attached"] {
  position: relative !important;
  isolation: isolate;
}

.codex-theme-rainbow-canvas {
  position: absolute;
  z-index: 20;
  inset: -3px;
  width: calc(100% + 6px);
  height: calc(100% + 6px);
  pointer-events: none;
  contain: strict;
  opacity: 0;
  transform: translateZ(0);
  backface-visibility: hidden;
  transition: opacity 240ms ease;
}

[data-codex-theme-rainbow-active="true"]
  > .codex-theme-rainbow-canvas[data-ready="true"] {
  opacity: 1;
}

.codex-theme-thumb-fire-layer {
  position: absolute;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
}

.codex-theme-thumb-fire {
  position: absolute;
  display: block;
  object-fit: contain;
  object-position: center bottom;
  pointer-events: none;
  contain: strict;
  opacity: 0;
  transform: scale(var(--codex-theme-fire-scale-x, 1), var(--codex-theme-fire-scale-y, 1)) translateZ(0);
  transform-origin: 50% 100%;
  backface-visibility: hidden;
  mix-blend-mode: screen;
  transition: opacity 320ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: opacity, transform;
}

.codex-theme-thumb-fire[data-active="true"][data-ready="true"] {
  opacity: 0.96;
}

.codex-theme-server-signal {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: none;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  color: rgb(54 204 134);
  transition: color 180ms ease, opacity 180ms ease;
}

.codex-theme-server-signal[data-bars="0"] {
  color: var(--color-token-description-foreground);
  opacity: 0.48;
}

.codex-theme-server-signal svg {
  display: block;
  width: 16px;
  height: 16px;
  overflow: visible;
}

.codex-theme-server-signal-bar {
  fill: currentColor;
  opacity: 0.18;
  transition: opacity 180ms ease;
}

.codex-theme-server-signal-bar[data-active="true"] {
  opacity: 1;
}

[data-codex-theme-native-server-status="true"] {
  display: none !important;
}

@media (prefers-reduced-motion: reduce) {
  #codex-theme-usage-panel .codex-theme-usage-fill::before {
    animation-duration: 10s;
  }
}
`;
}
