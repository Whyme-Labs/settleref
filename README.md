# SettleRef

Payment to proof. A small experiment in cross-border payment operations on Arc.

SettleRef ties one supplier-payment instruction to one native-USDC settlement. It checks exact payment data, rejects repeat execution of the same payer/instruction identity within one deployment, and exports independently recheckable reconciliation records.

**Current status: first scaffold implemented and application-tested. The repository exists at `Whyme-Labs/settleref` but must be made public before submission. Not deployed, not audited, not submitted. Live writes are disabled.**

## Run

Node.js 22 or later:

```sh
npm ci
npm test
npm run dev
```

Open http://127.0.0.1:4173. The default local walkthrough needs no wallet. Choose Load example, Review instruction, confirm, Simulate settlement, Test duplicate protection, then Verify receipt. Simulation is labelled throughout and cannot be imported as real chain evidence.

`dist/` is the static website after `npm run build`. There are no third-party browser runtime dependencies, remote scripts, analytics, server accounts, database or custody wallet. The source uses TypeScript with strict checking and browser-native APIs.

## What is implemented

- Strict versioned JSON payment instructions, exact 6-decimal business amounts mapped to 18-decimal native USDC units.
- A stable end-to-end identity and salted SHA-256 content commitment. Invoice references stay offchain.
- A Solidity payment contract capped at 1 USDC per call. No approvals, admin, upgradeability or service fee.
- An EIP-1193 browser-wallet adapter with chain, payer, duplicate, balance and runtime-bytecode checks. Owner-enabled deployment configuration is required.
- Receipt reconciliation using transaction data, a unique contract event and canonical-block checks against a configured RPC.
- JSON receipt bundles and spreadsheet-safe CSV exports. Imported receipt claims never select a contract or RPC.
- 53 passing Node tests at the initial verification checkpoint. See evidence/node-tests.tap.txt.
- 18 Solidity tests including fuzzing and reentrancy scenarios. CI installs a checksum-pinned Arc Foundry release and runs both standard EVM and Arc execution profiles. See `evidence/validation.json` for observed results.

## Limits that matter

This is payment-operations software, not a bank, remittance provider, FX service or SWIFT adapter. It does not move fiat between countries, verify invoice authenticity, determine legal compliance, or prove that a beneficiary delivered goods. There is no ISO 20022 XML support in v0. `endToEndId` is an application field, not a claim of bank interoperability.

Duplicate protection is scoped to payer + instruction ID + contract deployment. A new ID, another payer, another chain, direct transfer or another contract is outside that protection. Wallet-to-wallet native transfers bypass SettleRef. RPC verification trusts the configured RPC and the pinned, non-upgradeable contract. A receipt is an application record, not a bank-issued confirmation.

Keep payment files private. Instructions are stored in the current browser tab's session storage after review, and appear in user-requested exports. Public-chain addresses, amounts, hashes, timing and payment identity commitments are public. Salted commitments hide invoice content only while their salt and content remain private.

## Project map

| Path | Purpose |
|---|---|
| `contracts/SettleRef.sol` | Capped atomic native-USDC settlement |
| `contracts/test/SettleRef.t.sol` | Contract tests, not yet executed |
| `src/domain.ts` | Validation, amounts and commitment rules |
| `src/chain.ts` | Static ABI, wallet transaction and receipt verifier |
| `src/app.ts` | Browser workflow |
| `tests/` | Executed domain and mocked-RPC boundary tests |
| `public/deployment.json` | Trusted deployment config, writes disabled |
| `docs/submission.md` | Verified organizer requirements and readiness checklist |
| `docs/demo.md` | Clear local and live demonstration scripts |
| `docs/architecture.md` | Decisions and trust boundaries |
| `docs/next-tasks.md` | Remaining milestones and issue-ready work |
| `scripts/deploy.sh` | Owner-operated, gated Arc deployment |
| `submission.json` | Submission copy and missing evidence |

## Contract and release checks

```sh
bash scripts/install-arc-foundry.sh
npm run test:contracts
npm run test:contracts:arc
npm run check:abi
npm run check:submission
```

The submission command intentionally exits nonzero until real deployment and submission evidence is filled. It does not infer readiness from screenshots or a simulation.

Read `docs/deployment.md` before broadcasting anything. The installer pins Arc Foundry `v0.8.0-2` by SHA-256 rather than treating upstream Foundry as Arc validation. Use Arc testnet to exercise live network behavior before a tiny owner-controlled mainnet demo. Never share private keys in chat or commit them to this repository.

## Arc Microgrants

The organizer requires a working mainnet project and public repository. Deadline: October 15, 2026 at 11:59 Malaysia time. See source-backed details in `docs/submission.md`. This local scaffold is not eligible by itself.

## License

MIT. No affiliation with Circle, Arc or a bank is claimed.
