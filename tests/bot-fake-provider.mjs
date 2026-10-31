import {SETTLED_TOPIC,word} from '../public/bot-testnet/chain.mjs';
const h=n=>'0x'+n.toString(16);
export class FakeProvider {
 constructor(assets){this.assets=assets;this.account='0x'+'11'.repeat(20);this.chainId='0x3c8';this.genesis=assets.genesisHash;this.receiver='0x'+'77'.repeat(20);this.receiverDeployed=false;this.receiverBalance=0n;this.paymentReceived=false;this.sent=[];this.transactions=new Map();this.receipts=new Map();this.blocks=new Map();this.handlers=new Map();this.throwAfterSendAt=0;this.rejectAt=0;this.wrongReceiptAt=0;this.hideReceiptCount=0;this.hideReceiptAt=0;this.ownerOverride=null;}
 on(event,handler){this.handlers.set(event,handler);}
 changeChain(value){this.chainId=value;this.handlers.get('chainChanged')?.(value);}
 changeAccount(value){this.account=value;this.handlers.get('accountsChanged')?.([value]);}
 async request({method,params=[]}){
  if(method==='eth_requestAccounts'||method==='eth_accounts')return[this.account];
  if(method==='eth_chainId')return this.chainId;
  if(method==='eth_gasPrice')return'0x4a817c800';
  if(method==='eth_getBalance')return params[0]?.toLowerCase()===this.receiver?(this.receiverDeployed?h(this.receiverBalance):'0x0'):h(10n**19n);
  if(method==='eth_getCode')return params[0]?.toLowerCase()===this.assets.settlement.address?this.assets.settlement.runtime:params[0]?.toLowerCase()===this.receiver&&this.receiverDeployed?this.assets.receiver.runtime:'0x';
  if(method==='eth_getBlockByNumber'){
   if(params[0]==='0x0')return{number:'0x0',hash:this.genesis};
   if(params[0]==='finalized'){const n=100+this.sent.length;return this.blocks.get(h(n))??null;}
   return this.blocks.get(params[0])??null;
  }
  if(method==='eth_call'){
   const tx=params[0],to=tx.to?.toLowerCase(),data=tx.data?.toLowerCase();
   if(to===this.assets.settlement.address){
    if(data==='0xb1c1008c')return'0x'+word(10n**17n);
    if(data==='0x866dc50c')return'0x'+word(968n);
    if(data.startsWith('0x86efd7ea'))return'0x'+word(this.paymentReceived?1n:0n);
    return'0x';
   }
   if(to===this.receiver&&data===this.assets.receiver.ownerSelector)return'0x'+word(this.ownerOverride??this.account);
   return'0x';
  }
  if(method==='eth_estimateGas'){
   const tx=params[0];return !tx.to?'0x3d090':tx.to.toLowerCase()===this.assets.settlement.address?'0x14495':'0x7530';
  }
  if(method==='eth_getTransactionByHash')return this.transactions.get(params[0])??null;
  if(method==='eth_getTransactionReceipt'){
   if(this.hideReceiptAt===this.sent.findIndex(x=>x.hash===params[0])+1)return null;
   if(this.hideReceiptCount>0){this.hideReceiptCount--;return null;}
   const r=this.receipts.get(params[0]);if(!r)return null;
   return this.wrongReceiptAt===this.sent.findIndex(x=>x.hash===params[0])+1?{...r,transactionIndex:'0x1'}:r;
  }
  if(method==='eth_sendTransaction'){
   if(this.rejectAt===this.sent.length+1){const e=Error('fake owner rejection');e.code=4001;throw e;}
   const raw=params[0];if(this.chainId!=='0x3c8')throw Error('fake wrong chain');
   const number=this.sent.length+1,hash='0x'+number.toString(16).padStart(64,'0'),blockNumber=h(100+number),blockHash='0x'+number.toString(16).padStart(2,'0').repeat(32);
   const to=raw.to?.toLowerCase()??null,gasUsed=to===this.assets.settlement.address?'0x14495':to===this.receiver?'0x7530':'0x3d090';
   const tx={hash,chainId:'0x3c8',from:raw.from.toLowerCase(),to,value:raw.value,input:raw.data,gas:raw.gas,gasPrice:raw.gasPrice,blockNumber,blockHash,transactionIndex:'0x0'};
   const receipt={transactionHash:hash,from:raw.from.toLowerCase(),to,status:'0x1',gasUsed,effectiveGasPrice:raw.gasPrice,blockNumber,blockHash,transactionIndex:'0x0',contractAddress:to===null?this.receiver:null,logs:[]};
   if(to===null)this.receiverDeployed=true;
   else if(to===this.assets.settlement.address){
    const words=raw.data.slice(10).match(/.{64}/g);if(words?.length!==5)throw Error('fake bad settlement calldata');
    this.receiverBalance=BigInt(raw.value);this.paymentReceived=true;
    receipt.logs=[{address:to,topics:[SETTLED_TOPIC,'0x'+word(raw.from), '0x'+words[0], '0x'+words[1]],data:'0x'+[words[2],words[3],words[4]].join(''),removed:false,transactionHash:hash,blockHash,blockNumber,transactionIndex:'0x0'}];
   }else if(to===this.receiver)this.receiverBalance=0n;
   this.sent.push({hash,raw});this.transactions.set(hash,tx);this.receipts.set(hash,receipt);
   this.blocks.set(blockNumber,{number:blockNumber,hash:blockHash,timestamp:h(Math.floor(Date.now()/1000))});
   if(this.throwAfterSendAt===number)throw Error('fake response lost after send');
   return hash;
  }
  throw Error('Unexpected fake provider method '+method);
 }
}
