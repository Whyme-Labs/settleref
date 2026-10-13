# Architecture and decisions

## The narrow experiment

One network, native USDC, one payer, one beneficiary, one instruction and one contract call. The product tests whether a payment can retain a reliable reference through execution and recipient-side reconciliation. Cross-border is the business use case, not a claim of fiat payout or bridging.

## Data and trust

An instruction contains schema, chainId, endToEndId, payer, beneficiary, asset, exact decimal amount, invoice reference, expiry and a 32-byte random salt. Unknown fields are rejected. Payer and beneficiary cannot be equal or zero.

The instruction ID is SHA-256 of the canonical JSON array `["settleref.identity.v1", endToEndId]`. It does not depend on amount, beneficiary, reference or salt. The contract scopes the ID under the actual `msg.sender`. Payload changes cannot evade duplicate protection while retaining the payer and ID.

The content commitment is SHA-256 of the canonical ordered field array shown in `src/domain.ts`. SHA-256 is used through browser WebCrypto, not a custom cryptography implementation. The contract records this commitment but cannot validate unseen invoice details. The wallet's transaction authorizes the public call data. The verifier reconstructs and matches the commitment from the original instruction.

Changing the ID intentionally defines a different payment. End-to-end IDs should be generated once by the originating system and retained through retries, imports and exports. UUIDs are used in examples. Do not use a fresh ID to retry an uncertain payment.

## Native USDC and scope reduction

Arc's native balance has 18 decimals. Business amounts are accepted with at most 6 decimals and converted using integer arithmetic: native units = micro-USDC x 10^12. Never use floating-point arithmetic, token `parseUnits(...,6)` for native value, or silent rounding.

Sources:
- https://docs.arc.io/arc/references/connect-to-arc
- https://docs.arc.io/arc/concepts/stablecoin-native-model
- https://docs.arc.io/arc/references/gas-and-fees

Some retrieved documentation pages were older than the live mainnet connection page. In particular, the contract-address page still described testnet-only addresses and the gas page contained a conflicting example using 6 decimals for native value. This implementation follows the explicit native-18-decimal definition and tests it. Network integration still requires live verification.

We do not depend on Arc's predeployed Memo wrapper in v0. The custom settlement event carries the commitments. Memo adds an EOA-only dependency and does not itself provide idempotency. This avoids copying unverified mainnet addresses or pretending an ERC-20 amount is a native amount.

Memo source: https://docs.arc.io/arc/concepts/transaction-memos

## Contract semantics

`settle(instructionId, beneficiary, amount, contentHash, expiresAt)` is payable. It checks nonzero IDs, valid beneficiary, exact value, 6-decimal precision, a 1-USDC cap and expiry. It sets the consumed flag before forwarding value. The whole transaction reverts on transfer failure, including the consumed flag. Reentrancy is blocked. There is no admin, fee collector, upgrade path, token allowance or deliberate retained balance.

The cap limits one transaction, not aggregate deposits or losses across repeated calls. A recipient can be a contract; its code and receipt handling still carry risks. Unexpected or forced funds are outside the supported payment interface and there is no rescue owner.

## Receipt verification

A receipt bundle provides only the original instruction and transaction hash as inputs. The importer does not trust its claimed verification status, RPC URL or contract address. The deployed app chooses its trusted configuration.

The verifier checks RPC chain ID, exact deployed runtime hash, successful receipt, sender, target, amount, exact calldata, unique settlement event from the pinned contract, event parties and commitments, matching transaction/receipt block and canonical block hash. It rejects a payment timestamp at or after expiry.

This is RPC-backed verification, not a trustless light client. A malicious RPC and compromised application distribution remain trust risks. Independent RPC comparison is a future option, not implemented. The recorded event proves the contract's forward-call success, not beneficial ownership, legal settlement, fiat receipt or business fulfillment.

## Privacy and pending payments

No telemetry or external scripts. Invoice data lives in browser memory, the current tab's session storage after review, and intentional downloads. Session storage is not encrypted against malware, XSS or anyone with access to the device. A real transaction hash is retained after submission. Pending is not success and missing receipts do not justify automatic resend. Read checks may repeat; transaction broadcasts are never automatically retried.

Wallet addresses, amounts, timestamps and contract events are public. The random salt is necessary to resist guessing private invoice references from the content hash. A disclosed receipt bundle discloses its invoice reference and salt.

## Deferred deliberately

ISO 20022 XML, FX, bank accounts, fiat ramps, sanctions determinations, beneficiary KYC, bridges, batch payments, AI, relayers, gas sponsorship, payment routing, pricing tiers and financial dashboards.
