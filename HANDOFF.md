# Resume SettleRef

All four milestones passed. SettleRef is public and was submitted to Arc Microgrants on October 13, 2026. DoraHacks confirms the application is under review; no grant approval or funding is claimed.

- Repository: https://github.com/Whyme-Labs/settleref
- App: https://settleref.pages.dev/
- 56-second narrated 1080p Remotion demo: https://settleref.pages.dev/demo.html
- Reproducible video source: https://settleref.pages.dev/remotion-source.zip
- DoraHacks Build: https://dorahacks.io/build/49693
- Reviewed PR #5: merged as `9a90046d56267ca5baf5447e1267b8f0c1fafe65`.
- Merge CI and browser verification: runs `38395599955` and `38395600220`, both success.

The reviewed compiled candidate is `a5b3807b94bd8407f3e5fcb99100e2acd945bfcf`; exact deployment creation/runtime and genuine 0.10-USDC testnet/mainnet payments passed independent verification. Mainnet chain 5042, contract `0xef9cb6e223d4fc63e82e95b1a6cbfe0b31ef3dc4`, deployment `0x879747b8cf1b527d6b47259c206bc58523dbaf912d0cf750875d83fb311f5db2`, payment `0x6484698394e23ed188997287e7d2f8685ea962223ce05571a99579f70eb3880a`. Both networks passed exact calldata/event, canonical-block and duplicate checks, pending identity/hash recovery, actual exports and independent browser reconciliation. Evidence is under `evidence/sr03/owner/`.

The public app was independently verified without a wallet. Its pinned mainnet configuration is hosted separately from the unconfigured, writes-disabled source default. Public publication/video/submission receipts are under `evidence/sr04/`. To rerun the submission checker, supply the hosted or independently pinned deployment JSON with `DEPLOYMENT_CONFIG_PATH`; the source default deliberately remains disabled.

Private contact email, Telegram and backup contact are in DoraHacks staff-only fields and excluded from this repository. Signing stayed in the owner's MetaMask. Never resend an uncertain payment or replace its identity. Keep scope to one native-USDC instruction, settlement and reconciliation.

No active recurring review monitor was requested. Any follow-up begins by checking the existing DoraHacks submission, rather than submitting a second Build.
