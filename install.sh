#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
exec "${SCRIPT_DIR}/Work_to_Codex/install.sh" "$@"
