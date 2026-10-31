import {NETWORKS} from './networks.mjs';
import {address,hash,sha256,createInstruction,parseInstruction,exportBundle,units} from './domain.mjs';
import {quantity,data,preparePlan,requireDeployment,verifyReceipt,encodeSettlement,hex,word} from './chain.mjs';

const KEY='settleref.bot.wallet-runner.testnet.v1';
const STAGES=['receiver-deploy','payment','principal-return'];
const PRINCIPAL=10n**16n; // 0.01 tBOT, provisional pilot default.
const TOTAL_FEE_CAP=5n*10n**16n; // 0.05 tBOT across this pilot.
const STEP_FEE_CAP=2n*10n**16n;
const MAX_GAS_PRICE=50n*10n**9n;
const POLLS=8;
const READ_TIMEOUT_MS=12000;
const WALLET_TIMEOUT_MS=120000;
const EXPECTED_SETTLEMENT='0x442aba2e82c90500a3cb48809a447d4495219557';
const EXPECTED_SETTLEMENT_RUNTIME='0x90016721040e0ca89417d92ef06880eedaf558255dffd4f221e8f4aa9e9dbb76';
const EXPECTED_RECEIVER_CREATION='0xa2daee7b93b453a3c912380dbc0f7386ea0c3ab7f18c8edc89fc916aad785605';
const EXPECTED_RECEIVER_RUNTIME='0x1ae00e7db5bf8c4e9ec4462c8b166f3ab11426920e2b31eb46bdc95b88d89fd9';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sameAddress=(a,b)=>address(a)===address(b);
const sameHash=(a,b)=>hash(a)===hash(b);
const asData=v=>data(v).toLowerCase();
const publicHex=v=>typeof v==='string'&&v.length<=4096&&/^0x[0-9a-fA-F]*$/.test(v)?v:null;
const captureRpc=(kind,value)=>{
 if(value===null)return null;
 if(!value||typeof value!=='object')return{malformed:true};
 const fields=kind==='transaction'?['hash','chainId','from','to','value','input','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas','type','nonce','blockNumber','blockHash','transactionIndex']:
  kind==='receipt'?['transactionHash','from','to','status','gasUsed','effectiveGasPrice','type','blockNumber','blockHash','transactionIndex','contractAddress']:
  ['number','hash','timestamp'];
 const out=Object.create(null);for(const key of fields)if(Object.hasOwn(value,key))out[key]=publicHex(value[key]);
 if(kind==='receipt'&&Array.isArray(value.logs))out.logs=value.logs.slice(0,8).map(log=>{
  if(!log||typeof log!=='object')return{malformed:true};
  const item=Object.create(null);for(const key of ['address','data','transactionHash','blockHash','blockNumber','transactionIndex'])if(Object.hasOwn(log,key))item[key]=publicHex(log[key]);
  item.topics=Array.isArray(log.topics)?log.topics.slice(0,8).map(publicHex):null;item.removed=typeof log.removed==='boolean'?log.removed:null;return item;
 });
 return out;
};
const deadline=(promise,ms,code)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{const e=Error(code);e.code=code;reject(e);},ms);})]).finally(()=>clearTimeout(timer));};
const rpcOf=(provider,readTimeoutMs,walletTimeoutMs)=>({request:async(method,params=[])=>{
  // Send invocation must be synchronous with the final wallet-generation check.
  if(method==='eth_sendTransaction')return provider.request({method,params});
  const call=Promise.resolve().then(()=>provider.request({method,params}));
  try{return await deadline(call,method==='eth_requestAccounts'?walletTimeoutMs:readTimeoutMs,'RPC_READ_TIMEOUT');}
  catch(e){if(e?.code==='RPC_READ_TIMEOUT')throw e;const failure=Error('RPC_UNAVAILABLE');failure.code='RPC_UNAVAILABLE';throw failure;}
}});
const fail=code=>{const e=Error(code);e.code=code;throw e;};

export class WalletPilot {
 constructor({provider,storage,assets,withLock,onChange=()=>{},wait=sleep,polls=POLLS,readTimeoutMs=READ_TIMEOUT_MS,walletTimeoutMs=WALLET_TIMEOUT_MS}){
  if(typeof provider?.request!=='function'||typeof provider?.on!=='function'||!storage?.getItem||!storage?.setItem||!storage?.removeItem||!assets||typeof withLock!=='function')fail('RUNNER_DEPENDENCIES_REQUIRED');
  if(!Number.isSafeInteger(readTimeoutMs)||readTimeoutMs<1||!Number.isSafeInteger(walletTimeoutMs)||walletTimeoutMs<1||!Number.isSafeInteger(polls)||polls<1||polls>POLLS)fail('RUNNER_TIMEOUT_CONFIG');
  this.provider=provider;this.rpc=rpcOf(provider,readTimeoutMs,walletTimeoutMs);this.storage=storage;this.assets=assets;this.withLock=withLock;this.onChange=onChange;this.wait=wait;this.polls=polls;this.walletTimeoutMs=walletTimeoutMs;
  this.account=null;this.reviewed=null;this.busy=false;this.invalidated=false;this.generation=0;this.verifiedSession=false;
  this.connectingInitial=false;this.initialAccountsEvent=null;
  provider.on('accountsChanged',accounts=>{
   if(this.connectingInitial&&!this.account&&!this.reviewed&&!this.state&&this.initialAccountsEvent===null){
    this.initialAccountsEvent=accounts;this.emit('Initial wallet authorization received. Checking account and network.');return;
   }
   this.generation++;this.invalidated=true;this.verifiedSession=false;this.emit('Wallet changed. Preserve this run. After wallet prompts settle, reload and reconnect the original account on testnet 968 for read-only revalidation; do not resend.');
  });
  provider.on('chainChanged',()=>{this.generation++;this.invalidated=true;this.verifiedSession=false;this.emit('Wallet changed. Preserve this run. After wallet prompts settle, reload and reconnect the original account on testnet 968 for read-only revalidation; do not resend.');});
 }
 emit(message){this.onChange({message,state:this.snapshot()});}
 snapshot(){return this.state?structuredClone(this.state):null;}
 save(){this.storage.setItem(KEY,JSON.stringify(this.state));this.emit(this.state.message??this.state.phase);}
 load(){const raw=this.storage.getItem(KEY);if(!raw)return null;if(raw.length>1000000)fail('SAVED_RUN_MALFORMED');
  let s;try{s=JSON.parse(raw);}catch{fail('SAVED_RUN_MALFORMED');}
  if(!s||s.schema!=='settleref.bot.wallet-runner.v1'||s.chainId!==968||s.genesisHash!==NETWORKS[968].genesisHash||!/^0x[0-9a-f]{40}$/.test(s.account)||!Number.isInteger(s.stageIndex)||s.stageIndex<0||s.stageIndex>3||!['ready','requesting','hash-known','pending','unknown','rejected','hold','complete'].includes(s.phase)||!Array.isArray(s.receipts)||s.receipts.length!==s.stageIndex||s.receipts.some(r=>!STAGES.includes(r.stage)||!/^0x[0-9a-f]{64}$/.test(r.hash)))fail('SAVED_RUN_MALFORMED');
  if(s.hash!==null&&(!/^0x[0-9a-f]{64}$/.test(s.hash)||!s.intent)||['hash-known','pending'].includes(s.phase)&&!s.hash||s.phase==='requesting'&&s.hash!==null||
     s.phase==='ready'&&(s.hash!==null||s.intent!==null)||s.phase==='complete'&&s.stageIndex!==3||s.stageIndex===3&&s.phase!=='complete'||
     s.stageIndex>0&&!/^0x[0-9a-f]{40}$/.test(s.receiverAddress??'')||s.stageIndex>1&&!s.instruction||
     s.receipts.some((r,i)=>r.stage!==STAGES[i]||!r.intent||r.intent.stage!==STAGES[i]))fail('SAVED_RUN_MALFORMED');
  if(s.checks===undefined)s.checks=[];
  if(!Array.isArray(s.checks)||s.checks.length>24||s.checks.some(c=>!c||typeof c!=='object'||typeof c.at!=='string'||!STAGES.includes(c.stage)))fail('SAVED_CHECKS_MALFORMED');
  this.state=s;this.verifiedSession=false;return this.snapshot();
 }
 async request(method,params=[]){return this.rpc.request(method,params);}
 async context({requestAccess=false}={}){
  const generation=this.generation,stable=()=>{if(this.invalidated||this.generation!==generation)fail('WALLET_CHANGED_HOLD');};
  const initial=requestAccess&&!this.account&&!this.reviewed&&!this.state;
  if(initial){this.connectingInitial=true;this.initialAccountsEvent=null;}
  try{
  stable();
  const accounts=await this.request(requestAccess?'eth_requestAccounts':'eth_accounts');
  stable();
  if(!Array.isArray(accounts)||accounts.length!==1)fail('ONE_CONNECTED_ACCOUNT_REQUIRED');
  const owner=address(accounts[0]);
  const chain=await this.request('eth_chainId');stable();
  if(quantity(chain)!==968n)fail('TESTNET_968_ONLY');
  const genesis=await this.request('eth_getBlockByNumber',['0x0',false]);
  stable();
  if(!genesis||quantity(genesis.number)!==0n||!sameHash(genesis.hash,NETWORKS[968].genesisHash))fail('TESTNET_GENESIS_MISMATCH');
  const ownerCode=await this.request('eth_getCode',[owner,'latest']);stable();
  if(asData(ownerCode)!=='0x')fail('CONTRACT_WALLET_UNSUPPORTED');
  if(initial&&this.initialAccountsEvent!==null){
   const observed=this.initialAccountsEvent;
   if(!Array.isArray(observed)||observed.length!==1)fail('WALLET_CHANGED_HOLD');
   let observedOwner;try{observedOwner=address(observed[0]);}catch{fail('WALLET_CHANGED_HOLD');}
   if(observedOwner!==owner)fail('WALLET_CHANGED_HOLD');
  }
  if(this.account&&owner!==this.account||this.state&&owner!==this.state.account)fail('ACCOUNT_CHANGED_HOLD');
  this.account=owner;return owner;
  }finally{if(initial){this.connectingInitial=false;this.initialAccountsEvent=null;}}
 }
 async connect(){const account=await this.context({requestAccess:true});this.emit('Connected to pinned BOT testnet 968.');return account;}
 config(){return {...NETWORKS[968],contractAddress:this.assets.settlement.address,runtimeHash:this.assets.settlement.runtimeHexSha256,expectedChainSelector:'0x866dc50c',writesEnabled:true};}
 async artifacts(){
  if(this.assets.chainId!==968||!sameHash(this.assets.genesisHash,NETWORKS[968].genesisHash))fail('ARTIFACT_NETWORK_MISMATCH');
  if(!sameAddress(this.assets.settlement.address,EXPECTED_SETTLEMENT)||this.assets.settlement.runtimeHexSha256!==EXPECTED_SETTLEMENT_RUNTIME||this.assets.receiver.creationHexSha256!==EXPECTED_RECEIVER_CREATION||this.assets.receiver.runtimeHexSha256!==EXPECTED_RECEIVER_RUNTIME)fail('ARTIFACT_IDENTITY_MISMATCH');
  if(await sha256(asData(this.assets.settlement.runtime))!==this.assets.settlement.runtimeHexSha256||await sha256(asData(this.assets.receiver.creation))!==this.assets.receiver.creationHexSha256||await sha256(asData(this.assets.receiver.runtime))!==this.assets.receiver.runtimeHexSha256)fail('ARTIFACT_HASH_MISMATCH');
  await requireDeployment(this.rpc,this.config());
 }
 async estimate(tx,gasCap=400000n){
  const estimate=quantity(await this.request('eth_estimateGas',[tx]));
  const gas=estimate*12n/10n+2000n,gasPrice=quantity(await this.request('eth_gasPrice'));
  if(estimate===0n||gas>gasCap||gasPrice===0n||gasPrice>MAX_GAS_PRICE||gas*gasPrice>STEP_FEE_CAP)fail('FEE_OR_GAS_CAP');
  return{gas:hex(gas),gasPrice:hex(gasPrice),maximumFeeWei:(gas*gasPrice).toString()};
 }
 async review(){
  if(this.storage.getItem(KEY))fail('EXISTING_RUN_REQUIRES_RECONCILIATION');
  const account=await this.context();await this.artifacts();
  const first={from:account,data:this.assets.receiver.creation,value:'0x0',chainId:'0x3c8'};
  const estimate=await this.estimate(first);
  const balance=quantity(await this.request('eth_getBalance',[account,'latest']));
  if(balance<PRINCIPAL+TOTAL_FEE_CAP)fail('INSUFFICIENT_TEST_TOKENS_FOR_CAP');
  this.reviewed={account,firstMaximumFeeWei:estimate.maximumFeeWei};
  this.emit('Review the controlled three-step test. Each step needs its own wallet approval.');
  return{account,chainId:968,genesisHash:NETWORKS[968].genesisHash,settlement:this.assets.settlement.address,steps:STAGES,principalWei:PRINCIPAL.toString(),totalFeeCapWei:TOTAL_FEE_CAP.toString(),stepFeeCapWei:STEP_FEE_CAP.toString(),firstGas:estimate.gas,firstGasPrice:estimate.gasPrice,firstMaximumFeeWei:estimate.maximumFeeWei,receiverOwner:account,receiverSourceSha256:this.assets.receiver.sourceSha256};
 }
 async start({reviewConfirmed=false}={}){
  return this.withLock(async()=>{
   if(!reviewConfirmed||!this.reviewed||this.storage.getItem(KEY))fail('EXPLICIT_PLAN_REVIEW_REQUIRED');
   await this.context();if(this.account!==this.reviewed.account)fail('ACCOUNT_CHANGED_HOLD');
   this.state={schema:'settleref.bot.wallet-runner.v1',runId:crypto.randomUUID(),chainId:968,genesisHash:NETWORKS[968].genesisHash,account:this.account,stageIndex:0,phase:'ready',receiverAddress:null,instruction:null,intent:null,hash:null,receipts:[],checks:[],createdAt:new Date().toISOString(),message:'Ready for receiver deployment. Wallet approval required.'};this.save();
   return this.drive();
  });
 }
 async resume(){return this.withLock(async()=>{this.load();if(!this.state)fail('NO_SAVED_RUN');return this.drive();});}
 async newRun({evidenceExportConfirmed=false}={}){return this.withLock(async()=>{
  this.load();if(!this.state||this.state.phase!=='complete'||!evidenceExportConfirmed)fail('COMPLETED_EXPORT_REQUIRED');
  const generation=this.generation;
  await this.context();await this.artifacts();await this.revalidatePast();await this.validateCurrentIntent();
  if(this.invalidated||this.generation!==generation)fail('WALLET_CHANGED_HOLD');
  this.storage.removeItem(KEY);this.state=null;this.reviewed=null;this.verifiedSession=false;
  this.emit('Prior complete run was revalidated and its browser journal cleared after export. Review a new plan before any wallet request.');
  return true;
 });}
 async drive(){
  if(this.busy)fail('RUN_ALREADY_ACTIVE');this.busy=true;
  const generation=this.generation;
  try{
   this.verifiedSession=false;await this.context();await this.artifacts();await this.revalidatePast();
   await this.validateCurrentIntent();
   while(this.state.stageIndex<STAGES.length){
    if(['requesting','unknown','rejected','hold'].includes(this.state.phase))fail('UNCERTAIN_OR_HELD_NO_RESEND');
    if(this.state.phase==='ready')await this.sendStep();
    if(['hash-known','pending'].includes(this.state.phase)){
     const confirmed=await this.checkStep();if(!confirmed)return this.snapshot();
    }
   }
   if(this.invalidated||this.generation!==generation)fail('WALLET_CHANGED_HOLD');
   this.verifiedSession=true;this.state.phase='complete';this.state.message='Controlled test complete. Export the evidence; this is provider-checked testnet evidence only.';this.save();return this.snapshot();
  }catch(e){
   if(this.state&&['RPC_UNAVAILABLE','RPC_READ_TIMEOUT'].includes(e.code)&&this.state.hash&&['hash-known','pending'].includes(this.state.phase)){
    this.state.phase='pending';this.state.message='RPC unavailable while checking the original hash. Resume read-only verification later; no resend.';this.save();
   }else if(this.state&&['RPC_UNAVAILABLE','RPC_READ_TIMEOUT'].includes(e.code)&&this.state.phase==='ready'&&this.state.hash===null&&this.state.intent===null){
    this.state.message='Preflight RPC read unavailable. No wallet request was made for this stage. Resume to repeat checks before any prompt.';this.save();
   }else if(this.state?.phase==='complete'&&!this.verifiedSession){
    this.state.message='Wallet changed during final checks. Saved completion is unverified in this session; reconnect the original account and revalidate. No resend.';this.save();
   }else if(this.state&&!['requesting','unknown','rejected','complete'].includes(this.state.phase)){
    this.state.phase='hold';this.state.message='Stopped: '+(e.code??'PROVIDER_OR_VERIFICATION_ERROR')+'. Keep the original hash; do not resend.';this.save();
   }
   throw e;
  }finally{this.busy=false;}
 }
 async receiverIdentity(){
  const target=address(this.state.receiverAddress),code=asData(await this.request('eth_getCode',[target,'latest']));
  if(await sha256(code)!==this.assets.receiver.runtimeHexSha256)fail('RECEIVER_RUNTIME_MISMATCH');
  const owner=await this.request('eth_call',[{to:target,data:this.assets.receiver.ownerSelector},'latest']);
  if(typeof owner!=='string'||owner.toLowerCase()!=='0x'+word(this.state.account))fail('RECEIVER_OWNER_MISMATCH');
 }
 async receiverChecks(expectedBalance){
  await this.receiverIdentity();const target=address(this.state.receiverAddress);
  if(quantity(await this.request('eth_getBalance',[target,'latest']))!==expectedBalance)fail('RECEIVER_BALANCE_MISMATCH');
 }
 async nextTransaction(){
  const stage=STAGES[this.state.stageIndex],from=this.state.account;
  if(stage==='receiver-deploy'){
   const tx={from,data:this.assets.receiver.creation,value:'0x0',chainId:'0x3c8'};
   return{stage,tx:{...tx,...await this.estimate(tx)}};
  }
  if(stage==='payment'){
   await this.receiverChecks(0n);
   this.state.instruction??=createInstruction(968,from,this.state.receiverAddress);
   const i=parseInstruction(this.state.instruction);
   if(i.payer!==from||i.beneficiary!==this.state.receiverAddress||units(i.amount)!==PRINCIPAL)fail('INSTRUCTION_STATE_MISMATCH');
   this.save();
   const plan=await preparePlan(this.rpc,this.config(),i,{account:from,walletChainId:968});
   if(quantity(plan.transaction.gasPrice)>MAX_GAS_PRICE)fail('FEE_OR_GAS_CAP');
   return{stage,tx:plan.transaction};
  }
  await this.receiverChecks(PRINCIPAL);
  const tx={from,to:this.state.receiverAddress,value:'0x0',data:this.assets.receiver.withdrawSelector,chainId:'0x3c8'};
  return{stage,tx:{...tx,...await this.estimate(tx,100000n)}};
 }
 async sendStep(){
  await this.context();
  const {stage,tx}=await this.nextTransaction(),fee=quantity(tx.gas)*quantity(tx.gasPrice);
  const reserved=this.state.receipts.reduce((n,r)=>n+BigInt(r.maximumFeeWei),0n);
  if(fee>STEP_FEE_CAP||reserved+fee>TOTAL_FEE_CAP)fail('TOTAL_FEE_CAP');
  if(quantity(await this.request('eth_getBalance',[this.state.account,'latest']))<fee+(stage==='payment'?PRINCIPAL:0n))fail('INSUFFICIENT_TEST_TOKENS');
  await this.context();
  const generation=this.generation;
  this.state.intent={stage,from:this.state.account,to:tx.to??null,value:tx.value,data:tx.data,gas:tx.gas,gasPrice:tx.gasPrice,chainId:'0x3c8',maximumFeeWei:fee.toString()};
  this.state.hash=null;this.state.phase='requesting';this.state.message='Approve '+stage+' in your wallet. No blanket signing is requested.';this.save();
  try{await this.validateCurrentIntent();if(this.invalidated||this.generation!==generation)fail('WALLET_CHANGED_HOLD');}
  catch(e){this.state.phase='hold';this.state.message='Stopped before wallet request: '+(e.code??'INTENT_VALIDATION_ERROR')+'. No transaction was sent.';this.save();throw e;}
  const walletTx={from:tx.from,value:tx.value,data:tx.data,gas:tx.gas,gasPrice:tx.gasPrice,chainId:'0x3c8'};if(tx.to)walletTx.to=tx.to;
  const walletCall=this.request('eth_sendTransaction',[walletTx]),runId=this.state.runId,stageIndex=this.state.stageIndex;
  let returned;
  try{returned=await deadline(walletCall,this.walletTimeoutMs,'WALLET_RESPONSE_TIMEOUT');}
  catch(e){this.state.phase=e?.code===4001?'rejected':'unknown';this.state.message=e?.code===4001?(stage==='principal-return'?'Owner withdrawal was rejected. The principal may remain in the receiver; see manual recovery steps. No automatic retry.':'Wallet rejected the request. No automatic retry.'):e?.code==='WALLET_RESPONSE_TIMEOUT'?'Wallet prompt timed out locally; it may still be active. Outcome unknown. Do not resend; wait for its original hash or inspect wallet history.':'Wallet response was lost or failed. Outcome unknown; inspect wallet history. No resend.';this.save();
   if(e?.code==='WALLET_RESPONSE_TIMEOUT')walletCall.then(value=>{try{if(this.state?.runId===runId&&this.state.stageIndex===stageIndex&&this.state.phase==='unknown'&&this.state.hash===null){this.state.hash=hash(value);this.state.phase='hash-known';this.state.message='Late original wallet hash received. Resume read-only verification; no resend.';this.save();}}catch{}}).catch(()=>{});
   return;}
  try{this.state.hash=hash(returned);this.state.phase='hash-known';this.state.message='Original transaction hash retained. Checking receipt and finality.';this.save();}
  catch{this.state.phase='unknown';this.state.message='Wallet returned no valid hash. Outcome unknown; do not resend.';this.save();}
 }
 async checkStep(){
  if(!this.state.hash)fail('NO_HASH_NO_RESEND');
  await this.context();
  for(let attempt=0;attempt<this.polls;attempt++){
   const result=await this.verifyCurrent();
   if(result){
    this.state.receipts.push(result);this.state.stageIndex++;this.state.phase=this.state.stageIndex===STAGES.length?'complete':'ready';this.state.intent=null;this.state.hash=null;
    this.state.message=this.state.phase==='complete'?'Controlled test complete. Export the evidence.':'Step finalized. Next step requires a separate wallet approval.';this.save();return true;
   }
   if(attempt+1<this.polls)await this.wait(2000);
  }
  this.state.phase='pending';this.state.message='Still pending or not finalized. Original hash retained. Resume read-only checking later; no resend.';this.save();return false;
 }
 async verifyCurrent(){
  const observation={at:new Date().toISOString(),stage:STAGES[this.state.stageIndex],hash:this.state.hash,outcome:'pending',responses:Object.create(null)};
  try{
  const intent=this.state.intent,h=this.state.hash,tx=await this.request('eth_getTransactionByHash',[h]);
  observation.responses.transaction=captureRpc('transaction',tx);
  const receipt=await this.request('eth_getTransactionReceipt',[h]);
  observation.responses.receipt=captureRpc('receipt',receipt);
  if(!tx&&receipt)fail('RECEIPT_WITHOUT_TRANSACTION');if(!tx)return null;
  const toMatches=intent.to===null?tx.to===null:sameAddress(tx.to,intent.to);
  if(tx.type&&tx.type!=='0x0'||tx.maxFeePerGas!=null||tx.maxPriorityFeePerGas!=null||receipt?.type&&receipt.type!=='0x0')fail('UNSUPPORTED_WALLET_FEE_ENVELOPE');
  if(!sameHash(tx.hash,h)||quantity(tx.chainId)!==968n||!sameAddress(tx.from,intent.from)||!toMatches||quantity(tx.value)!==quantity(intent.value)||asData(tx.input)!==asData(intent.data)||quantity(tx.gas)>quantity(intent.gas)||quantity(tx.gasPrice)>quantity(intent.gasPrice))fail('TRANSACTION_INTENT_MISMATCH');
  if(!receipt)return null;
  const receiptToMatches=intent.to===null?receipt.to===null:sameAddress(receipt.to,intent.to);
  if(!sameHash(receipt.transactionHash,h)||!sameAddress(receipt.from,intent.from)||!receiptToMatches||receipt.status!=='0x1'||quantity(receipt.gasUsed)===0n||quantity(receipt.gasUsed)>quantity(intent.gas)||quantity(receipt.effectiveGasPrice)>quantity(intent.gasPrice)||quantity(receipt.blockNumber)!==quantity(tx.blockNumber)||!sameHash(receipt.blockHash,tx.blockHash)||quantity(receipt.transactionIndex)!==quantity(tx.transactionIndex))fail('RECEIPT_INTENT_MISMATCH');
  const block=await this.request('eth_getBlockByNumber',[receipt.blockNumber,false]),final=await this.request('eth_getBlockByNumber',['finalized',false]);
  observation.responses.inclusionBlock=captureRpc('block',block);observation.responses.finalizedHead=captureRpc('block',final);
  if(!block||!final)return null;
  if(!sameHash(block.hash,receipt.blockHash)||quantity(block.number)!==quantity(receipt.blockNumber))fail('FINALITY_NOT_CANONICAL');
  if(quantity(final.number)<quantity(receipt.blockNumber))return null;
  const canonicalFinal=await this.request('eth_getBlockByNumber',[final.number,false]),again=await this.request('eth_getBlockByNumber',[receipt.blockNumber,false]);
  observation.responses.canonicalFinal=captureRpc('block',canonicalFinal);observation.responses.inclusionBlockAgain=captureRpc('block',again);
  if(!canonicalFinal||!again||!sameHash(canonicalFinal.hash,final.hash)||!sameHash(again.hash,receipt.blockHash))fail('FINALITY_NOT_CANONICAL');
  const stage=STAGES[this.state.stageIndex];
  if(stage==='receiver-deploy'){
   if(!receipt.contractAddress)fail('DEPLOYMENT_ADDRESS_MISSING');this.state.receiverAddress=address(receipt.contractAddress);
   await this.receiverChecks(0n);
  }else if(stage==='payment'){
   await verifyReceipt(this.rpc,this.config(),exportBundle(this.state.instruction,h));
   await this.receiverChecks(PRINCIPAL);
  }else await this.receiverChecks(0n);
  const fee=quantity(receipt.gasUsed)*quantity(receipt.effectiveGasPrice);
  observation.outcome='verified';
  return{stage,hash:h,blockHash:hash(receipt.blockHash),blockNumber:quantity(receipt.blockNumber).toString(),gasUsed:quantity(receipt.gasUsed).toString(),actualFeeWei:fee.toString(),maximumFeeWei:intent.maximumFeeWei,intent:structuredClone(intent),verifiedAt:new Date().toISOString(),contractAddress:stage==='receiver-deploy'?this.state.receiverAddress:undefined};
  }catch(e){observation.outcome='error';observation.reason=typeof e?.code==='string'&&/^[A-Z_]{4,70}$/.test(e.code)?e.code:'VERIFICATION_ERROR';throw e;}
  finally{observation.finishedAt=new Date().toISOString();this.recordObservation(observation);}
 }
 recordObservation(entry){
  const serialized=JSON.stringify(entry);
  if(serialized.length>12000)entry.responses={truncated:true};
  this.state.checks??=[];this.state.checks.push(entry);
  if(this.state.checks.length>24)this.state.checks.splice(0,this.state.checks.length-24);
  this.save();
 }
 async revalidatePast(){
  for(let index=0;index<this.state.receipts.length;index++){
   const saved=this.state.receipts[index],intent=saved.intent;
   if(saved.stage!==STAGES[index]||!intent||intent.stage!==saved.stage||intent.from!==this.state.account||intent.chainId!=='0x3c8'||!/^0x[0-9a-f]{64}$/.test(saved.hash))fail('SAVED_EVIDENCE_MALFORMED');
   await this.validateStageIntent(index,intent);
   if(saved.maximumFeeWei!==intent.maximumFeeWei)fail('SAVED_FEE_CAP_MISMATCH');
   const tx=await this.request('eth_getTransactionByHash',[saved.hash]),receipt=await this.request('eth_getTransactionReceipt',[saved.hash]);
   if(!tx||!receipt)fail('PRIOR_RECEIPT_UNAVAILABLE_HOLD');
   if(tx.type&&tx.type!=='0x0'||tx.maxFeePerGas!=null||tx.maxPriorityFeePerGas!=null||receipt.type&&receipt.type!=='0x0')fail('UNSUPPORTED_WALLET_FEE_ENVELOPE');
   if(!sameHash(tx.hash,saved.hash)||quantity(tx.chainId)!==968n||!sameAddress(tx.from,intent.from)||
      !(intent.to===null?tx.to===null:sameAddress(tx.to,intent.to))||quantity(tx.value)!==quantity(intent.value)||asData(tx.input)!==asData(intent.data)||
      quantity(tx.gas)>quantity(intent.gas)||quantity(tx.gasPrice)>quantity(intent.gasPrice)||
      !sameHash(receipt.transactionHash,saved.hash)||!sameAddress(receipt.from,intent.from)||
      !(intent.to===null?receipt.to===null:sameAddress(receipt.to,intent.to))||receipt.status!=='0x1'||
      quantity(receipt.gasUsed)===0n||quantity(receipt.gasUsed)>quantity(intent.gas)||quantity(receipt.effectiveGasPrice)>quantity(intent.gasPrice)||
      quantity(receipt.blockNumber)!==quantity(tx.blockNumber)||!sameHash(receipt.blockHash,tx.blockHash)||quantity(receipt.transactionIndex)!==quantity(tx.transactionIndex)||
      !sameHash(receipt.blockHash,saved.blockHash)||quantity(receipt.blockNumber)!==BigInt(saved.blockNumber))fail('PRIOR_RECEIPT_INTENT_MISMATCH');
   if(saved.actualFeeWei!==(quantity(receipt.gasUsed)*quantity(receipt.effectiveGasPrice)).toString()||saved.gasUsed!==quantity(receipt.gasUsed).toString())fail('PRIOR_FEE_EVIDENCE_MISMATCH');
   const block=await this.request('eth_getBlockByNumber',[receipt.blockNumber,false]),final=await this.request('eth_getBlockByNumber',['finalized',false]);
   if(!block||!final||!sameHash(block.hash,receipt.blockHash)||quantity(final.number)<quantity(receipt.blockNumber))fail('PRIOR_FINALITY_UNAVAILABLE_HOLD');
   const canonical=await this.request('eth_getBlockByNumber',[final.number,false]);
   if(!canonical||!sameHash(canonical.hash,final.hash))fail('PRIOR_FINALITY_MISMATCH');
   if(saved.stage==='receiver-deploy'){
    if(!receipt.contractAddress||!sameAddress(receipt.contractAddress,this.state.receiverAddress))fail('PRIOR_RECEIVER_MISMATCH');
   }else if(saved.stage==='payment')await verifyReceipt(this.rpc,this.config(),exportBundle(this.state.instruction,saved.hash));
  }
  if(this.state.stageIndex>0)await this.receiverIdentity();
  if(this.state.stageIndex===STAGES.length)await this.receiverChecks(0n);
  if(this.state.receipts.reduce((sum,r)=>sum+BigInt(r.maximumFeeWei),0n)>TOTAL_FEE_CAP)fail('SAVED_TOTAL_FEE_CAP_MISMATCH');
 }
 async validateStageIntent(index,intent){
  if(!intent||typeof intent!=='object'||Array.isArray(intent)||intent.stage!==STAGES[index]||intent.from!==this.state.account||intent.chainId!=='0x3c8')fail('SAVED_STAGE_INTENT_MISMATCH');
  if(index===1){let instruction;try{instruction=parseInstruction(this.state.instruction);}catch{fail('SAVED_INSTRUCTION_MISMATCH');}
   if(instruction.payer!==this.state.account||instruction.beneficiary!==this.state.receiverAddress||units(instruction.amount)!==PRINCIPAL)fail('SAVED_INSTRUCTION_MISMATCH');}
  if(index===0&&(intent.to!==null||quantity(intent.value)!==0n||asData(intent.data)!==asData(this.assets.receiver.creation))||
     index===1&&(!sameAddress(intent.to,this.assets.settlement.address)||quantity(intent.value)!==PRINCIPAL||asData(intent.data)!==await encodeSettlement(this.state.instruction))||
     index===2&&(!sameAddress(intent.to,this.state.receiverAddress)||quantity(intent.value)!==0n||asData(intent.data)!==asData(this.assets.receiver.withdrawSelector)))fail('SAVED_STAGE_INTENT_MISMATCH');
  const gas=quantity(intent.gas),price=quantity(intent.gasPrice),maximum=gas*price;
  if(gas===0n||price===0n||price>MAX_GAS_PRICE||maximum>STEP_FEE_CAP||intent.maximumFeeWei!==maximum.toString()||gas>(index===0?400000n:index===1?150000n:100000n))fail('SAVED_FEE_CAP_MISMATCH');
  return maximum;
 }
 async validateCurrentIntent(){
  const s=this.state;if(s.stageIndex===STAGES.length){if(s.intent!==null||s.hash!==null)fail('SAVED_RUN_MALFORMED');return;}
  if(s.intent===null){if(s.phase==='ready'||s.phase==='hold'&&s.hash===null)return;fail('CURRENT_INTENT_MISSING');}
  const maximum=await this.validateStageIntent(s.stageIndex,s.intent);
  const prior=s.receipts.reduce((sum,r)=>sum+BigInt(r.maximumFeeWei),0n);
  if(prior+maximum>TOTAL_FEE_CAP)fail('SAVED_TOTAL_FEE_CAP_MISMATCH');
 }
 report(){
  const run=this.snapshot(),actualFeeWei=run?.receipts.reduce((sum,r)=>sum+BigInt(r.actualFeeWei),0n)??0n;
  const verified=!!(run?.phase==='complete'&&this.verifiedSession&&!this.invalidated);
  return{schema:'settleref.bot.wallet-runner.report.v1',mode:verified?'provider-checked BOT testnet; not independent consensus':'saved browser data not revalidated in the current wallet context',run,
   totals:{actualFeeWei:actualFeeWei.toString(),principalWei:PRINCIPAL.toString(),principalReturnVerified:verified},
   source:{settlementRuntimeHexSha256:EXPECTED_SETTLEMENT_RUNTIME,receiverCreationHexSha256:EXPECTED_RECEIVER_CREATION,receiverRuntimeHexSha256:EXPECTED_RECEIVER_RUNTIME},
   liveWalletIntegrationQualified:false,mainnetAuthorized:false,signaturesByAgent:0};
 }
}
