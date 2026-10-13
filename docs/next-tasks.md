# Milestones

The repository issues are the execution tracker. This file records the current milestone order and verified state.

## SR-01: Arc Foundry contract validation

Status: completed on October 13, 2026.

GitHub Actions run `38345384941` validated source commit `6fd75f5c78a83c8d69cfe62e3dd8be3b33888799` with checksum-pinned Arc Foundry `v0.8.0-2`.

Acceptance evidence:

- Standard EVM profile: 18 passed, 0 failed.
- Arc profile with network `arc` and hardfork `Zero8`: 18 passed, 0 failed.
- Fuzzing: 256 runs in each profile.
- Browser ABI constants match compiler method identifiers.
- Application tests: 53 passed, 0 failed.
- Typecheck, production build and clean-tree gate passed.
- No deployment, testnet transaction or mainnet success is claimed.

## SR-02: Browser end-to-end validation

Status: completed on October 13, 2026.

GitHub Actions run `38359156807` validated source commit `39a2fb59a999dd882141d02c55ff4b41136c362e` and committed browser evidence as `478d17bbe6a8328188a9afd52fe48d714fa3afa4`.

Acceptance evidence:

- Real Chromium automation: 17 checks passed, 0 failed.
- Eight desktop, mobile, wallet and receipt-verification screenshots were captured.
- No browser page errors or console errors occurred.
- The 390 x 844 layout had no horizontal overflow.
- Instruction and receipt JSON round trips preserved payment identity.
- CSV formula injection was neutralized.
- Untrusted deployment configuration failed closed.
- A private-key-backed EIP-1193 provider connected to the live Arc testnet RPC and reported chain `5042002`; writes stayed disabled and no testnet transaction was submitted.
- Wrong account and wrong network states were rejected before transaction signing.
- One ephemeral signed transaction completed on Arc Anvil using Arc execution semantics, survived reload, reconciled against RPC and exposed the onchain duplicate flag.
- A second browser independently verified the exported receipt bundle.
- No mainnet connection or transaction occurred.

Machine-readable evidence is in `evidence/browser/browser-tests.json`.

## SR-03: Deploy the capped Arc experiment

Status: in progress. The genuine Arc testnet deployment and 0.10-USDC payment passed independent verification. Mainnet deployment and payment remain.

Completed preparation:

- Probed current and legacy Arc RPC candidates without loading a key or submitting a transaction.
- Confirmed reachable Arc testnet chain `5042002` and Arc mainnet chain `5042` endpoints.
- Recorded the probe in `evidence/sr03/network-probe.json`.
- Attempted a fresh CI-wallet testnet funding flow through Circle's public faucet in real Chromium.
- Preserved screenshots and a machine report under `evidence/sr03/testnet/` when the wallet remained unfunded at the human-verification boundary.
- Retired the one-off faucet and transient-key automation after the bounded experiment.
- Hardened `scripts/deploy.sh` around a locally encrypted owner keystore alias, chain-ID checks, expected-address checks and explicit mainnet confirmation.
- Added a localhost browser-wallet deployment path for owners using wallet extensions, with exact owner and chain checks, a gas ceiling, pending recovery, no automatic retries and independent deployment verification.
- Replaced Bash 4-only address normalization so the keystore script runs with macOS Bash 3.2.
- Hardened `scripts/pin-deployment.mjs` to require an exact remote-runtime match while leaving writes disabled.
- Added `scripts/enable-reviewed-deployment.mjs`, which rechecks runtime and the exact one-USDC cap before enabling writes.
- Added `scripts/sr03-verify-live.mjs`, a read-only verifier for deployment creation bytecode, runtime, payment receipt, canonical block and duplicate state.
- Added CI gates that reject raw `--private-key` command flags in tracked operator tooling and require the tracked deployment configuration to fail closed.
- Updated the CSP to permit the current Arc testnet RPC hostname.

Completed testnet gate on October 13, 2026:

- Owner-funded wallet: `0x40e4ccd3db59580b23f5db16e1f9e1bcf6d2bf8e`, funded with 20 testnet USDC through Circle's faucet.
- Contract: `0xef9cb6e223d4fc63e82e95b1a6cbfe0b31ef3dc4`.
- Deployment: `0x6bdfc211f18d148cdfc948ac5cd11b7e2277230a98aeaaee05c98f369522ae85`.
- Payment: `0x8c62d3c3cb589d524127413946f8a47e992619c105403be11e6ce91a03ff1a4f`, exactly 0.10 USDC to the second owner-controlled wallet.
- Exact creation/runtime bytecode, receipt, calldata, event, canonical block and consumed state independently verified in `evidence/sr03/owner/testnet-verified.json`.
- Original instruction identity and submitted hash survived reload before receipt verification.
- Actual JSON and CSV exports were captured; a separate Chromium browser without a wallet imported and verified the receipt.
- An `eth_call` replay produced the exact `DuplicateInstruction()` revert, without another transaction.
- Independent Standards and Spec reviews found and resolved operator-page concurrency/recovery issues. Four permanent page regressions pass. No contract source changed.

Testnet reproduction:

1. Fund an owner-controlled Arc testnet wallet through Circle's interactive faucet.
2. Deploy with the browser wallet using `npm run sr03:deploy:browser -- testnet`, or with a locally encrypted keystore using `scripts/deploy.sh`.
3. Pin the exact runtime and enable the reviewed testnet configuration through the separate confirmation gate.
4. Execute one owner-funded payment of at most `0.10 USDC` in the real browser UI.
5. Export the receipt bundle and reconciliation CSV.
6. Run `scripts/sr03-verify-live.mjs` and commit a `PASS` report.

Remaining mainnet gate:

1. Freeze and review the exact source commit that passed testnet.
2. Use a funded owner-controlled mainnet wallet and a second owner-controlled beneficiary.
3. Deploy only with `CONFIRM_MAINNET=DEPLOY_CAPPED_EXPERIMENT`.
4. Pin runtime, enable writes only with `CONFIRM_ENABLE_WRITES=ENABLE_CAPPED_MAINNET_WRITES`, and execute one payment of at most `0.10 USDC`.
5. Independently verify and commit the public deployment and payment evidence.

Acceptance remains unchanged:

- Arc testnet contract runtime exactly matches the reviewed artifact.
- One small owner-controlled testnet payment succeeds and reconciles independently.
- The same payer and instruction ID cannot execute twice.
- Pending recovery retains the original identity and transaction hash.
- Arc mainnet has genuine deployment and tiny owner-funded payment evidence.
- No customer funds or credentials enter the repository.

Do not close SR-03 or claim a public-network deployment until these owner actions produce genuine transaction hashes and verifier reports.

## SR-04: Publish and submit

Status: submission preparation in progress; final eligibility remains gated by SR-03 mainnet evidence.

Change the repository from private to public, host the static app, inspect the actual DoraHacks form, complete ownership and prior-funding attestations truthfully, and validate every public link while signed out.

Deadline: October 15, 2026 at 11:59 Asia/Kuala_Lumpur.

Acceptance: public source, public HTTPS app, genuine Arc deployment evidence and successful submission confirmation.

## Product stopping rule

Do not add XML adapters, fiat, FX, bridges, AI, subscriptions or extra dashboards before the verified payment and reconciliation path is complete. The grant is an experiment budget, not justification for a full banking platform.
