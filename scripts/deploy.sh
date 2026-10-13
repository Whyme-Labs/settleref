#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DEPLOYER_ACCOUNT:?Set DEPLOYER_ACCOUNT to your locally encrypted Arc Foundry keystore alias. Never paste a private key into chat, shell history, CI variables, or this repository.}"

FORGE_BIN="${FORGE_BIN:-arc-forge}"
CAST_BIN="${CAST_BIN:-arc-cast}"
NETWORK="${NETWORK:-testnet}"
OUTPUT_DIR="${OUTPUT_DIR:-evidence/sr03/owner}"

case "$NETWORK" in
  testnet)
    RPC="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.network}"
    EXPLORER="${ARC_TESTNET_EXPLORER_URL:-https://explorer.testnet.arc.io}"
    CHAIN=5042002
    ;;
  mainnet)
    [[ "${CONFIRM_MAINNET:-}" == "DEPLOY_CAPPED_EXPERIMENT" ]] || {
      echo "Mainnet disabled. Set CONFIRM_MAINNET=DEPLOY_CAPPED_EXPERIMENT only after reviewing the exact source, wallet and funding amount." >&2
      exit 1
    }
    RPC="${ARC_MAINNET_RPC_URL:-https://rpc.mainnet.arc.io}"
    EXPLORER="${ARC_MAINNET_EXPLORER_URL:-https://explorer.arc.io}"
    CHAIN=5042
    ;;
  *)
    echo "Unknown NETWORK=$NETWORK. Use testnet or mainnet." >&2
    exit 1
    ;;
esac

command -v "$FORGE_BIN" >/dev/null
command -v "$CAST_BIN" >/dev/null
mkdir -p "$OUTPUT_DIR"

actual_chain="$($CAST_BIN chain-id --rpc-url "$RPC")"
[[ "$actual_chain" == "$CHAIN" ]] || {
  echo "RPC chain mismatch: expected $CHAIN, received $actual_chain." >&2
  exit 1
}

account_address="$($CAST_BIN wallet address --account "$DEPLOYER_ACCOUNT")"
if [[ -n "${EXPECTED_DEPLOYER_ADDRESS:-}" ]]; then
  normalized_account="$(printf '%s' "$account_address" | tr '[:upper:]' '[:lower:]')"
  normalized_expected="$(printf '%s' "$EXPECTED_DEPLOYER_ADDRESS" | tr '[:upper:]' '[:lower:]')"
  [[ "$normalized_account" == "$normalized_expected" ]] || {
    echo "Encrypted keystore alias resolved to $account_address, not EXPECTED_DEPLOYER_ADDRESS." >&2
    exit 1
  }
fi

balance="$($CAST_BIN balance "$account_address" --rpc-url "$RPC")"
echo "Network: $NETWORK"
echo "Chain ID: $CHAIN"
echo "RPC: $RPC"
echo "Explorer: $EXPLORER"
echo "Deployer: $account_address"
echo "Native USDC balance: $balance wei"

npm test
"$FORGE_BIN" test -vvv
FOUNDRY_PROFILE=arc "$FORGE_BIN" test -vvv
FOUNDRY_PROFILE=arc "$FORGE_BIN" build
FORGE_BIN="$FORGE_BIN" node scripts/check-abi.mjs

output="$OUTPUT_DIR/deployment-${NETWORK}.json"
FOUNDRY_PROFILE=arc "$FORGE_BIN" create contracts/SettleRef.sol:SettleRef \
  --rpc-url "$RPC" \
  --chain "$CHAIN" \
  --account "$DEPLOYER_ACCOUNT" \
  --broadcast \
  --json | tee "$output"

echo "Deployment command completed. Record the transaction hash, then run:"
echo "DEPLOYMENT_CONFIG_PATH=public/deployment.json node scripts/pin-deployment.mjs <CONTRACT_ADDRESS> $CHAIN"
echo "Runtime pinning always leaves writes disabled until a separate owner review."
