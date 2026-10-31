import {NETWORKS} from './networks.mjs';

const target=NETWORKS[968];
export const BOT_CHAIN_HEX='0x3c8';
// Chain ID, RPC, token symbol and explorer: BOT Chain's official Quick Guide.
// The 18-place native unit is the existing tested SettleRef network setting.
export const BOT_ADD_PARAMS=Object.freeze({
 chainId:BOT_CHAIN_HEX,chainName:'Bohr Testnet',rpcUrls:[target.rpcUrl],
 nativeCurrency:{name:'Test BOT',symbol:'BOT',decimals:target.decimals},
 blockExplorerUrls:[target.explorerUrl]
});

const failure=code=>Object.assign(new Error(code),{code});
const chainId=value=>typeof value==='string'&&/^0x[0-9a-f]+$/i.test(value)?Number(BigInt(value)):NaN;
const accountList=value=>{
 if(!Array.isArray(value)||value.length>1||value.some(a=>typeof a!=='string'||!/^0x[0-9a-f]{40}$/i.test(a)))throw failure('NETWORK_ACCOUNT_UNAVAILABLE');
 return value.map(a=>a.toLowerCase());
};
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const errorCode=e=>Number(e?.code??e?.data?.originalError?.code);
const messages=Object.freeze({
 NETWORK_PROVIDER_UNAVAILABLE:'No compatible injected wallet provider is available.',
 NETWORK_CHAIN_UNAVAILABLE:'The wallet did not return a valid chain ID. Check its network in the wallet.',
 NETWORK_ACCOUNT_UNAVAILABLE:'The wallet account response is unavailable or ambiguous. Select one account in the wallet.',
 NETWORK_SAVED_ACCOUNT_MISMATCH:'This saved run belongs to another account. Select its original account in the wallet, then reload; the journal was preserved.',
 NETWORK_ACCOUNT_CHANGED:'The wallet account changed during the network request. Reload, review the account and preserve any run.',
 NETWORK_CHAIN_CHANGED:'The wallet chain changed unexpectedly. Reload and review it before connecting.',
 NETWORK_GENESIS_MISMATCH:'Chain 968 did not match the pinned BOT testnet genesis. Do not send a transaction.',
 NETWORK_SWITCH_NOT_CONFIRMED:'The wallet has not confirmed BOT testnet 968. Check its selected network.',
 NETWORK_SWITCH_REJECTED:'Network switch declined in the wallet. No transaction was requested.',
 NETWORK_ADD_REJECTED:'Adding BOT testnet was declined in the wallet. No transaction was requested.',
 NETWORK_REQUEST_PENDING:'A wallet network request is already pending. Resolve it in the wallet before trying again.',
 NETWORK_SWITCH_UNSUPPORTED:'This wallet does not support requesting a network switch. Select BOT testnet manually.',
 NETWORK_ADD_UNSUPPORTED:'This wallet does not support adding a network from this site. Add BOT testnet manually.',
 NETWORK_SWITCH_UNCERTAIN:'Network switch outcome is uncertain. Check the wallet network manually; no automatic retry.',
 NETWORK_ADD_UNCERTAIN:'Add-network outcome is uncertain. Check the wallet network list manually; no automatic retry.',
 NETWORK_ADD_NOT_OFFERED:'Add-network is available only after this wallet reports BOT testnet is unknown.',
 NETWORK_ALREADY_SELECTED:'BOT testnet is already selected. Reload and connect after reviewing the account.'
});
export const networkActionMessage=e=>messages[e?.code]??'Wallet network check failed. Review the wallet manually; no automatic retry.';

export class BotNetworkSelector {
 constructor(provider){
  if(!provider||typeof provider.request!=='function')throw failure('NETWORK_PROVIDER_UNAVAILABLE');
  this.provider=provider;this.busy=false;this.canAdd=false;this.chainEvents=[];this.accountEvents=[];
  provider.on?.('chainChanged',value=>this.chainEvents.push(value));
  provider.on?.('accountsChanged',value=>this.accountEvents.push(value));
 }
 async inspect(){
  const id=chainId(await this.provider.request({method:'eth_chainId'}));
  if(!Number.isSafeInteger(id)||id<=0)throw failure('NETWORK_CHAIN_UNAVAILABLE');
  return {chainId:id,correct:id===968};
 }
 async accounts(){return accountList(await this.provider.request({method:'eth_accounts'}));}
 async verifyTarget(){
  const current=await this.inspect();
  if(!current.correct)throw failure('NETWORK_SWITCH_NOT_CONFIRMED');
  const block=await this.provider.request({method:'eth_getBlockByNumber',params:['0x0',false]});
  if(block?.number!=='0x0'||typeof block?.hash!=='string'||block.hash.toLowerCase()!==target.genesisHash)throw failure('NETWORK_GENESIS_MISMATCH');
  return current;
 }
 checkEvents(start,accounts){
  if(this.accountEvents.slice(start.accounts).some(value=>{try{return !equal(accountList(value),accounts);}catch{return true;}}))throw failure('NETWORK_ACCOUNT_CHANGED');
  if(this.chainEvents.slice(start.chain).some(value=>chainId(value)!==968))throw failure('NETWORK_CHAIN_CHANGED');
 }
 async switch(){
  if(this.busy)throw failure('NETWORK_REQUEST_PENDING');
  this.busy=true;this.canAdd=false;
  try{
   const before=await this.inspect(),accounts=await this.accounts(),start={chain:this.chainEvents.length,accounts:this.accountEvents.length};
   if(before.correct){await this.verifyTarget();return {kind:'already-selected'};}
   try{await this.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:BOT_CHAIN_HEX}]});}
   catch(e){
    const code=errorCode(e);
    if(code===4902){
     if((await this.inspect()).chainId!==before.chainId)throw failure('NETWORK_SWITCH_UNCERTAIN');
     if(this.chainEvents.slice(start.chain).length)throw failure('NETWORK_CHAIN_CHANGED');
     if(this.accountEvents.slice(start.accounts).some(value=>{try{return !equal(accountList(value),accounts);}catch{return true;}}))throw failure('NETWORK_ACCOUNT_CHANGED');
     this.canAdd=true;return {kind:'unknown-chain'};
    }
    if(code===4001)throw failure('NETWORK_SWITCH_REJECTED');
    if(code===-32002)throw failure('NETWORK_REQUEST_PENDING');
    if(code===4200||code===-32601)throw failure('NETWORK_SWITCH_UNSUPPORTED');
    throw failure('NETWORK_SWITCH_UNCERTAIN');
   }
   this.checkEvents(start,accounts);
   await this.verifyTarget();
   if(!equal(await this.accounts(),accounts))throw failure('NETWORK_ACCOUNT_CHANGED');
   this.checkEvents(start,accounts);
   return {kind:'switched'};
  }finally{this.busy=false;}
 }
 async add(){
  if(this.busy)throw failure('NETWORK_REQUEST_PENDING');
  if(!this.canAdd)throw failure('NETWORK_ADD_NOT_OFFERED');
  this.busy=true;this.canAdd=false;
  try{
   const before=await this.inspect(),accounts=await this.accounts(),start={chain:this.chainEvents.length,accounts:this.accountEvents.length};
   if(before.correct)throw failure('NETWORK_ALREADY_SELECTED');
   try{await this.provider.request({method:'wallet_addEthereumChain',params:[{
    chainId:BOT_ADD_PARAMS.chainId,chainName:BOT_ADD_PARAMS.chainName,rpcUrls:[...BOT_ADD_PARAMS.rpcUrls],
    nativeCurrency:{...BOT_ADD_PARAMS.nativeCurrency},blockExplorerUrls:[...BOT_ADD_PARAMS.blockExplorerUrls]
   }]});}
   catch(e){
    const code=errorCode(e);
    if(code===4001)throw failure('NETWORK_ADD_REJECTED');
    if(code===-32002)throw failure('NETWORK_REQUEST_PENDING');
    if(code===4200||code===-32601)throw failure('NETWORK_ADD_UNSUPPORTED');
    throw failure('NETWORK_ADD_UNCERTAIN');
   }
   if(this.accountEvents.slice(start.accounts).some(value=>{try{return !equal(accountList(value),accounts);}catch{return true;}}))throw failure('NETWORK_ACCOUNT_CHANGED');
   const after=await this.inspect();
   if(after.correct){this.checkEvents(start,accounts);await this.verifyTarget();}
   else if(after.chainId!==before.chainId||this.chainEvents.slice(start.chain).length)throw failure('NETWORK_CHAIN_CHANGED');
   if(!equal(await this.accounts(),accounts))throw failure('NETWORK_ACCOUNT_CHANGED');
   return {kind:after.correct?'added-and-selected':'added'};
  }finally{this.busy=false;}
 }
}
