# BOT network and original-hash RPC recovery source synchronization

This change brings the subsequently deployed BOT network UI and R3 fee-recovery code back into source control, then adds the reviewed R4 incomplete-RPC recovery fix. The source baseline is main `ccb8850486ba2db81bdf81587e33cebb07c8add1`. Recovered browser modules were fetched from pinned deployment `37f27af4-88d3-4cf6-84f7-4d2a1766202d` and matched the owner-provided R3 archive byte-for-byte. The original release inventory and `docs/bot-hosting.md` remain historical records.

## Failure and correction

A transaction lookup can temporarily omit `chainId` and return null mined-block metadata even when the receipt lookup already reports a mined transaction. R3 attempted to parse those missing fields and recorded a generic `VERIFICATION_ERROR`, trapping the saved run. R4 records `RPC_TRANSACTION_DATA_INCOMPLETE` and uses existing bounded same-hash polling. It never fills missing fields from configured chain ID or from receipt data. Populated contradictory intent, chain, fee, block or index data still fails closed.

The separate **Verify original held hash (read-only)** action accepts the precise historical incomplete-data hold and ensuing read-only pending checks. It runs the original wallet-context, artifact, saved-intent and prior-receipt gates, then full current transaction/receipt/event/finality/receiver verification. It never calls the next send path. A later owner return remains a distinct wallet approval. Existing IDs/hashes and browser journal are preserved.

Network switching remains an explicit separate owner wallet action. No startup auto-switch, blanket signing, private-key handling, funded transaction, mainnet BOT UI or credential setup was added.

## Evidence and limits

`evidence/bot-rpc-recovery-source.json` pins all synchronized browser modules and targeted tests. New regression fixtures are wholly synthetic; no owner's exported journal, private reference/salt, real wallet run or diagnostic dump is published here. The full release candidate SHA-256 is `49261cf8ebd62d3900efd3199c91474278c4e5c6e02049db090a7f73daa5558e`: 28 files plus two directories, five changes from R3 and 23 byte-identical files. It is not included in the repository.

The earlier candidate passed 41 Node tests plus five independent review tests, and an independent full-archive membership/CRC/byte comparison. Public asset/import references resolved. These are not real browser-wallet qualification or independent chain consensus. The synchronized repository passed all 118 local Node tests, production build and TypeScript typecheck. Contract sources are unchanged; contract suites and live browser-wallet qualification were not rerun. No deployment or remote CI run is authorized by this change; commits use `[skip ci]` and workflows remain untouched.

## Reproducible release follow-up

Ordinary `npm run build` still does not reproduce the full production archive: the tracked Arc deployment configuration deliberately remains writes-disabled, and demo media/release overlays are separate. Do not deploy that development placeholder over production. Preserve the complete reviewed release distribution and its manifest, with the existing published Arc configuration, media and security headers. A future packaging task should pin these release assets explicitly so deployments no longer depend on unsynchronized local archives. GitHub source publication and Cloudflare deployment are separate operations.
