# Resume SettleRef

The user approved a quick, lean Arc Microgrants experiment relevant to banking and cross-border finance. The chosen product is SettleRef, a supplier-payment instruction, capped native-USDC settlement, duplicate-execution guard and reconciliation receipt.

The implementation is maintained in `Whyme-Labs/settleref`. The repository was created as private and must be switched to public before grant submission. GitHub's connected account is `wms2537`.

Run `npm ci && npm test` and inspect evidence/validation.json. There are 53 passing application tests; mocked RPC is not actual chain evidence. Contract CI now installs checksum-pinned Arc Foundry and runs both standard EVM and Arc profiles. Treat it as pending until the GitHub workflow is observed green. The actual browser flow still needs execution. Live writes are disabled and no mainnet transaction exists.

`npm run build` compiles the browser modules and produces `dist/`. `node scripts/serve.mjs` then serves the static walkthrough without a framework runtime.

Read docs/next-tasks.md for the exact remaining milestones. Keep the one-network/one-asset boundary. Do not turn this into a payment platform.

Deadline verified from the organizer: 2026-10-15 at 11:59 Malaysia time. The DoraHacks detail page returned HTTP 405, so the actual logged-in submission form still needs inspection. Official source and requirements are in docs/submission.md. Never claim eligibility or submission from the local demo.
