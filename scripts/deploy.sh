#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEPLOYER_ACCOUNT:?Set DEPLOYER_ACCOUNT to your locally encrypted Arc Foundry keystore alias. Never paste a key into chat.}"
FORGE_BIN="${FORGE_BIN:-arc-forge}"
NETWORK="${NETWORK:-testnet}"
case "$NETWORK" in
  testnet) RPC="https://rpc.testnet.arc.io"; CHAIN=5042002;;
  mainnet)
    [[ "${CONFIRM_MAINNET:-}" == "DEPLOY_CAPPED_EXPERIMENT" ]] || { echo "Mainnet disabled. Explicit owner confirmation is required."; exit 1; }
    RPC="https://rpc.mainnet.arc.io"; CHAIN=5042;;
  *) echo "Unknown network"; exit 1;;
esac
command -v "$FORGE_BIN" >/dev/null
npm test
"$FORGE_BIN" test -vvv
FOUNDRY_PROFILE=arc "$FORGE_BIN" test -vvv
FORGE_BIN="$FORGE_BIN" node scripts/check-abi.mjs
FOUNDRY_PROFILE=arc "$FORGE_BIN" create contracts/SettleRef.sol:SettleRef --rpc-url "$RPC" --chain "$CHAIN" --account "$DEPLOYER_ACCOUNT" --broadcast --json | tee "evidence/deployment-${NETWORK}.json"
echo "Deployment command completed. Pin and compare runtime using scripts/pin-deployment.mjs before enabling writes."
