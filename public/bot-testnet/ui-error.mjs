const guidance=Object.freeze({
 TESTNET_968_ONLY:'TESTNET_968_ONLY — Wallet is on another network. Use Switch to BOT testnet (chain 968), approve that network change in your wallet, then connect again. No transaction was requested.',
 TESTNET_GENESIS_MISMATCH:'TESTNET_GENESIS_MISMATCH — The wallet network does not match the pinned BOT testnet genesis. Check its network configuration; do not send a transaction.',
 ONE_CONNECTED_ACCOUNT_REQUIRED:'ONE_CONNECTED_ACCOUNT_REQUIRED — Select one account in your wallet, then reconnect.',
 WALLET_CHANGED_HOLD:'WALLET_CHANGED_HOLD — The wallet network or account changed during checks. Preserve any existing run and reconnect on BOT testnet 968.'
});

// Only bounded machine codes are displayed. Never surface an untrusted wallet
// message, which may contain private account or extension details.
export function safeError(error){
 const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{3,69}$/.test(error.code)?error.code:null;
 return code?(guidance[code]??code):'PROVIDER_OR_VERIFICATION_ERROR';
}
