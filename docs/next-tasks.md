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

The contract has no Arc system-contract or ERC-20 predeploy dependency, so a separate live-network test is not applicable inside SR-01. Recipient-specific network policy is tested during the SR-03 owner-controlled deployment smoke.

## SR-02: Browser end-to-end validation

Status: next.

Priority P0. Run `scripts/browser-test.py` in an environment that permits local application navigation. Fix observed bugs and verify desktop plus 390 px mobile behavior, JSON round-trip, CSV safety, XSS-safe rendering, explicit confirmation and disabled live mode. Then exercise the live flow with a real EIP-1193 wallet on Arc testnet without making a mainnet payment.

Acceptance: browser automation has no JavaScript errors, screenshots and a machine-readable report exist, wrong account and wrong network states are rejected, and a real wallet completes the reviewed testnet flow.

## SR-03: Deploy the capped Arc experiment

Status: blocked by SR-02.

Use an owner-controlled wallet for testnet deployment and a small self-funded test. Pin runtime bytecode, compare it with the reviewed artifact, collect settlement and duplicate-rejection evidence, and test pending recovery with the original instruction identity. Only after those gates pass, deploy the same capped contract to mainnet with explicit owner approval.

Acceptance: a genuine Arc mainnet transaction receipt, independent reconciliation and contract-level duplicate rejection. No third-party funds.

## SR-04: Publish and submit

Status: blocked by SR-03.

Change the repository from private to public, host the static app, inspect the actual DoraHacks form, complete ownership and prior-funding attestations truthfully, and validate every public link while signed out.

Deadline: October 15, 2026 at 11:59 Asia/Kuala_Lumpur.

Acceptance: public source, public HTTPS app, genuine Arc deployment evidence and successful submission confirmation.

## Product stopping rule

Do not add XML adapters, fiat, FX, bridges, AI, subscriptions or extra dashboards before the verified payment and reconciliation path is complete. The grant is an experiment budget, not justification for a full banking platform.
