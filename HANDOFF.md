# Resume SettleRef

The user approved a quick, lean Arc Microgrants experiment relevant to banking and cross-border finance. The chosen product is SettleRef, a supplier-payment instruction, capped native-USDC settlement, duplicate-execution guard and reconciliation receipt.

The implementation is maintained in `Whyme-Labs/settleref`. The repository was created as private and must be switched to public before grant submission. GitHub's connected account is `wms2537`.

SR-01, SR-02 and SR-03 have passed. The reviewed operator/source candidate is `a5b3807b94bd8407f3e5fcb99100e2acd945bfcf`; the unchanged contract was tested on both networks. CI run `38391363909` passed 70 application/operator tests, typecheck/build, ABI checks, and 18 contract tests per standard EVM and Arc Zero8 profile with 256 fuzz runs each. Independent Standards and Spec reviews passed after operator concurrency/recovery fixes. Work is on `codex/mac-browser-wallet`, draft PR https://github.com/Whyme-Labs/settleref/pull/5.

Mainnet chain: 5042. Contract: `0xef9cb6e223d4fc63e82e95b1a6cbfe0b31ef3dc4`. Deployment: `0x879747b8cf1b527d6b47259c206bc58523dbaf912d0cf750875d83fb311f5db2`. Owner-funded 0.10-USDC payment: `0x6484698394e23ed188997287e7d2f8685ea962223ce05571a99579f70eb3880a`. Exact creation/runtime, calldata, event, canonical block, consumed state, pending reload recovery and a second browser without a wallet all passed. Original-calldata `eth_call` returns exact `DuplicateInstruction()` without another broadcast. Evidence is under `evidence/sr03/owner/`.

`npm run build` compiles the browser modules and produces `dist/`. `node scripts/serve.mjs` then serves the static walkthrough without a framework runtime.

Read docs/next-tasks.md for the exact remaining milestones. Keep the one-network/one-asset boundary. Do not turn this into a payment platform.

SR-04 remains: make source public, publish the prepared static app, verify public links while signed out, and submit the DoraHacks application. Repository remains private. The owner-approved, pinned mainnet hosting configuration is staged separately; tracked `public/deployment.json` stays unconfigured with writes disabled. Signing keys remain in the owner's MetaMask.

The logged-in DoraHacks wizard has saved profile/logo, description, team and staff-only primary/backup contacts. Arc-specific answers include the owner's contact email and confirmations of rights, no prior Circle/Arc funding and first Arc deployment. Never place those private contact values in the public repository. Final-form fields reset when leaving the Submission step; refill from the prepared copy if needed. Submit for Review is the final action, with Terms of Use and Participant Agreement acceptance. Final publication/submission authorization is still pending.

Deadline verified from the organizer: 2026-10-15 at 11:59 Malaysia time. Read `docs/submission.md`, `docs/next-tasks.md` and `evidence/validation.json`. Use the existing instruction and transaction hashes; never resend an uncertain payment or replace its ID.
