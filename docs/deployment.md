# Deployment runbook

## Current release gate

SR-01 and SR-02 are complete. SR-03 is not complete until genuine Arc testnet and mainnet evidence exists. The tracked `public/deployment.json` remains disabled and does not claim a live contract.

Repository automation proved Arc testnet and mainnet RPC connectivity without signing. A separate attempt to fund a fresh CI wallet through Circle's public faucet reached the faucet page but received no funds because the human verification boundary was not completed. That bounded result is retained under `evidence/sr03/testnet/`. Do not automate around the faucet's human-verification control.

Live deployment uses either an owner-controlled browser wallet or a locally encrypted Arc Foundry keystore. No private key belongs in chat, GitHub, shell history, `.env`, CI variables, screenshots, or evidence files.

## Network endpoints

The repository preflight currently uses:

| Network | Chain ID | RPC | Explorer |
|---|---:|---|---|
| Arc testnet | `5042002` | `https://rpc.testnet.arc.network` | `https://explorer.testnet.arc.io` |
| Arc mainnet | `5042` | `https://rpc.mainnet.arc.io` | `https://explorer.arc.io` |

Both legacy and current testnet RPC hostnames answered the expected chain during the recorded preflight. The deployment scripts still verify the chain ID before any broadcast. Override an endpoint only through the documented environment variables, then rerun the network and runtime checks.

## Install and verify the reviewed source

```sh
npm ci
npm test
npm run typecheck

mkdir -p .tools/arc-foundry
bash scripts/install-arc-foundry.sh "$PWD/.tools/arc-foundry"
export PATH="$PWD/.tools/arc-foundry:$PATH"

arc-forge test -vvv
FOUNDRY_PROFILE=arc arc-forge test -vvv
FOUNDRY_PROFILE=arc arc-forge build
FORGE_BIN=arc-forge node scripts/check-abi.mjs
```

The standard and Arc profiles must both pass. The Arc profile selects the `arc` network and `Zero8` hardfork. Do not proceed from a dirty source tree or a different artifact.

## Prepare the owner wallet

If your wallet is a browser extension, use the browser deployment path below. You do not need to export or import its key into Foundry. Keep the encrypted-keystore commands for owners who already use a Foundry account.

Create or import a keystore locally using Arc Foundry's encrypted keystore support. The remaining examples assume the alias is `settleref-owner` and that the expected public address is known independently.

For testnet, visit Circle's faucet in a normal interactive browser and fund that owner address with Arc testnet USDC. USDC is Arc's native gas token, so the same test balance funds deployment, gas and the tiny smoke payment. Confirm the balance before deployment:

```sh
arc-cast balance 0xYOUR_OWNER_ADDRESS \
  --rpc-url https://rpc.testnet.arc.network
```

Use only owner-controlled test funds. Never use customer funds or a publicly known development key.

## Deploy with a browser wallet

On Apple Silicon, the checksum-pinned installer supports macOS. Keep its tools local to the checkout:

```sh
npm ci
bash scripts/install-arc-foundry.sh "$PWD/.tools/arc-foundry"
export PATH="$PWD/.tools/arc-foundry:$PATH"
npm run sr03:deploy:browser -- testnet
node scripts/serve.mjs
```

The preparation command reruns application, type, standard EVM, Arc execution and ABI checks. It refuses a dirty source tree and requires the Arc Zero8 profile. Open `http://127.0.0.1:4173/deploy/index.html` in the browser where your wallet is installed. Enter the expected owner public address and switch the wallet to Arc testnet, chain `5042002`.

Connect and review the displayed owner, network, source commit and gas ceiling. The deployment sends zero native value and pays only gas. Choose the deployment button and approve the transaction in your wallet. The page makes one signing request, retains its pending state before signing, and never retries a broadcast automatically. After reload, check the original transaction hash. If the wallet disconnected before returning a hash, inspect the wallet's activity and paste the original hash rather than redeploying.

Check the receipt and export `deployment-testnet.json`. The verifier checks the actual creation input, owner, zero value, successful receipt, exact runtime and canonical block. Save the export under `evidence/sr03/owner/`, then use the runtime-pinning and write-enable commands below. Deployment alone does not enable payments or complete SR-03.

After the independent testnet payment verifier produces `evidence/sr03/owner/testnet-verified.json`, the same browser path supports mainnet with the explicit gate:

```sh
CONFIRM_MAINNET=DEPLOY_CAPPED_EXPERIMENT npm run sr03:deploy:browser -- mainnet
```

It refuses mainnet without a passing testnet report matching the current runtime. Complete mainnet pinning, write enabling, a tiny payment and independent verification as described below. Mainnet approval remains in the owner wallet.

The generated operator files exist only in ignored `dist/deploy/`. Run `npm run build` before publishing `dist/` to remove the local operator page. The tracked deployment configuration stays disabled.

## Arc testnet deployment

The deployment script performs these checks before broadcasting:

- the RPC reports chain `5042002`;
- the encrypted alias resolves to the expected owner address;
- application, standard EVM and Arc execution tests pass;
- browser ABI selectors match the compiled contract;
- no raw private-key argument is accepted by the script.

Run:

```sh
DEPLOYER_ACCOUNT=settleref-owner \
EXPECTED_DEPLOYER_ADDRESS=0xYOUR_OWNER_ADDRESS \
NETWORK=testnet \
FORGE_BIN=arc-forge \
CAST_BIN=arc-cast \
bash scripts/deploy.sh
```

The deployment command writes its public output to `evidence/sr03/owner/deployment-testnet.json`. Record the actual contract address and deployment transaction hash. Check both in the explorer.

## Pin the exact runtime

Compile first, then compare the remote runtime byte-for-byte with the reviewed artifact:

```sh
npm run build
DEPLOYMENT_CONFIG_PATH=public/deployment.json \
node scripts/pin-deployment.mjs 0xTESTNET_CONTRACT_ADDRESS 5042002
```

The pinning command refuses a chain mismatch, empty runtime or bytecode mismatch. Its output includes the runtime size and SHA-256 hash. It deliberately leaves `writesEnabled` set to `false`.

## Enable the reviewed testnet deployment

A separate command rechecks the pinned runtime and reads `MAX_NATIVE` from the deployed contract. It enables writes only when the contract still matches and the cap is exactly one native USDC:

```sh
npm run build
CONFIRM_ENABLE_WRITES=ENABLE_OWNER_TESTNET_WRITES \
node scripts/enable-reviewed-deployment.mjs testnet
```

Review the resulting `public/deployment.json`, rebuild, and serve the static application:

```sh
npm run build
node scripts/serve.mjs
```

Use the owner wallet in a normal browser. Create a fresh instruction for no more than `0.10 USDC`, export the instruction before paying, check the beneficiary and amount, sign once, wait for the receipt, verify it in the app, test duplicate protection, and export the real receipt bundle plus reconciliation CSV.

Do not retry with a new instruction ID while a transaction is pending. Preserve the original instruction and transaction hash.

## Independent testnet verification

Place the exported real receipt bundle under `evidence/sr03/owner/`. Then run the read-only verifier:

```sh
npm run build
FOUNDRY_PROFILE=arc arc-forge build
node scripts/sr03-verify-live.mjs \
  testnet \
  0xTESTNET_CONTRACT_ADDRESS \
  0xTESTNET_DEPLOYMENT_TRANSACTION \
  evidence/sr03/owner/testnet-receipt.json
```

The verifier never invokes a signer. It independently checks:

- Arc chain ID;
- successful contract-creation receipt;
- exact creation bytecode in the deployment transaction;
- exact deployed runtime bytecode and pinned hash;
- payment sender, target, value and calldata;
- the settlement event and canonical block;
- the instruction commitment and receipt bundle;
- the onchain duplicate flag;
- a smoke amount no greater than `0.10 USDC`.

Commit the generated `evidence/sr03/owner/testnet-verified.json` only after it reports `PASS`.

## Arc mainnet deployment

Mainnet moves real USDC and is irreversible. Start only after testnet has passed, the exact source commit is frozen, the owner has reviewed the wallet and beneficiary, and the amount is intentionally tiny.

Deploy with the explicit mainnet gate:

```sh
DEPLOYER_ACCOUNT=settleref-owner \
EXPECTED_DEPLOYER_ADDRESS=0xYOUR_MAINNET_OWNER_ADDRESS \
NETWORK=mainnet \
CONFIRM_MAINNET=DEPLOY_CAPPED_EXPERIMENT \
FORGE_BIN=arc-forge \
CAST_BIN=arc-cast \
bash scripts/deploy.sh
```

Pin the runtime, then enable the reviewed configuration through a separate confirmation:

```sh
npm run build
node scripts/pin-deployment.mjs 0xMAINNET_CONTRACT_ADDRESS 5042

CONFIRM_ENABLE_WRITES=ENABLE_CAPPED_MAINNET_WRITES \
node scripts/enable-reviewed-deployment.mjs mainnet
```

Execute one owner-funded payment of at most `0.10 USDC` to a second owner-controlled wallet. Export the real receipt bundle and independently verify it:

```sh
npm run build
FOUNDRY_PROFILE=arc arc-forge build
node scripts/sr03-verify-live.mjs \
  mainnet \
  0xMAINNET_CONTRACT_ADDRESS \
  0xMAINNET_DEPLOYMENT_TRANSACTION \
  evidence/sr03/owner/mainnet-receipt.json
```

The one-USDC contract cap is not a security audit or a total-loss guarantee. Never claim mainnet completion without public transaction hashes and the generated verifier report.

## Public app and submission

SR-04 starts only after SR-03 passes. Make the repository public, deploy the static `dist/` output to HTTPS hosting, verify the security headers, inspect every link while signed out, complete the DoraHacks form truthfully, and retain submission confirmation.
