# Remaining work

These are issue-ready records, not issues already created on GitHub.

## SR-01: Run and repair actual contract tests

Priority P0. Observe the checksum-pinned Arc Foundry workflow on GitHub. It must run all 18 Solidity tests, including fuzzing, under both the standard EVM and Arc profiles, then validate browser selectors against compiler output. Fix any failures without widening the product scope. Add live testnet coverage for Arc-specific restricted-transfer behavior. Acceptance: both CI profiles are actually green and the run URL is recorded; no fabricated pass flags.

## SR-02: Browser end-to-end validation

Priority P0. Run scripts/browser-test.py in an environment that permits a local application browser. The current environment blocked navigation with ERR_BLOCKED_BY_ADMINISTRATOR. Fix observed bugs, confirm mobile behavior, JSON round-trip, CSV, XSS rendering, explicit confirmation and disabled live mode. Inspect all pages. Acceptance: screenshots and real pass report. Test a real EIP-1193 wallet on Arc testnet separately.

## SR-03: Deploy the capped Arc experiment

Depends on SR-01 and SR-02. Owner-operated testnet deployment and small self-funded test, then mainnet with explicit owner approval. Pin runtime, compare to source artifact, collect success and duplicate-rejection evidence. Test pending recovery with original identity. Acceptance: chain 5042 transaction receipt and independent recipient-browser reconciliation.

## SR-04: Publish and submit

Depends on SR-03. Change the existing repository from private to public, host the static app, inspect the actual DoraHacks form, fill its fields, and verify requirements against the organizer page again. Complete ownership/prior-funding attestations truthfully. Deadline: 2026-10-15 11:59 Asia/Kuala_Lumpur. Acceptance: working public app, source repository, genuine Arc deployment and successful submission confirmation.

## Product stopping rule

No XML adapter, fiat, FX, bridge, AI, subscription or extra dashboard before the above is working. The grant reward is 500 USDC per selected project, not justification for a full banking platform.
