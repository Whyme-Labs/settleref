# Initial implementation review

October 13, 2026. Manual review; no independent security audit or separate reviewer is claimed.

## Standards

Amounts use exact bigint conversion. Boundaries validate JSON, addresses, hashes, chain IDs, data words and RPC results. The verifier pins the contract and does not accept receipt-provided endpoints. User-controlled invoice text uses textContent, not innerHTML. CSV cells escape quotes and neutralize formula prefixes. Broadcasts have no automatic retry loop. Live config defaults to disabled and source includes no secret material.

One browser-state defect found during review was fixed: switching execution modes must not clear a saved transaction hash needed for pending-payment recovery. Remaining browser behavior is not verified because Chromium navigation is blocked in this environment.

The most important outstanding risk is live-network behavior. CI is configured to run the Solidity suite under both standard EVM and Arc Foundry profiles, but mocked RPC tests and local EVM execution do not establish deployed correctness. Mainnet remains disabled.

## Scope and acceptance

The implementation covers the approved narrow payment-instruction, duplicate-protection and reconciliation flow at scaffold level. A local walkthrough is clearly distinguished from chain evidence. ISO 20022 XML and the predeployed Memo wrapper are deliberately deferred; the app uses versioned JSON and the settlement contract's event instead. It makes no fiat, FX, bank-network or certification claims.

The organizer's live-mainnet requirement is not met. The repository has been created and is being populated, but it is private. No public host deployment, funded wallet, mainnet payment or submission is claimed. These are explicit remaining release gates in docs/next-tasks.md and submission.json.
