# SettleRef engineering rules

Read README.md, docs/architecture.md, docs/next-tasks.md and evidence/validation.json first.

Preserve the narrow scope: one native-USDC payment and reconciliation on Arc. Do not add AI, FX, bank claims or ISO 20022 XML without explicit approval. Keep live writes disabled until real deployment evidence exists.

Use bigint for amounts; native USDC uses 18 decimals, business inputs at most 6. Identity must not change merely because amount, beneficiary or salt changes. Never automatically retry transaction broadcasts. Retain original IDs and hashes through uncertain outcomes.

Receipt bundles are untrusted. Do not take an RPC, contract address or verification result from an uploaded receipt. Validate actual sender, target, amount, calldata, contract event and block against the trusted deployment. Never render user text with innerHTML.

Run `npm test`, `npm run typecheck`, `npm run test:contracts`, `npm run test:contracts:arc`, and `npm run check:abi`. Do not describe upstream Foundry execution as Arc-specific validation. Distinguish mocked RPC checks from EVM tests and live-chain checks. Do not label a test as passed unless it ran.

No private keys in commits, UI configuration, logs or chat. Do not run untrusted public pull requests on the home CI runner. Public-repo jobs use isolated hosted runners without signing secrets.

Use docs/next-tasks.md as issue-ready work until GitHub write access exists. Update evidence/validation.json only with observed results.
