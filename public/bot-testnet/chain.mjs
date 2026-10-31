import {network,LIMITS} from './networks.mjs';
import {address,hash,object,parseInstruction,parseBundle,units,format,commitments,sha256} from './domain.mjs';
export const SELECTORS={settle:'0x355b5dd4',settled:'0x86efd7ea',max:'0xb1c1008c'};
export const SETTLED_TOPIC='0x62d217e5449ea37cc82d49f6ade136c256d3a8c81b72e30bcd42cd6f611cf876';
export function hex(n){return '0x'+n.toString(16);}
export function quantity(v){if(typeof v!=='string'||!/^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v))throw Error('Malformed RPC quantity.');return BigInt(v);}
// Incomplete RPC indexing is not evidence of failure or permission to resend.
export function requireTransactionMetadata(tx,receipt){
 const missing=['chainId'].filter(key=>tx[key]==null);
 if(receipt)for(const key of ['blockNumber','blockHash','transactionIndex'])if(tx[key]==null)missing.push(key);
 if(missing.length){const error=Error('RPC_TRANSACTION_DATA_INCOMPLETE');error.code='RPC_TRANSACTION_DATA_INCOMPLETE';error.fields=missing;throw error;}
}
export function data(v){if(typeof v!=='string'||!/^0x([0-9a-fA-F]{2})*$/.test(v))throw Error('Malformed byte data.');return v.toLowerCase();}
export function word(v){const s=typeof v==='bigint'?v.toString(16):v.slice(2);if(!/^[0-9a-fA-F]{1,64}$/.test(s))throw Error('Invalid ABI word.');return s.toLowerCase().padStart(64,'0');}
export async function encodeSettlement(raw){const i=parseInstruction(raw),c=await commitments(i);return SELECTORS.settle+[c.instructionId,i.beneficiary,units(i.amount),c.contentHash,BigInt(i.expiresAt)].map(word).join('');}
export async function verifyNetwork(rpc,config){
  const n=network(config.chainId);if(!config.genesisHash)throw Error('Network genesis has not been qualified.');
  if(quantity(await rpc.request('eth_chainId',[]))!==BigInt(n.chainId))throw Error('Wrong RPC network.');
  const g=object(await rpc.request('eth_getBlockByNumber',['0x0',false]));
  if(quantity(g.number)!==0n||hash(g.hash)!==hash(config.genesisHash))throw Error('Wrong genesis. Chain ID alone does not authenticate BOT.');
}
export async function requireDeployment(rpc,cfg){
  if(!cfg.contractAddress||!cfg.runtimeHash||!cfg.expectedChainSelector)throw Error('No reviewed deployment is configured.');
  await verifyNetwork(rpc,cfg);const target=address(cfg.contractAddress);
  const code=data(await rpc.request('eth_getCode',[target,'latest']));
  if(code==='0x'||await sha256(code)!==hash(cfg.runtimeHash))throw Error('Contract runtime does not match the reviewed artifact.');
  if(data(await rpc.request('eth_call',[{to:target,data:SELECTORS.max},'latest']))!=='0x'+word(LIMITS.payment))throw Error('Wrong native BOT cap.');
  if(data(await rpc.request('eth_call',[{to:target,data:cfg.expectedChainSelector},'latest']))!=='0x'+word(BigInt(cfg.chainId)))throw Error('Contract network restriction differs from configuration.');
  return target;
}
export async function consumed(rpc,target,i,tag='latest'){const c=await commitments(i);return data(await rpc.request('eth_call',[{to:target,data:SELECTORS.settled+word(i.payer)+word(c.instructionId)},tag]));}
export async function preparePlan(rpc,cfg,raw,{account,walletChainId,now=Math.floor(Date.now()/1000)}={}){
  const i=parseInstruction(raw),n=network(i.chainId);
  if(i.chainId!==cfg.chainId)throw Error('Instruction and selected network differ.');
  if(walletChainId!==i.chainId)throw Error('Wrong wallet network. Select '+n.name+' ('+n.chainId+').');
  if(address(account)!==i.payer)throw Error('Connected account differs from the instruction payer.');
  if(cfg.chainId===677||cfg.writesEnabled!==true)throw Error('Mainnet signing is disabled. This candidate is for review only.');
  if(i.expiresAt<=now)throw Error('Instruction expired. Keep its ID and any submitted hash until reconciled.');
  const target=await requireDeployment(rpc,cfg);if(i.beneficiary===target)throw Error('Settlement contract cannot be its own beneficiary.');
  if(await consumed(rpc,target,i)!=='0x'+word(0n))throw Error('Duplicate instruction or invalid duplicate state.');
  const tx={from:i.payer,to:target,chainId:hex(BigInt(i.chainId)),data:await encodeSettlement(i),value:hex(units(i.amount))};
  await rpc.request('eth_call',[tx,'latest']);
  const estimate=quantity(await rpc.request('eth_estimateGas',[tx]));const gas=estimate*12n/10n+2000n;
  const gasPrice=quantity(await rpc.request('eth_gasPrice',[]));
  if(estimate===0n||gas>LIMITS.gas||gasPrice===0n||gas*gasPrice>LIMITS.fee)throw Error('Gas or fee exceeds the provisional testnet review limit.');
  if(quantity(await rpc.request('eth_getBalance',[i.payer,'latest']))<units(i.amount)+gas*gasPrice)throw Error('Insufficient test BOT for principal plus maximum gas.');
  return {kind:'unsigned-reviewed-plan',instruction:i,...await commitments(i),transaction:{...tx,gas:hex(gas),gasPrice:hex(gasPrice)},maximumFee:format(gas*gasPrice),asset:n.asset,validUntil:now+300};
}
export async function verifyReceipt(rpc,cfg,raw){
  const bundle=parseBundle(raw),i=bundle.instruction,txHash=bundle.transactionHash;
  if(i.chainId!==cfg.chainId)throw Error('Receipt belongs to another network.');
  const target=await requireDeployment(rpc,cfg),r=await rpc.request('eth_getTransactionReceipt',[txHash]);
  if(r===null)throw Error('Receipt unavailable. Keep the original hash and instruction; do not resend.');
  if(r.status!=='0x1'||hash(r.transactionHash)!==txHash||address(r.from)!==i.payer||address(r.to)!==target)throw Error('Receipt did not succeed or its sender/target differs.');
  const tx=object(await rpc.request('eth_getTransactionByHash',[txHash]));
  requireTransactionMetadata(tx,r);
  if(hash(tx.hash)!==txHash||quantity(tx.chainId)!==BigInt(i.chainId)||address(tx.from)!==i.payer||address(tx.to)!==target||quantity(tx.value)!==units(i.amount)||data(tx.input)!==await encodeSettlement(i))throw Error('Transaction does not match the committed instruction.');
  const gas=quantity(tx.gas),price=quantity(r.effectiveGasPrice),ceiling=quantity(tx.maxFeePerGas??tx.gasPrice),used=quantity(r.gasUsed);
  if(gas>LIMITS.gas||used===0n||used>gas||price>ceiling||gas*ceiling>LIMITS.fee)throw Error('Transaction gas/fee exceeds reviewed limits.');
  const height=quantity(r.blockNumber),blockHash=hash(r.blockHash);
  if(quantity(tx.blockNumber)!==height||hash(tx.blockHash)!==blockHash||quantity(tx.transactionIndex)!==quantity(r.transactionIndex))throw Error('Transaction and receipt block/index mismatch.');
  if(!Array.isArray(r.logs))throw Error('Malformed event list.');
  const matches=r.logs.filter(l=>typeof l.address==='string'&&l.address.toLowerCase()===target&&Array.isArray(l.topics)&&l.topics[0]?.toLowerCase()===SETTLED_TOPIC);
  if(matches.length!==1)throw Error('Expected one event from the reviewed contract.');
  const event=matches[0],c=await commitments(i),topics=[SETTLED_TOPIC,'0x'+word(i.payer),c.instructionId,'0x'+word(i.beneficiary)];
  if(event.removed!==false||event.topics.length!==4||event.topics.some((v,k)=>hash(v)!==topics[k])||data(event.data)!=='0x'+[units(i.amount),c.contentHash,BigInt(i.expiresAt)].map(word).join('')||hash(event.transactionHash)!==txHash||hash(event.blockHash)!==blockHash||quantity(event.blockNumber)!==height||quantity(event.transactionIndex)!==quantity(r.transactionIndex))throw Error('Event identity, contents or provenance mismatch.');
  const block=object(await rpc.request('eth_getBlockByNumber',[hex(height),false]));
  if(hash(block.hash)!==blockHash||quantity(block.number)!==height||quantity(block.timestamp)>=BigInt(i.expiresAt))throw Error('Noncanonical or expired payment block.');
  const final=await rpc.request('eth_getBlockByNumber',['finalized',false]);if(!final||quantity(final.number)<height)throw Error('Finality is not established. Keep this payment pending.');
  const canonicalFinal=object(await rpc.request('eth_getBlockByNumber',[final.number,false]));
  if(hash(canonicalFinal.hash)!==hash(final.hash)||quantity(canonicalFinal.number)!==quantity(final.number))throw Error('Finalized head is not canonical.');
  const again=object(await rpc.request('eth_getBlockByNumber',[hex(height),false]));if(hash(again.hash)!==blockHash||again.timestamp!==block.timestamp)throw Error('Payment block changed during verification.');
  if(await consumed(rpc,target,i,hex(height))!=='0x'+word(1n))throw Error('Instruction was not consumed at the payment block.');
  return {schema:'settleref.bot.receipt.v2',kind:'rpc-checked-finalized',chainId:i.chainId,asset:i.asset,amount:i.amount,fee:format(used*price),transactionHash:txHash,blockHash,blockNumber:height.toString(),contractAddress:target,...c,payer:i.payer,beneficiary:i.beneficiary,reference:i.reference,finalizedBlockHash:hash(final.hash),verificationBasis:'Configured RPC and pinned runtime; not an independent consensus proof',invoiceAuthenticityVerified:false};
}
