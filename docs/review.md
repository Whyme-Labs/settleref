# Implementation review

October 13, 2026. Manual review plus automated verification. No independent security audit or separate reviewer is claimed.

## Standards

Amounts use exact bigint conversion. Boundaries validate JSON, addresses, hashes, chain IDs, data words and RPC results. The verifier pins the contract and does not accept receipt-provided endpoints. User-controlled invoice text uses `textContent`, not `innerHTML`. CSV cells escape quotes and neutralize spreadsheet-formula prefixes. Broadcasts have no automatic retry loop. Live configuration defaults to disabled and source includes no secret material.

A browser-state defect found during review was fixed before SR-02: switching execution modes must not clear a saved transaction hash needed for pending-payment recovery.

## SR-01 verification

SR-01 passed on source commit `6fd75f5c78a83c8d69cfe62e3dd8be3b33888799` in GitHub Actions run `38345384941`.

The run used checksum-pinned Arc Foundry `v0.8.0-2`, resolved the `arc` profile to network `arc` and hardfork `Zero8`, and produced these results:

- Application tests: 53 passed, 0 failed.
- TypeScript typecheck and production build: passed.
- Standard EVM contract tests: 18 passed, 0 failed, including 256 fuzz runs.
- Arc execution contract tests: 18 passed, 0 failed, including 256 fuzz runs.
- Browser ABI selector check against compiler output: passed.
- Clean working-tree check after verification: passed.

The contract suite revealed one test-harness compatibility defect. Current Foundry reserves function names beginning with `testFail`, so `testFailedTransferRollsBackAndAllowsRetry` became `testTransferFailureRollsBackAndAllowsRetry`. Assertions and contract behavior did not change.

## SR-02 browser and wallet verification

SR-02 passed on source commit `39a2fb59a999dd882141d02c55ff4b41136c362e` in GitHub Actions run `38359156807`. The workflow committed its bounded evidence as `478d17bbe6a8328188a9afd52fe48d714fa3afa4`.

The browser report records 17 passed checks, 0 failed checks and eight screenshots. It exercised the built HTTP application in headless Chromium rather than a DOM-only test.

Verified behavior:

- An untrusted deployment configuration kept live writes disabled.
- A private-key-backed EIP-1193 provider connected to the live Arc testnet RPC and reported chain `5042002`. Writes stayed disabled and no testnet transaction was submitted.
- The complete local walkthrough required explicit confirmation, settled once, blocked a duplicate and labelled simulations as non-onchain evidence.
- The live receipt importer rejected the simulation schema.
- Instruction export and import preserved payment identity.
- HTML-looking invoice text rendered as text and created no image or event-handler element.
- Seven-decimal USDC input was rejected instead of rounded.
- The 390 x 844 layout had no horizontal overflow.
- Wrong-account and wrong-network states were rejected before `eth_sendTransaction`.
- One transaction was signed by an ephemeral EIP-1193 wallet and settled against Arc Anvil using Arc execution semantics.
- The original instruction and transaction hash survived a browser reload and mode switch.
- The receipt reconciled against RPC, the onchain duplicate flag was true, and a second browser independently reverified the imported receipt bundle.
- JSON receipt identity and spreadsheet-safe CSV export passed.
- No page error or console error occurred.

The transaction target in the test wallet required checksum formatting for `eth-account`. This repair changed only the test adapter. Application transaction addresses remain validated and normalized by the product domain layer.

Evidence lives in `evidence/browser/browser-tests.json`, `evidence/browser/*.png` and the exported files under `evidence/browser/downloads/`.

## SR-03 network and deployment review

SR-03 remains open because no owner-controlled Arc deployment or public-network payment has been made.

Completed evidence and tooling:

- `evidence/sr03/network-probe.json` records no-key RPC preflight against candidate Arc endpoints. Reachable testnet and mainnet endpoints returned chain IDs `5042002` and `5042` respectively. The probe signed and submitted nothing.
- The same probe observed the expected native-USDC system runtime at `0x3600000000000000000000000000000000000000` on the reachable Arc networks.
- A real Chromium attempt reached Circle's public faucet and requested Arc testnet USDC for a fresh ephemeral address. The address remained at zero balance during the bounded wait, so the workflow stopped before deployment. Screenshots and the `BLOCKED_FAUCET` report remain under `evidence/sr03/testnet/`.
- No CAPTCHA bypass, alternate public key or customer funding was used.
- The one-off transient-key experiment code was removed after evidence capture. Tracked operator tooling now rejects raw `--private-key` command flags in CI.
- `scripts/deploy.sh` accepts only a locally encrypted Arc Foundry account alias, verifies the chain and expected public address, reruns all tests, and requires a separate exact confirmation for mainnet.
- `scripts/pin-deployment.mjs` checks exact deployed runtime bytecode and writes a configuration with `writesEnabled: false`.
- `scripts/enable-reviewed-deployment.mjs` rechecks the pinned runtime and reads the deployed `MAX_NATIVE` value. It enables writes only when the cap is exactly one native USDC and an explicit network-specific confirmation is present.
- `scripts/sr03-verify-live.mjs` is read-only. It validates the deployment receipt, exact creation bytecode, exact runtime bytecode, payment receipt, event, canonical block, instruction commitment, duplicate flag and the approved `0.10 USDC` smoke ceiling.
- The production CSP now permits the current Arc testnet RPC hostname as well as the legacy Arc endpoints.

The remaining SR-03 work is intentionally outside unattended automation. A human owner must fund and unlock the encrypted testnet wallet, approve the testnet deployment and payment, then review the evidence before any mainnet signing. Mainnet still requires both `CONFIRM_MAINNET=DEPLOY_CAPPED_EXPERIMENT` and the separate write-enable confirmation.

## Scope and remaining risk

The implementation covers the approved payment-instruction, duplicate-protection and reconciliation flow. ISO 20022 XML and the Arc Memo wrapper remain deferred. The app makes no fiat, FX, bank-network or certification claim.

SR-02 and the SR-03 preflight do not prove a public-network settlement. Only genuine owner-controlled deployment and payment transaction hashes, plus a passing independent verifier report, can close SR-03.

The organizer's live-mainnet and public-submission requirements are not met. The repository remains private. No testnet deployment, mainnet deployment, customer payment, public host or grant submission is claimed.
