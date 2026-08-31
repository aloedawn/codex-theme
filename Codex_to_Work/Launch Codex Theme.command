#!/bin/zsh

SCRIPT_DIR="${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
exec node "$SCRIPT_DIR/codex-theme.mjs" "$@"
