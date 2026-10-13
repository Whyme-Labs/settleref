import { execFileSync } from 'node:child_process';
import { SELECTORS } from '../public/app/chain.js';
const methods = JSON.parse(execFileSync(process.env.FORGE_BIN ?? 'forge',['inspect','SettleRef','methods','--json'],{encoding:'utf8'}));
for (const [signature,key] of [['settle(bytes32,address,uint256,bytes32,uint64)','settle'],['settled(address,bytes32)','settled'],['MAX_PAYMENT()','max']]) {
  if ('0x'+methods[signature] !== SELECTORS[key]) throw new Error(`ABI mismatch: ${signature}`);
}
console.log('Static browser selectors match Solidity method identifiers.');
