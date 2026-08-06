#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${CODEX_THEME_INSTALL_DIR:-${HOME}/Applications/Codex Theme}"
APP_SOURCE="${SCRIPT_DIR}/Codex.app"
APP_DESTINATION="${INSTALL_ROOT}/Codex.app"
LAUNCHER_SOURCE="${SCRIPT_DIR}/CodexLauncher.swift"
LAUNCHER_DESTINATION="${APP_DESTINATION}/Contents/MacOS/CodexTheme"

fail() {
  print -u2 "Codex Theme install failed: $1"
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS is required."
command -v node >/dev/null 2>&1 || fail "Node.js is required and must be available as 'node'."

if [[ ! -x /Applications/ChatGPT.app/Contents/MacOS/ChatGPT \
  && ! -x /Applications/Codex.app/Contents/MacOS/Codex ]]; then
  fail "Install Codex or ChatGPT in /Applications first."
fi

for required_path in \
  "${APP_SOURCE}" \
  "${LAUNCHER_SOURCE}" \
  "${SCRIPT_DIR}/codex-theme.mjs" \
  "${SCRIPT_DIR}/image.jpg" \
  "${SCRIPT_DIR}/fire.gif"; do
  [[ -e "${required_path}" ]] || fail "Missing ${required_path:t}."
done

mkdir -p "${INSTALL_ROOT}"
/usr/bin/ditto "${APP_SOURCE}" "${APP_DESTINATION}"
/usr/bin/install -m 755 "${SCRIPT_DIR}/codex-theme.mjs" "${INSTALL_ROOT}/codex-theme.mjs"
/usr/bin/install -m 644 "${SCRIPT_DIR}/image.jpg" "${INSTALL_ROOT}/image.jpg"
/usr/bin/install -m 644 "${SCRIPT_DIR}/fire.gif" "${INSTALL_ROOT}/fire.gif"

if command -v swiftc >/dev/null 2>&1; then
  swiftc \
    -O \
    -target "$(uname -m)-apple-macosx12.0" \
    "${LAUNCHER_SOURCE}" \
    -o "${LAUNCHER_DESTINATION}"
else
  bundled_architectures="$(/usr/bin/lipo -archs "${LAUNCHER_DESTINATION}" 2>/dev/null || true)"
  [[ " ${bundled_architectures} " == *" $(uname -m) "* ]] \
    || fail "Xcode Command Line Tools are required to build the launcher for $(uname -m). Run 'xcode-select --install'."
fi

/usr/bin/codesign --force --deep --sign - "${APP_DESTINATION}" >/dev/null

node "${INSTALL_ROOT}/codex-theme.mjs" \
  --image "${INSTALL_ROOT}/image.jpg" \
  --fire "${INSTALL_ROOT}/fire.gif" \
  --dry-run

print ""
print "Installed Codex Theme at:"
print "  ${APP_DESTINATION}"
print ""
print "Launch it with:"
print "  open '${APP_DESTINATION}'"
