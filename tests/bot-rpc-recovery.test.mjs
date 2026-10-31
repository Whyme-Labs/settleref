import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WalletPilot,eligibleRpcDataHold} from '../public/bot-testnet/runner-core.mjs';
import {FakeProvider} from './bot-fake-provider.mjs';
const assets=JSON.parse(await readFile(new URL('../public/bot-testnet/assets.json',import.meta.url)));

const key='settleref.bot.wallet-runner.testnet.v1';
const storage=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
function setup(){const provider=new FakeProvider(assets),store=storage();return {provider,store,pilot:new WalletPilot({provider,storage:store,assets,withLock:f=>f(),wait:async()=>{},polls:2})};}
// Synthetic fixture only: no owner wallet export, invoice, address or transaction is published.
async function incompletePaymentFixture(){
 const x=setup();x.provider.hideReceiptAt=2;
 await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
 const run=structuredClone(x.pilot.state),tx=structuredClone(x.provider.transactions.get(run.hash)),receipt=structuredClone(x.provider.receipts.get(run.hash));
 delete tx.chainId;Object.assign(tx,{type:'0x2',maxFeePerGas:tx.gasPrice,maxPriorityFeePerGas:tx.gasPrice,blockNumber:null,blockHash:null,transactionIndex:null});receipt.type='0x2';
 run.phase='hold';run.checks=[{stage:'payment',hash:run.hash,outcome:'error',reason:'VERIFICATION_ERROR',responses:{transaction:tx,receipt}}];
 return {run};
}
const exported=await incompletePaymentFixture();
async function fixture(changes={}){
 const pilot=Object.create(WalletPilot.prototype);pilot.state=structuredClone(exported.run);
 const responses=structuredClone(pilot.state.checks.at(-1).responses);Object.assign(responses.transaction,changes);
 const calls=[];pilot.request=async method=>{calls.push(method);if(method==='eth_getTransactionByHash')return responses.transaction;if(method==='eth_getTransactionReceipt')return responses.receipt;throw Error('Unexpected method '+method);};
 pilot.recordObservation=e=>pilot.observation=e;
 return {pilot,calls};
}
test('synthetic R3-shaped response stays typed pending, preserving original hash and identity',async()=>{
 const {pilot,calls}=await fixture();assert.equal(await pilot.verifyCurrent(),null);
 assert.equal(pilot.observation.reason,'RPC_TRANSACTION_DATA_INCOMPLETE');assert.equal(pilot.observation.outcome,'pending');
 assert.deepEqual(pilot.observation.missingFields,['chainId','blockNumber','blockHash','transactionIndex']);
 assert.equal(pilot.state.hash,exported.run.hash);assert.deepEqual(pilot.state.instruction,exported.run.instruction);
 assert.deepEqual(calls,['eth_getTransactionByHash','eth_getTransactionReceipt']);
});
for(const [name,changes,reason] of [
 ['wrong chain',{chainId:'0x1'},'TRANSACTION_INTENT_MISMATCH'],
 ['wrong sender',{from:'0x'+'22'.repeat(20)},'TRANSACTION_INTENT_MISMATCH'],
 ['wrong amount',{value:'0x1'},'TRANSACTION_INTENT_MISMATCH'],
 ['wrong calldata',{input:'0x1234'},'TRANSACTION_INTENT_MISMATCH'],
 ['wrong populated block',{blockNumber:'0x1'},'RECEIPT_INTENT_MISMATCH'],
 ['wrong populated block hash',{blockHash:'0x'+'11'.repeat(32)},'RECEIPT_INTENT_MISMATCH'],
 ['wrong populated index',{transactionIndex:'0x1'},'RECEIPT_INTENT_MISMATCH'],
 ['excessive signed fee',{maxFeePerGas:'0xffffffffff'},'WALLET_FEE_CAP_EXCEEDED']]){
 test(name+' is hard failure even with other metadata missing',async()=>{const {pilot}=await fixture(changes);await assert.rejects(pilot.verifyCurrent(),new RegExp(reason));assert.equal(pilot.observation.outcome,'error');});
}
test('only precise old incomplete-data hold is eligible, not arbitrary verification errors',()=>{
 assert.equal(eligibleRpcDataHold(exported.run),true);
 for(const mutate of [s=>s.hash=null,s=>s.phase='unknown',s=>s.checks.at(-1).reason='TRANSACTION_INTENT_MISMATCH',s=>s.checks.at(-1).responses.transaction.hash='0x'+'11'.repeat(32),s=>Object.assign(s.checks.at(-1).responses.transaction,{chainId:'0x3c8',blockNumber:'0x1',blockHash:'0x'+'11'.repeat(32),transactionIndex:'0x0'})]){const state=structuredClone(exported.run);mutate(state);assert.equal(eligibleRpcDataHold(state),false);}
});
test('bounded incomplete polling and recovery never resend or auto request owner return',async()=>{
 const x=setup(),original=x.provider.request.bind(x.provider);let incomplete=true,paymentReads=0;
 x.provider.request=async args=>{const value=await original(args);if(args.method==='eth_getTransactionByHash'&&value?.to===assets.settlement.address){paymentReads++;if(incomplete){const v={...value,blockNumber:null,blockHash:null,transactionIndex:null};delete v.chainId;return v;}}return value;};
 await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
 assert.equal(x.pilot.state.phase,'pending');assert.equal(x.provider.sent.length,2);assert.equal(paymentReads,2);
 const h=x.pilot.state.hash,id=structuredClone(x.pilot.state.instruction);
 // Model the precise historical R3 journal, not a production journal edit.
 const saved=JSON.parse(x.store.getItem(key));saved.phase='hold';saved.checks.at(-1).outcome='error';saved.checks.at(-1).reason='VERIFICATION_ERROR';x.store.setItem(key,JSON.stringify(saved));
 await x.pilot.reconcileFeeHold();
 assert.equal(x.pilot.state.phase,'pending');assert.equal(x.provider.sent.length,2);assert.equal(x.pilot.canReconcileFeeHold(),true);
 incomplete=false;
 await x.pilot.reconcileFeeHold();
 assert.equal(x.pilot.state.stageIndex,2);assert.equal(x.pilot.state.phase,'ready');assert.equal(x.provider.sent.length,2);
 assert.equal(x.pilot.state.receipts.at(-1).hash,h);assert.deepEqual(x.pilot.state.instruction,id);assert.equal(x.provider.receiverBalance,10n**16n);
});
test('wallet change during recovered verification still blocks acceptance and any next request',async()=>{
 const x=setup(),orig=x.provider.request.bind(x.provider);let incomplete=true;
 x.provider.request=async args=>{const value=await orig(args);if(args.method==='eth_getTransactionByHash'&&value?.to===assets.settlement.address&&incomplete){const v={...value};delete v.chainId;return v;}return value;};
 await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
 const saved=JSON.parse(x.store.getItem(key));saved.phase='hold';saved.checks.at(-1).outcome='error';saved.checks.at(-1).reason='VERIFICATION_ERROR';x.store.setItem(key,JSON.stringify(saved));incomplete=false;
 x.provider.ownerOverride=x.provider.account;let fired=false;x.provider.request=async args=>{const v=await orig(args);if(args.method==='eth_getTransactionReceipt'&&args.params[0]===saved.hash&&!fired){fired=true;x.provider.changeAccount('0x'+'22'.repeat(20));}return v;};
 await assert.rejects(x.pilot.reconcileFeeHold(),/WALLET_CHANGED_HOLD/);assert.equal(x.provider.sent.length,2);assert.equal(x.pilot.state.stageIndex,1);
});

test('dedicated recovery remains read-only when metadata converges before finality',async()=>{
 const x=setup(),orig=x.provider.request.bind(x.provider);let incomplete=true,hideFinal=false,paymentScope=false;
 x.provider.request=async args=>{const v=await orig(args);if(args.method==='eth_getTransactionByHash')paymentScope=v?.to===assets.settlement.address;if(args.method==='eth_getBlockByNumber'&&args.params[0]==='finalized'&&hideFinal&&paymentScope)return null;if(args.method==='eth_getTransactionByHash'&&v?.to===assets.settlement.address&&incomplete){const tx={...v};delete tx.chainId;return tx;}return v;};
 await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
 incomplete=false;hideFinal=true;await x.pilot.reconcileFeeHold();
 assert.equal(x.pilot.state.phase,'pending');assert.equal(x.pilot.canReconcileFeeHold(),true);assert.equal(x.provider.sent.length,2);
 hideFinal=false;await x.pilot.reconcileFeeHold();assert.equal(x.pilot.state.phase,'ready');assert.equal(x.pilot.state.stageIndex,2);assert.equal(x.provider.sent.length,2);
});
