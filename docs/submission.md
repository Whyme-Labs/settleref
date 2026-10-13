# Arc Microgrants submission

Verified on October 13, 2026, Malaysia time. Recheck before submitting because the organizer may change dates.

Primary organizer source: https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq
Submission destination: https://dorahacks.io/hackathon/arc-microgrants/detail

The detail page and all logged-in Build wizard steps were inspected in Chrome on October 13. The detail page repeats the working-mainnet requirement and rejects testnet-only builds. The Profile step requires a logo, accepts PNG/JPEG under 2 MB and recommends 480 x 480 px. A repository URL and social link are required; project website and demo video fields are optional. Contact requires Telegram and one backup contact, visible only to DoraHacks staff. The Arc-specific form asks for an email, builder profile, live project link, public repository, two-sentence description, Arc use, prior Arc deployment history and prior funding. Its deployment-evidence field accepts a mainnet contract address or verifiable transaction hash; a separate payment hash is not mandatory for that field. Final action is Submit for Review, with Terms of Use and Participant Agreement acceptance.

## Required by the organizer

- Working deployment on Arc **mainnet** and a link reviewers can open.
- Public source repository.
- Short explanation of the project and how it uses Arc.
- Public builder profile, such as GitHub, X or Farcaster.
- One submission per project; rights to submit the work.
- Work not already funded by a Circle or Arc program.
- Individuals or teams worldwide, subject to sanctions and restricted-jurisdiction screening.
- A wallet that can receive USDC on Arc; selected recipients complete payout verification.

There are 20 awards of 500 USDC each from a 10,000 USDC pool. Reviews are rolling. Deadline: October 14, 2026 at 23:59 US Eastern, which is October 15 at 03:59 UTC and **11:59 Malaysia time**. Decisions are due by October 21. Testnet-only projects, slide decks, mockups and projects without an Arc component are not eligible. Traction, incorporation, a deck and a roadmap are not required.

## Our extra quality checks, not organizer-mandated fields

- Reviewable contract test output and ABI agreement.
- A successful owner-controlled Arc testnet smoke test.
- Deployed runtime matches the compiled artifact; pin its SHA-256 hash.
- One tiny mainnet payment with a real receipt and explorer reference.
- Contract-level duplicate-rejection proof. A disabled UI button is not proof.
- A second browser can import the same instruction/bundle and verify without the sender's wallet.
- Mobile workflow checked; no unsupported bank, FX or certification claims.
- A short demonstration recording is recommended for clarity, not listed as mandatory on the verified organizer page.

## Current readiness

SUBMITTED UNDER REVIEW on October 13, 2026. DoraHacks Build: https://dorahacks.io/build/49693 . The owner approved merging the reviewed PR, public repository visibility, Cloudflare Pages hosting and final submission under the Terms of Use and Participant Agreement. The confirmation says Build Submitted and the management view independently says this submission is under review. No organizer approval or grant funding is claimed.

Public app: https://settleref.pages.dev/ . Optional 56-second Remotion demo with a looped soundtrack: https://settleref.pages.dev/demo.html . The form's video link points to https://settleref.pages.dev/demo.mp4 . The public watch page also provides the intentionally public demo receipt for verification without a wallet.

Owner-approved testnet and mainnet deployment/payment verification passed. The mainnet 0.10-USDC payment is `0x6484698394e23ed188997287e7d2f8685ea962223ce05571a99579f70eb3880a`; receipt, canonical block, duplicate rejection, reload recovery and independent browser verification passed. The owner confirmed rights to submit, no prior Circle/Arc program funding, and first Arc deployment. Private staff-contact values stay outside this repository.

Public repository: https://github.com/Whyme-Labs/settleref . Builder profile: https://github.com/wms2537 . Publication and submission receipts are under `evidence/sr04/`.

Run `npm run check:submission` to see missing manifest fields. The checker validates local bookkeeping, not live URL accessibility, organizer eligibility or chain evidence.

For a staged hosting package with an operator-pinned deployment file, use `DEPLOYMENT_CONFIG_PATH=path/to/deployment.json npm run check:submission`. The source default remains disabled; the checker reports the exact configuration path it evaluated.

## Submission copy

Name: SettleRef

Tagline: Payment to proof.

Description: SettleRef ties a native-USDC supplier payment on Arc to its original instruction, so the recipient can check which instruction was settled and whether the exact beneficiary and amount match. A contract capped at 1 USDC rejects repeat execution of the same payer and instruction ID within one deployment; a recipient can verify the real transaction, event and content commitment without a wallet, then export JSON and spreadsheet-safe CSV.

Arc integration: Native USDC covers payment and gas in one dollar-denominated asset. Business amounts with at most six decimals convert to Arc's 18-decimal native units using integer arithmetic. The settlement contract enforces duplicate protection, and the recipient verifies the actual transaction against the original instruction and pinned deployment.

The detailed description on the existing DoraHacks Build was revised on October 13 to explain what a plain wallet transfer and explorer leave to supplier-payment operations: matching the transaction to the original instruction. The saved copy is in `docs/dorahacks-description.txt`. The public page was reloaded and its complete text and proof links checked. The existing application remains under review; no second Build was submitted. Evidence is in `evidence/sr04/submission-copy-update.json`.

Builder profile: https://github.com/wms2537

Live app: https://settleref.pages.dev/ . Public repository: https://github.com/Whyme-Labs/settleref . Verified mainnet contract and transaction links are in the detailed copy and `submission.json`.
