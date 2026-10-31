import {eligibleFeeHold,eligibleRpcDataHold} from './runner-core.mjs';

// Canned guidance only. Never interpolate transaction, wallet, or journal data here.
export function recoveryAdvice(snapshot) {
 if (!snapshot || typeof snapshot !== 'object') return '';
 const {phase, stageIndex} = snapshot;
 if (phase === 'complete' || phase === 'ready') return '';
 if (phase === 'rejected' && stageIndex === 2) {
  return 'Return approval was rejected. The 0.01 tBOT principal may remain in the owned receiver shown above. Do not restart this run. Export evidence first. Using the same owner account on testnet 968, manually verify receiver code, owner, balance and wallet history, then use a trusted contract-interaction UI to call withdraw() with zero value. Inspect the wallet fee and verify its receipt and the resulting zero receiver balance.';
 }
 if (phase === 'unknown' || phase === 'requesting') {
  return 'A wallet request may still be active or its outcome is unknown. Do not resend or clear this run. Download the evidence JSON and check wallet history on testnet 968. If the original hash later appears in this page, Resume checks that hash before any next separately approved step. A hash seen only in wallet history needs manual reconciliation; do not send a replacement.';
 }
 if (phase === 'hold') {
  if (eligibleRpcDataHold(snapshot)) {
   return 'The RPC returned incomplete transaction metadata. Keep the original hash and journal; do not resend. Verify original held hash checks it read-only with fresh complete data and cannot open a wallet prompt. Export the reconciled evidence before considering a separate owner return approval.';
  }
  if (eligibleFeeHold(snapshot)) {
   return 'The wallet changed the fee format after sending the original transaction. Do not resend or clear the journal. The separate Verify original held hash button checks this exact hash read-only and cannot request a wallet transaction. Export evidence and inspect the verified step before any later step.';
  }
  return 'Verification or saved-state checks stopped this run. Do not resend, clear the browser journal, or treat this as a completed payment. Download the evidence JSON, compare the original hash and bounded receipt snapshots with a trusted source, and seek technical review before any manual recovery action.';
 }
 if (phase === 'pending' || phase === 'hash-known') {
  return 'The original transaction hash is retained. Resume first checks that same hash read-only; it never resends it. Keep the same account and testnet 968. A later stage, if reached, requires its own wallet approval. Download evidence before closing the browser profile.';
 }
 if (phase === 'rejected') {
  return 'The wallet rejected this stage. No automatic retry is available. Download evidence and check wallet history for an unexpected send before taking any new action; keep the browser journal for review.';
 }
 return '';
}
