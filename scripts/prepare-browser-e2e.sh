#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-/tmp/settleref-browser-e2e}"
RPC_URL="${SETTLEREF_LOCAL_RPC:-http://127.0.0.1:8545}"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

python3 - <<'PY' >"$OUTPUT_DIR/keys.env"
from eth_account import Account
payer = Account.create()
beneficiary = Account.create()
print(f"PAYER_PRIVATE_KEY=0x{payer.key.hex().removeprefix('0x')}")
print(f"PAYER={payer.address.lower()}")
print(f"BENEFICIARY={beneficiary.address.lower()}")
PY
# Ephemeral keys are generated for this local CI run only and never committed.
source "$OUTPUT_DIR/keys.env"

arc-anvil --network arc --host 127.0.0.1 --port 8545 >"$OUTPUT_DIR/anvil.log" 2>&1 &
ANVIL_PID=$!
printf '%s\n' "$ANVIL_PID" >"$OUTPUT_DIR/anvil.pid"

ready=false
for _ in $(seq 1 60); do
  if curl --silent --fail --show-error \
    --header 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    "$RPC_URL" >"$OUTPUT_DIR/chain-id.json"; then
    ready=true
    break
  fi
  sleep 0.25
done
if [[ "$ready" != true ]]; then
  cat "$OUTPUT_DIR/anvil.log" >&2
  echo "Arc Anvil did not become ready." >&2
  exit 1
fi

# Fund the ephemeral payer with 1000 native USDC units on the local development chain.
curl --silent --fail --show-error \
  --header 'Content-Type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_setBalance\",\"params\":[\"$PAYER\",\"0x3635c9adc5dea00000\"]}" \
  "$RPC_URL" >"$OUTPUT_DIR/fund-payer.json"

FOUNDRY_PROFILE=arc arc-forge create contracts/SettleRef.sol:SettleRef \
  --rpc-url "$RPC_URL" \
  --private-key "$PAYER_PRIVATE_KEY" \
  --broadcast \
  --json >"$OUTPUT_DIR/deployment-command.json"

export OUTPUT_DIR RPC_URL PAYER BENEFICIARY
python3 - <<'PY'
import hashlib
import json
import os
import re
import urllib.request
from pathlib import Path

out = Path(os.environ["OUTPUT_DIR"])
rpc_url = os.environ["RPC_URL"]
raw = (out / "deployment-command.json").read_text()
try:
    deployment = json.loads(raw)
except json.JSONDecodeError:
    match = re.search(r"\{.*\}\s*$", raw, re.S)
    if not match:
        raise RuntimeError(f"Could not parse forge deployment output:\n{raw}")
    deployment = json.loads(match.group(0))

contract = None
for key in ("deployedTo", "deployed_to", "contractAddress", "contract_address"):
    value = deployment.get(key)
    if isinstance(value, str) and re.fullmatch(r"0x[0-9a-fA-F]{40}", value):
        contract = value.lower()
        break
if contract is None:
    match = re.search(r"0x[0-9a-fA-F]{40}", raw)
    if not match:
        raise RuntimeError(f"Deployment output contained no contract address:\n{raw}")
    contract = match.group(0).lower()


def rpc(method, params):
    request = urllib.request.Request(
        rpc_url,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = json.loads(response.read())
    if "error" in body:
        raise RuntimeError(f"RPC {method} failed: {body['error']}")
    return body["result"]

chain_id = int(rpc("eth_chainId", []), 16)
if chain_id != 31337:
    raise RuntimeError(f"Expected local chain 31337, got {chain_id}")
code = rpc("eth_getCode", [contract, "latest"])
if not isinstance(code, str) or code == "0x":
    raise RuntimeError("Deployed contract has no runtime bytecode")
code = code.lower()
runtime_hash = "0x" + hashlib.sha256(code.encode()).hexdigest()

local = {
    "chainId": chain_id,
    "rpcUrl": rpc_url,
    "explorerUrl": "https://example.invalid",
    "contractAddress": contract,
    "runtimeCodeSha256": runtime_hash,
    "writesEnabled": True,
}
testnet = {
    "chainId": 5042002,
    "rpcUrl": "https://rpc.testnet.arc.io",
    "explorerUrl": "https://explorer.testnet.arc.io",
    "contractAddress": None,
    "runtimeCodeSha256": None,
    "writesEnabled": False,
}
untrusted = {
    "chainId": chain_id,
    "rpcUrl": rpc_url,
    "explorerUrl": "https://example.invalid",
    "contractAddress": contract,
    "runtimeCodeSha256": None,
    "writesEnabled": True,
}
for name, value in (("local", local), ("testnet", testnet), ("untrusted", untrusted)):
    (out / f"deployment-{name}.json").write_text(json.dumps(value, indent=2) + "\n")

summary = {
    "chainId": chain_id,
    "contractAddress": contract,
    "runtimeCodeSha256": runtime_hash,
    "payer": os.environ["PAYER"].lower(),
    "beneficiary": os.environ["BENEFICIARY"].lower(),
    "anvilPid": int((out / "anvil.pid").read_text()),
}
(out / "local-chain.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary))
PY

cat >"$OUTPUT_DIR/browser.env" <<EOF
export SETTLEREF_LOCAL_RPC='$RPC_URL'
export SETTLEREF_TESTNET_RPC='https://rpc.testnet.arc.io'
export SETTLEREF_LOCAL_CONFIG='$OUTPUT_DIR/deployment-local.json'
export SETTLEREF_TESTNET_CONFIG='$OUTPUT_DIR/deployment-testnet.json'
export SETTLEREF_UNTRUSTED_CONFIG='$OUTPUT_DIR/deployment-untrusted.json'
export SETTLEREF_PAYER_PRIVATE_KEY='$PAYER_PRIVATE_KEY'
export SETTLEREF_BENEFICIARY='$BENEFICIARY'
export SETTLEREF_ANVIL_PID='$ANVIL_PID'
EOF

rm -f "$OUTPUT_DIR/keys.env"
echo "Prepared Arc-local browser environment in $OUTPUT_DIR."
