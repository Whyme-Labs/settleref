# Demonstration

## The story

A buyer has a small supplier invoice. They need to pay the exact recipient once and give finance a receipt that can be matched back to the instruction. The invoice is illustrative. Both wallets settle in USDC on Arc; there is no simulated fiat conversion or bank account.

## Local walkthrough

1. Start the app, select Local walkthrough and Load example.
2. Review the reference, 0.10 USDC amount, separate payer/beneficiary and persistent instruction ID.
3. Review instruction. Show the identity and salted content commitment.
4. Confirm the amount/beneficiary and simulate settlement.
5. Press Test duplicate protection. The local model refuses a second transfer for the same payer/ID.
6. Verify the simulated receipt, then export JSON and CSV.
7. Show the simulation-only warning. A simulation export must be rejected by the live receipt importer.

This demonstrates interaction design and client logic, not contract execution or Arc integration. Do not use it as grant deployment evidence.

## Mainnet demonstration, only after deployment gates pass

Use two owner-controlled wallets and a tiny amount such as 0.10 USDC. Fund sufficient USDC for gas as well. No external customer funds. Review the contract and all wallet confirmations.

1. Replace dummy payer and beneficiary addresses. Keep the exported instruction private except for deliberately public demonstration data.
2. Select Arc payment mode. Connect the payer EOA on chain 5042.
3. Review instruction and export it. The user checks the full beneficiary address and amount, then approves the wallet transaction.
4. A returned transaction hash means submitted, not settled. Verify the receipt and open it in the Arc explorer.
5. Show the settled flag and an actual failing repeat `eth_call` against the contract. Record the duplicate error; do not spend gas merely to film a rejected transaction.
6. Open another browser with no connected payer wallet. Import the original instruction/receipt bundle and verify through the configured RPC.
7. Download the reconciliation CSV and point to matching reference, amount and transaction hash.

Say: "SettleRef ties this instruction to this USDC payment and prevents this payer from executing the same ID twice in this deployment."

Do not say: "We settled a bank transfer", "ISO 20022 compliant", "international remittance is regulated automatically", "guaranteed safe", or "all possible duplicate payments are prevented".
