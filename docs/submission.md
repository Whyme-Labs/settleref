# Arc Microgrants submission

Verified on October 13, 2026, Malaysia time. Recheck before submitting because the organizer may change dates.

Primary organizer source: https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq
Submission destination: https://dorahacks.io/hackathon/arc-microgrants/detail

The research tool returned HTTP 405, but the detail page and logged-in Build wizard were inspected in Chrome on October 13. The detail page repeats the working-mainnet requirement and rejects testnet-only builds. The Profile step requires a logo, accepts PNG/JPEG under 2 MB and recommends 480 x 480 px. A repository URL is required; project website and demo video fields are optional. At least one social link is required. The wizard also includes Details, Team, Contact and Submission steps. A mandatory transaction-hash field has not yet been observed; that does not waive the working-mainnet requirement.

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

NOT READY. The source repository exists at `https://github.com/Whyme-Labs/settleref`, but it is private and therefore does not yet satisfy the public-repository requirement. Application, contract CI and browser E2E validation passed under SR-01 and SR-02. The genuine owner-approved Arc testnet deployment and 0.10-USDC payment now pass independent verification. The owner-funded payer has 2 USDC on Arc mainnet. No public app or verified mainnet SettleRef transaction is recorded yet.

Repository: https://github.com/Whyme-Labs/settleref. Make it public before inserting it into `submission.json`. The connected builder profile resolves to https://github.com/wms2537.

Run `npm run check:submission` to see missing manifest fields. The checker validates local bookkeeping, not live URL accessibility, organizer eligibility or chain evidence.

## Suggested submission copy

Name: SettleRef

Tagline: Payment to proof.

Description: SettleRef links a structured supplier-payment instruction to a USDC settlement on Arc. A capped, non-upgradeable contract pays the specified beneficiary and rejects duplicate execution of the same instruction by the same payer. The recipient can reconcile the original instruction with the real transaction and contract event, then export JSON and CSV records. Invoice references remain offchain behind a salted commitment. This is a focused payment-operations experiment, not a bank, FX or fiat-remittance service.

Arc integration: Native USDC settlement and gas, contract-enforced duplicate protection, and chain-backed reconciliation. The verifier checks a pinned deployment and exact sender, beneficiary, amount, instruction commitment and canonical block.

Builder profile: https://github.com/wms2537

Live URL, repository URL, contract address and transaction hashes: fill only after verified deployment. Do not submit placeholder links.
