import {network,LIMITS} from './networks.mjs';
export function object(v,label='Value') { if(!v||typeof v!=='object'||Array.isArray(v))throw Error(label+' must be an object.');return v; }
export function exact(v,keys) { object(v);if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))throw Error('Unsupported or missing fields.');return v; }
export function address(v) { if(typeof v!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(v)||/^0x0{40}$/.test(v))throw Error('Use a nonzero 20-byte address.');return v.toLowerCase(); }
export function hash(v) { if(typeof v!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(v))throw Error('Expected a 32-byte hash.');return v.toLowerCase(); }
function salt(v) { v=hash(v);if(/^0x0{64}$/.test(v))throw Error('Use a nonzero random salt.');return v; }
export function units(v) {
  if(typeof v!=='string'||!/^(0|[1-9]\d{0,8})(\.\d{1,18})?$/.test(v))throw Error('Use an exact decimal string with at most 18 places.');
  const [whole,fraction='']=v.split('.'),n=BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));
  if(n<=0n||n>LIMITS.payment)throw Error('The pilot accepts above zero and at most 0.10 native BOT per payment.');return n;
}
export function format(n) { return `${n/10n**18n}.${(n%10n**18n).toString().padStart(18,'0')}`; }
export function displayAmount(v) { return format(typeof v==='bigint'?v:units(v)).replace(/\.?0+$/,''); }
export async function sha256(text) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return '0x'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''); }
export function randomHash() { return '0x'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''); }
export const INSTRUCTION_KEYS=['schema','chainId','endToEndId','identitySalt','payer','beneficiary','asset','amount','reference','expiresAt','privacySalt'];
export function parseInstruction(raw) {
  const v=exact(raw,INSTRUCTION_KEYS);
  if(v.schema!=='settleref.bot.instruction.v2')throw Error('Use a v2 instruction. Baseline v1 receipts require their preserved v1 verifier.');
  const n=network(v.chainId);
  if(v.asset!==n.asset)throw Error('Wrong asset for the selected BOT network.');
  if(typeof v.endToEndId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/.test(v.endToEndId))throw Error('Invalid stable instruction reference.');
  if(typeof v.reference!=='string'||v.reference.length<1||v.reference.length>140||/[\x00-\x1f\x7f]/.test(v.reference))throw Error('Reference must be 1–140 characters without control characters.');
  if(!Number.isSafeInteger(v.expiresAt)||v.expiresAt<=0)throw Error('Invalid expiry.');
  const payer=address(v.payer),beneficiary=address(v.beneficiary);if(payer===beneficiary)throw Error('Payer and beneficiary must differ.');
  return Object.freeze({...v,payer,beneficiary,identitySalt:salt(v.identitySalt),privacySalt:salt(v.privacySalt),amount:format(units(v.amount))});
}
export async function commitments(raw) {
  const i=parseInstruction(raw),n=network(i.chainId);
  return {instructionId:await sha256(JSON.stringify([n.identityDomain,i.chainId,i.payer,i.endToEndId,i.identitySalt])),contentHash:await sha256(JSON.stringify([n.contentDomain,...INSTRUCTION_KEYS.map(k=>i[k])]))};
}
export function createInstruction(chainId,payer,beneficiary) {
  const n=network(chainId);return parseInstruction({schema:'settleref.bot.instruction.v2',chainId,endToEndId:crypto.randomUUID(),identitySalt:randomHash(),payer,beneficiary,asset:n.asset,amount:'0.01',reference:'BOT test payment',expiresAt:Math.floor(Date.now()/1000)+86400,privacySalt:randomHash()});
}
export function exportBundle(i,txHash) { return {schema:'settleref.bot.bundle.v2',instruction:parseInstruction(i),transactionHash:hash(txHash)}; }
export function parseBundle(raw) { const v=exact(raw,['schema','instruction','transactionHash']);if(v.schema!=='settleref.bot.bundle.v2')throw Error('Use a v2 receipt bundle; legacy v1 uses its preserved verifier.');return exportBundle(v.instruction,v.transactionHash); }
