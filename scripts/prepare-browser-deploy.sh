#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
FORGE_BIN="${FORGE_BIN:-arc-forge}"
command -v "$FORGE_BIN" >/dev/null
npm test
npm run typecheck
"$FORGE_BIN" test -vvv
FOUNDRY_PROFILE=arc "$FORGE_BIN" test -vvv
FORGE_BIN="$FORGE_BIN" node scripts/check-abi.mjs
FOUNDRY_PROFILE=arc "$FORGE_BIN" build
FORGE_BIN="$FORGE_BIN" node scripts/prepare-browser-deploy.mjs "${1:-testnet}"
