# Implementation review

October 13, 2026. Manual review plus automated verification. No independent security audit or separate reviewer is claimed.

## Standards

Amounts use exact bigint conversion. Boundaries validate JSON, addresses, hashes, chain IDs, data words and RPC results. The verifier pins the contract and does not accept receipt-provided endpoints. User-controlled invoice text uses `textContent`, not `innerHTML`. CSV cells escape quotes and neutralize formula prefixes. Broadcasts have no automatic retry loop. Live configuration defaults to disabled and source includes no secret material.

One browser-state defect found during review was fixed: switching execution modes must not clear a saved transaction hash needed for pending-payment recovery. Browser behavior still requires SR-02 because the initial execution environment blocked Chromium navigation.

## SR-01 verification

SR-01 passed on source commit `6fd75f5c78a83c8d69cfe62e3dd8be3b33888799` in GitHub Actions run `38345384941`.

The run used checksum-pinned Arc Foundry `v0.8.0-2`, resolved the `arc` profile to network `arc` and hardfork `Zero8`, and produced these results:

- Application tests: 53 passed, 0 failed.
- TypeScript typecheck and production build: passed.
- Standard EVM contract tests: 18 passed, 0 failed, including 256 fuzz runs.
- Arc execution contract tests: 18 passed, 0 failed, including 256 fuzz runs.
- Browser ABI selector check against compiler output: passed.
- Clean working-tree check after verification: passed.

The contract suite initially revealed one test-harness compatibility defect. Current Foundry reserves function names beginning with `testFail`, so `testFailedTransferRollsBackAndAllowsRetry` was renamed to `testTransferFailureRollsBackAndAllowsRetry`. The assertions and contract behavior did not change.

No separate live Arc testnet case is required inside SR-01. The contract calls no Arc system contract or ERC-20 predeploy. It transfers native value through `msg.value` and a beneficiary call. Network policy affecting a particular recipient address can only be tested with an actual deployment and is explicitly part of the owner-controlled SR-03 smoke test.

The full command output is retained in the immutable workflow job log. GitHub Actions artifact upload is disabled because the organization artifact-storage quota is exhausted.

## Scope and acceptance

The implementation covers the approved narrow payment-instruction, duplicate-protection and reconciliation flow. A local walkthrough is clearly distinguished from chain evidence. ISO 20022 XML and the predeployed Memo wrapper remain deferred. The app uses versioned JSON and the settlement contract event instead. It makes no fiat, FX, bank-network or certification claims.

The organizer's live-mainnet requirement is not met yet. The repository remains private. No public host deployment, funded-wallet payment, mainnet transaction or grant submission is claimed. SR-02 through SR-04 remain explicit release gates in `docs/next-tasks.md` and `submission.json`.
