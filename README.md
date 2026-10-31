# SettleRef

Payment to proof. A small experiment in cross-border payment operations on Arc.

SettleRef ties one supplier-payment instruction to one native-USDC settlement. It checks exact payment data, rejects repeat execution of the same payer and instruction identity within one deployment, and exports independently recheckable reconciliation records.

A plain wallet transfer and an explorer show that funds moved. Supplier-payment operations also need to match that transaction to the original instruction. SettleRef retains its identity through imports and retries, binds the reviewed contents to the settlement event, and lets the recipient check the beneficiary, amount and commitment without connecting a wallet. Arc's native USDC covers both payment and gas in one dollar-denominated asset.

**Current status: SR-01 through SR-04 are complete. Owner-approved testnet and mainnet deployments and 0.10-USDC payments passed independent verification, reload recovery and duplicate-rejection checks. The source and app are public. DoraHacks confirmed submission on October 13, 2026; organizer review is pending. No security audit or grant approval is claimed. Tracked live writes stay disabled by default.**

[Open the app](https://settleref.pages.dev/) · [Watch the 56-second demo](https://settleref.pages.dev/demo.html) · [DoraHacks submission](https://dorahacks.io/build/49693)

The live site now also links to a [BOT testnet-only wallet pilot](https://settleref.pages.dev/bot-testnet/). Its chain-968 deploy/payment/return runner has local fake-provider coverage and requires separate owner approval for each wallet transaction. It has not yet passed a real-wallet qualification run. See [hosting and artifact provenance](docs/bot-hosting.md) and the [owner checklist](docs/bot-testnet-owner-run.md).

## Run

Node.js 22 or later:

```sh
npm ci
npm test
npm run dev
```

Open http://127.0.0.1:4173. The default local walkthrough needs no wallet. Choose Load example, Review instruction, confirm, Simulate settlement, Test duplicate protection, then Verify receipt. Simulation is labelled throughout and cannot be imported as real chain evidence.

`dist/` is the static website after `npm run build`. There are no third-party browser runtime dependencies, remote scripts, analytics, server accounts, database or custody wallet. The source uses TypeScript with strict checking and browser-native APIs.

## Verified behavior

- 70 Node tests pass for domain rules, mocked RPC and wallet boundaries, and deployment-operator recovery and concurrency.
- 18 Solidity tests pass under the standard EVM profile and another 18 pass under Arc execution semantics, each with 256 fuzz runs.
- Real Chromium automation records 17 passed checks, 0 failed checks and eight screenshots.
- Desktop and 390 x 844 mobile flows pass without browser JavaScript errors or horizontal overflow.
- Wrong-account and wrong-network states stop before signing.
- Instruction and receipt JSON round trips preserve identity.
- CSV exports neutralize spreadsheet formulas.
- HTML-looking invoice text renders as text rather than executable markup.
- A private-key-backed EIP-1193 provider connected to Arc testnet for read-only chain verification without submitting a public-network transaction.
- One isolated Arc-Anvil transaction completed the live application path, survived reload, reconciled against RPC, exposed the duplicate flag and was independently reverified in a second browser.
- Genuine owner-approved Arc testnet and mainnet 0.10-USDC payments reconciled against the original instructions. Both retained the original identity/hash across reload and were independently verified in a browser without a wallet.
- Exact original-calldata replay on each network returns `DuplicateInstruction()` through read-only `eth_call`; no second payment was broadcast.

Machine-readable results are under `evidence/validation.json`, `evidence/browser/` and `evidence/sr03/`.

## What is implemented

- Strict versioned JSON payment instructions, exact 6-decimal business amounts mapped to 18-decimal native USDC units.
- A stable end-to-end identity and salted SHA-256 content commitment. Invoice references stay offchain.
- A Solidity payment contract capped at 1 USDC per call. No approvals, admin, upgradeability or service fee.
- An EIP-1193 browser-wallet adapter with chain, payer, duplicate, balance and runtime-bytecode checks. Owner-enabled deployment configuration is required.
- Receipt reconciliation using transaction data, a unique contract event and canonical-block checks against a configured RPC.
- JSON receipt bundles and spreadsheet-safe CSV exports. Imported receipt claims never select a contract or RPC.
- Owner deployment through a browser wallet or locally encrypted Arc Foundry keystore alias.
- Exact runtime pinning that leaves writes disabled.
- A separate write-enable gate that rechecks runtime and the one-USDC contract cap.
- A read-only live verifier for deployment creation bytecode, runtime, receipt, canonical block and duplicate state.

## SR-03 owner gate

The owner completed the browser-wallet deployment and payment flow on both networks. Mainnet contract: [`0xef9cb6e223d4fc63e82e95b1a6cbfe0b31ef3dc4`](https://explorer.arc.io/address/0xef9cb6e223d4fc63e82e95b1a6cbfe0b31ef3dc4). Mainnet [deployment](https://explorer.arc.io/tx/0x879747b8cf1b527d6b47259c206bc58523dbaf912d0cf750875d83fb311f5db2) and [0.10-USDC payment](https://explorer.arc.io/tx/0x6484698394e23ed188997287e7d2f8685ea962223ce05571a99579f70eb3880a) have exact bytecode, receipt, calldata, event and canonical-block evidence under `evidence/sr03/owner/`.

Read `docs/deployment.md` for reproduction. The runbook contains separate testnet, mainnet, runtime-pinning, write-enable and independent-verification gates. Signing keys stay in the owner's wallet.

Useful operator commands:

```sh
npm run sr03:probe
npm run sr03:deploy:browser -- testnet
npm run sr03:pin -- 0xCONTRACT_ADDRESS 5042002
CONFIRM_ENABLE_WRITES=ENABLE_OWNER_TESTNET_WRITES \
  npm run sr03:enable -- testnet
npm run sr03:verify -- \
  testnet 0xCONTRACT 0xDEPLOYMENT_TX evidence/sr03/owner/testnet-receipt.json
```

The tracked `public/deployment.json` must remain unconfigured with `writesEnabled: false` until the owner approves a genuine pinned deployment.

## Limits that matter

This is payment-operations software, not a bank, remittance provider, FX service or SWIFT adapter. It does not move fiat between countries, verify invoice authenticity, determine legal compliance, or prove that a beneficiary delivered goods. There is no ISO 20022 XML support in v0. `endToEndId` is an application field, not a claim of bank interoperability.

Duplicate protection is scoped to payer plus instruction ID plus contract deployment. A new ID, another payer, another chain, direct transfer or another contract is outside that protection. Wallet-to-wallet native transfers bypass SettleRef. RPC verification trusts the configured RPC and the pinned, non-upgradeable contract. A receipt is an application record, not a bank-issued confirmation.

Keep payment files private. Instructions are stored in the current browser tab's session storage after review, and appear in user-requested exports. Public-chain addresses, amounts, hashes, timing and payment identity commitments are public. Salted commitments hide invoice content only while their salt and content remain private.

## Project map

| Path | Purpose |
|---|---|
| `contracts/SettleRef.sol` | Capped atomic native-USDC settlement |
| `contracts/test/SettleRef.t.sol` | Standard EVM and Arc execution contract tests |
| `src/domain.ts` | Validation, amounts and commitment rules |
| `src/chain.ts` | Static ABI, wallet transaction and receipt verifier |
| `src/app.ts` | Browser workflow |
| `tests/` | Executed domain and mocked-RPC boundary tests |
| `public/deployment.json` | Trusted deployment config, writes disabled by default |
| `docs/deployment.md` | Owner-operated testnet and mainnet runbook |
| `docs/submission.md` | Verified organizer requirements and readiness checklist |
| `docs/demo.md` | Local and live demonstration scripts |
| `docs/architecture.md` | Decisions and trust boundaries |
| `docs/next-tasks.md` | Milestone state and remaining owner actions |
| `scripts/deploy.sh` | Encrypted-keystore deployment gate |
| `scripts/prepare-browser-deploy.sh` | Local browser-wallet deployment preparation |
| `scripts/pin-deployment.mjs` | Exact remote-runtime pinning, writes stay disabled |
| `scripts/enable-reviewed-deployment.mjs` | Runtime and contract-cap write-enable gate |
| `scripts/sr03-verify-live.mjs` | Independent read-only live-chain verifier |
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

The installer pins Arc Foundry `v0.8.0-2` by SHA-256 rather than treating upstream Foundry as Arc validation. Use Arc testnet before a tiny owner-controlled mainnet demo. Never share private keys in chat or commit them to this repository.

## Arc Microgrants

The organizer requires a working mainnet project and public repository. Deadline: October 15, 2026 at 11:59 Malaysia time. See source-backed details in `docs/submission.md`. Submission confirmation and public-hosting receipts are in `evidence/sr04/`. The application is under review.

## License

MIT. No affiliation with Circle, Arc or a bank is claimed.
