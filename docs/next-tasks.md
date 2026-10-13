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

Status: next.

Use an owner-controlled wallet for Arc testnet deployment and a small self-funded test. Pin runtime bytecode, compare it with the reviewed artifact, collect settlement and duplicate-rejection evidence, and test pending recovery with the original instruction identity. Only after those gates pass should the same capped contract be considered for Arc mainnet, with explicit owner review of the deployment and payment transactions.

Acceptance:

- Arc testnet contract runtime exactly matches the reviewed artifact.
- One small owner-controlled testnet payment succeeds and reconciles in a second browser.
- The same payer and instruction ID cannot execute twice.
- Pending recovery retains the original identity and transaction hash.
- Mainnet, if performed, uses two owner-controlled wallets and a tiny amount such as 0.10 USDC.
- No customer funds or credentials enter the repository.

## SR-04: Publish and submit

Status: blocked by SR-03.

Change the repository from private to public, host the static app, inspect the actual DoraHacks form, complete ownership and prior-funding attestations truthfully, and validate every public link while signed out.

Deadline: October 15, 2026 at 11:59 Asia/Kuala_Lumpur.

Acceptance: public source, public HTTPS app, genuine Arc deployment evidence and successful submission confirmation.

## Product stopping rule

Do not add XML adapters, fiat, FX, bridges, AI, subscriptions or extra dashboards before the verified payment and reconciliation path is complete. The grant is an experiment budget, not justification for a full banking platform.
