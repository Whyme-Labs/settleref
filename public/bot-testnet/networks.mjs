export const NETWORKS = Object.freeze({
  968: Object.freeze({ chainId:968, name:'BOT testnet', asset:'tBOT', decimals:18, rpcUrl:'https://rpc.bohr.life', explorerUrl:'https://scan.bohr.life', genesisHash:'0x395bd3d6583216495648e8322032761c1a377eddf04f59de0c693c7d6682aee6', identityDomain:'settleref.bot-testnet.identity.v2', contentDomain:'settleref.bot-testnet.content.v2', contractName:'BotTestnetRelease', writesEnabled:false }),
  677: Object.freeze({ chainId:677, name:'BOT mainnet candidate', asset:'BOT', decimals:18, rpcUrl:'https://rpc.botchain.ai', explorerUrl:'https://scan.botchain.ai', genesisHash:'0x161a4ff8b4c95e95b314899c4ea8f9782c4ae8851362ffe0d47c0b8a05f7b784', identityDomain:'settleref.bot-mainnet.identity.v2', contentDomain:'settleref.bot-mainnet.content.v2', contractName:'BotMainnetCandidate', writesEnabled:false })
});
export function network(chainId) {
  if (typeof chainId !== 'number' || !Object.hasOwn(NETWORKS,chainId)) throw Error('Unsupported BOT network.');
  return NETWORKS[chainId];
}
export const LIMITS = Object.freeze({ payment:100_000_000_000_000_000n, fee:5_000_000_000_000_000n, gas:150_000n });
