import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WalletPilot} from '../public/bot-testnet/runner-core.mjs';
import {FakeProvider} from './bot-fake-provider.mjs';
const assets=JSON.parse(await readFile(new URL('../public/bot-testnet/assets.json',import.meta.url),'utf8'));
const storage=()=>{const items=new Map();return{getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,value),removeItem:key=>items.delete(key)};};
const noWait=async()=>{};
const lock=async fn=>fn();
const setup=({provider=new FakeProvider(assets),store=storage(),polls=2,readTimeoutMs=12000,walletTimeoutMs=120000}={})=>({provider,store,pilot:new WalletPilot({provider,storage:store,assets,withLock:lock,wait:noWait,polls,readTimeoutMs,walletTimeoutMs})});

test('three separately requested fake wallet transactions complete deploy, payment and owner return',async()=>{
 const x=setup();await x.pilot.connect();const review=await x.pilot.review();
 assert.equal(review.chainId,968);assert.equal(review.receiverOwner,x.provider.account);assert.equal(review.principalWei,'10000000000000000');
 const done=await x.pilot.start({reviewConfirmed:true});
 assert.equal(done.phase,'complete');assert.equal(done.receipts.length,3);assert.equal(x.provider.sent.length,3);
 assert.deepEqual(done.receipts.map(r=>r.stage),['receiver-deploy','payment','principal-return']);
 assert.equal(done.receiverAddress,x.provider.receiver);assert.equal(x.provider.receiverBalance,0n);
 assert.equal(x.pilot.report().mainnetAuthorized,false);assert.equal(x.pilot.report().signaturesByAgent,0);
});

test('explicit plan review is mandatory; wrong chain, genesis and account stop before wallet send',async()=>{
 const x=setup();await x.pilot.connect();await x.pilot.review();
 await assert.rejects(x.pilot.start(),/EXPLICIT_PLAN_REVIEW_REQUIRED/);assert.equal(x.provider.sent.length,0);
 const wrong=setup();wrong.provider.chainId='0x2a5';await assert.rejects(wrong.pilot.connect(),/TESTNET_968_ONLY/);assert.equal(wrong.provider.sent.length,0);
 const genesis=setup();genesis.provider.genesis='0x'+'ff'.repeat(32);await assert.rejects(genesis.pilot.connect(),/TESTNET_GENESIS_MISMATCH/);assert.equal(genesis.provider.sent.length,0);
 const switched=setup();await switched.pilot.connect();await switched.pilot.review();switched.provider.changeAccount('0x'+'22'.repeat(20));
 await assert.rejects(switched.pilot.start({reviewConfirmed:true}),/WALLET_CHANGED_HOLD/);assert.equal(switched.provider.sent.length,0);
});

test('lost wallet response after a fake send remains unknown with no automatic resend on restart',async()=>{
 const x=setup();x.provider.throwAfterSendAt=1;await x.pilot.connect();await x.pilot.review();
 await assert.rejects(x.pilot.start({reviewConfirmed:true}),/UNCERTAIN_OR_HELD_NO_RESEND/);
 assert.equal(x.provider.sent.length,1);assert.equal(x.pilot.snapshot().phase,'unknown');assert.equal(x.pilot.snapshot().hash,null);
 const restarted=setup({provider:x.provider,store:x.store});await restarted.pilot.connect();
 await assert.rejects(restarted.pilot.resume(),/UNCERTAIN_OR_HELD_NO_RESEND/);assert.equal(x.provider.sent.length,1);
});

test('known pending hash resumes read-only and proceeds without repeating the first fake transaction',async()=>{
 const x=setup({polls:1});x.provider.hideReceiptCount=1;await x.pilot.connect();await x.pilot.review();
 const pending=await x.pilot.start({reviewConfirmed:true});assert.equal(pending.phase,'pending');assert.equal(x.provider.sent.length,1);assert.ok(pending.hash);
 const restarted=setup({provider:x.provider,store:x.store});await restarted.pilot.connect();const done=await restarted.pilot.resume();
 assert.equal(done.phase,'complete');assert.equal(x.provider.sent.length,3);
 assert.equal(done.receipts[0].hash,pending.hash);
});

test('mismatching receipt stops before principal return and retains original hash',async()=>{
 const x=setup();x.provider.wrongReceiptAt=2;await x.pilot.connect();await x.pilot.review();
 await assert.rejects(x.pilot.start({reviewConfirmed:true}),/RECEIPT_INTENT_MISMATCH/);
 const held=x.pilot.snapshot();assert.equal(held.phase,'hold');assert.equal(held.stageIndex,1);assert.equal(x.provider.sent.length,2);assert.ok(held.hash);
 assert.equal(held.checks.at(-1).outcome,'error');assert.equal(held.checks.at(-1).reason,'RECEIPT_INTENT_MISMATCH');
 assert.equal(held.checks.at(-1).responses.transaction.transactionIndex,'0x0');assert.equal(held.checks.at(-1).responses.receipt.transactionIndex,'0x1');
 const restarted=setup({provider:x.provider,store:x.store});await restarted.pilot.connect();
 await assert.rejects(restarted.pilot.resume(),/UNCERTAIN_OR_HELD_NO_RESEND/);assert.equal(x.provider.sent.length,2);
});

test('receiver owner mismatch halts after deployment, before payment',async()=>{
 const x=setup();x.provider.ownerOverride='0x'+'22'.repeat(20);await x.pilot.connect();await x.pilot.review();
 await assert.rejects(x.pilot.start({reviewConfirmed:true}),/RECEIVER_OWNER_MISMATCH/);assert.equal(x.provider.sent.length,1);
});

test('restart rechecks prior finalized evidence before any new wallet prompt',async()=>{
 const x=setup({polls:1});x.provider.hideReceiptAt=2;await x.pilot.connect();await x.pilot.review();
 const pending=await x.pilot.start({reviewConfirmed:true});assert.equal(pending.phase,'pending');assert.equal(x.provider.sent.length,2);
 x.provider.hideReceiptAt=0;
 const first=x.provider.sent[0].hash,receipt=x.provider.receipts.get(first);
 x.provider.receipts.set(first,{...receipt,transactionIndex:'0x1'});
 const restarted=setup({provider:x.provider,store:x.store});await restarted.pilot.connect();
 await assert.rejects(restarted.pilot.resume(),/PRIOR_RECEIPT_INTENT_MISMATCH/);
 assert.equal(x.provider.sent.length,2);assert.equal(restarted.pilot.snapshot().phase,'hold');
});

test('unavailable exclusive browser lock prevents every wallet request',async()=>{
 const x=setup();await x.pilot.connect();await x.pilot.review();
 x.pilot.withLock=async()=>{throw Error('ANOTHER_TAB_ACTIVE');};
 await assert.rejects(x.pilot.start({reviewConfirmed:true}),/ANOTHER_TAB_ACTIVE/);
 assert.equal(x.provider.sent.length,0);
});

test('altered saved fee evidence fails closed before any next wallet prompt',async()=>{
 const x=setup({polls:1});x.provider.hideReceiptAt=2;await x.pilot.connect();await x.pilot.review();
 await x.pilot.start({reviewConfirmed:true});assert.equal(x.provider.sent.length,2);
 const key='settleref.bot.wallet-runner.testnet.v1',saved=JSON.parse(x.store.getItem(key));
 saved.receipts[0].maximumFeeWei='0';x.store.setItem(key,JSON.stringify(saved));x.provider.hideReceiptAt=0;
 const restarted=setup({provider:x.provider,store:x.store});await restarted.pilot.connect();
 await assert.rejects(restarted.pilot.resume(),/SAVED_FEE_CAP_MISMATCH/);
 assert.equal(x.provider.sent.length,2);
});

test('conflicting canonical block hash holds instead of calling it pending',async()=>{
 const x=setup();const request=x.provider.request.bind(x.provider);
 x.provider.request=async args=>args.method==='eth_getBlockByNumber'&&args.params[0]==='0x65'
  ?{number:'0x65',hash:'0x'+'ff'.repeat(32)}:request(args);
 await x.pilot.connect();await x.pilot.review();
 await assert.rejects(x.pilot.start({reviewConfirmed:true}),/FINALITY_NOT_CANONICAL/);
 assert.equal(x.pilot.snapshot().phase,'hold');assert.equal(x.provider.sent.length,1);
});

test('reloaded completion is labelled unverified until read-only receipt revalidation',async()=>{
 const x=setup();await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
 const restarted=setup({provider:x.provider,store:x.store});restarted.pilot.load();
 assert.equal(restarted.pilot.report().totals.principalReturnVerified,false);
 assert.match(restarted.pilot.report().mode,/not revalidated/);
 await restarted.pilot.connect();await restarted.pilot.resume();
 assert.equal(restarted.pilot.report().totals.principalReturnVerified,true);
 assert.equal(x.provider.sent.length,3);
});

test('wallet change after completion revokes exported verification without clearing evidence',async()=>{
 for(const change of [
  provider=>provider.changeAccount('0x'+'22'.repeat(20)),
  provider=>provider.changeChain('0x2a5')
 ]){
  const x=setup();await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
  assert.equal(x.pilot.report().totals.principalReturnVerified,true);
  const saved=x.store.getItem('settleref.bot.wallet-runner.testnet.v1');
  change(x.provider);
  assert.equal(x.pilot.verifiedSession,false);
  assert.equal(x.pilot.report().totals.principalReturnVerified,false);
  assert.match(x.pilot.report().mode,/not revalidated/);
  assert.equal(x.store.getItem('settleref.bot.wallet-runner.testnet.v1'),saved);
  await assert.rejects(x.pilot.newRun({evidenceExportConfirmed:true}),/WALLET_CHANGED_HOLD/);
  assert.equal(x.provider.sent.length,3);
 }
});

test('wallet event ordering requires a fresh page instance before completed-run revalidation',async()=>{
 const x=setup();await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
 const account=x.provider.account, saved=x.store.getItem('settleref.bot.wallet-runner.testnet.v1');
 const eventReports=[];x.pilot.onChange=({message})=>eventReports.push({message,verified:x.pilot.report().totals.principalReturnVerified});
 x.provider.changeAccount('0x'+'22'.repeat(20));x.provider.changeChain('0x2a5');
 x.provider.changeAccount(account);x.provider.changeChain('0x3c8');
 assert.equal(eventReports.length,4);
 assert.ok(eventReports.every(({message,verified})=>!verified&&/reload|do not resend/i.test(message)));
 assert.equal(x.pilot.report().totals.principalReturnVerified,false);
 assert.equal(x.store.getItem('settleref.bot.wallet-runner.testnet.v1'),saved);
 await assert.rejects(x.pilot.resume(),/WALLET_CHANGED_HOLD/);
 const after=JSON.parse(x.store.getItem('settleref.bot.wallet-runner.testnet.v1'));
 const before=JSON.parse(saved);
 assert.equal(after.runId,before.runId);
 assert.equal(after.stageIndex,3);
 assert.deepEqual(after.receipts,before.receipts);
 const fresh=setup({provider:x.provider,store:x.store});fresh.pilot.load();
 assert.equal(fresh.pilot.report().totals.principalReturnVerified,false);
 await fresh.pilot.connect();await fresh.pilot.resume();
 assert.equal(fresh.pilot.report().totals.principalReturnVerified,true);
 assert.equal(x.provider.sent.length,3);
});

test('rewritten completed return intent cannot qualify a different transaction as owner withdrawal',async()=>{
 const x=setup();await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
 const key='settleref.bot.wallet-runner.testnet.v1',saved=JSON.parse(x.store.getItem(key));
 const returned=saved.receipts[2],tx=x.provider.transactions.get(returned.hash);
 returned.intent.data='0x12345678';x.store.setItem(key,JSON.stringify(saved));
 x.provider.transactions.set(returned.hash,{...tx,input:'0x12345678'});
 const restarted=setup({provider:x.provider,store:x.store});restarted.pilot.load();await restarted.pilot.connect();
 await assert.rejects(restarted.pilot.resume(),/SAVED_STAGE_INTENT_MISMATCH/);
 assert.equal(restarted.pilot.report().totals.principalReturnVerified,false);
 assert.equal(x.provider.sent.length,3);
});

test('account event during context or immediately before a prompt blocks sending',async()=>{
 const context=setup();await context.pilot.connect();await context.pilot.review();
 const original=context.provider.request.bind(context.provider);let changed=false;
 context.provider.request=async args=>{if(args.method==='eth_chainId'&&!changed){changed=true;context.provider.changeAccount('0x'+'22'.repeat(20));return '0x3c8';}return original(args);};
 await assert.rejects(context.pilot.start({reviewConfirmed:true}),/WALLET_CHANGED_HOLD/);assert.equal(context.provider.sent.length,0);
 const before=setup();await before.pilot.connect();await before.pilot.review();let fired=false;
 before.pilot.onChange=({state})=>{if(state?.phase==='requesting'&&!fired){fired=true;before.provider.changeChain('0x2a5');}};
 await assert.rejects(before.pilot.start({reviewConfirmed:true}),/WALLET_CHANGED_HOLD/);
 assert.equal(before.provider.sent.length,0);assert.equal(before.pilot.snapshot().phase,'hold');
 const queued=setup();await queued.pilot.connect();await queued.pilot.review();let queuedOnce=false;
 queued.pilot.onChange=({state})=>{if(state?.phase==='requesting'&&!queuedOnce){queuedOnce=true;queueMicrotask(()=>queued.provider.changeAccount('0x'+'33'.repeat(20)));}};
 await assert.rejects(queued.pilot.start({reviewConfirmed:true}),/WALLET_CHANGED_HOLD/);
 assert.equal(queued.provider.sent.length,0);
});

test('one matching initial authorization event is allowed; later account or chain change is blocked',async()=>{
 const first=setup();const initial=first.provider.request.bind(first.provider);
 first.provider.request=async args=>{if(args.method==='eth_requestAccounts'){first.provider.changeAccount(first.provider.account);return [first.provider.account];}return initial(args);};
 assert.equal(await first.pilot.connect(),first.provider.account);await first.pilot.review();
 first.provider.changeAccount('0x'+'22'.repeat(20));
 await assert.rejects(first.pilot.start({reviewConfirmed:true}),/WALLET_CHANGED_HOLD/);assert.equal(first.provider.sent.length,0);
 const chain=setup();const chainRequest=chain.provider.request.bind(chain.provider);
 chain.provider.request=async args=>{if(args.method==='eth_requestAccounts'){chain.provider.changeAccount(chain.provider.account);chain.provider.changeChain('0x2a5');return [chain.provider.account];}return chainRequest(args);};
 await assert.rejects(chain.pilot.connect(),/WALLET_CHANGED_HOLD/);assert.equal(chain.provider.sent.length,0);
 const mismatch=setup();const mismatchRequest=mismatch.provider.request.bind(mismatch.provider),originalAccount=mismatch.provider.account;
 mismatch.provider.request=async args=>{if(args.method==='eth_requestAccounts'){mismatch.provider.changeAccount('0x'+'33'.repeat(20));return [originalAccount];}return mismatchRequest(args);};
 await assert.rejects(mismatch.pilot.connect(),/WALLET_CHANGED_HOLD/);assert.equal(mismatch.provider.sent.length,0);
});

test('rewritten pending withdrawal intent cannot qualify a different matching transaction',async()=>{
 const x=setup({polls:1});x.provider.hideReceiptAt=3;await x.pilot.connect();await x.pilot.review();
 const pending=await x.pilot.start({reviewConfirmed:true});assert.equal(pending.stageIndex,2);assert.equal(pending.phase,'pending');
 const key='settleref.bot.wallet-runner.testnet.v1',saved=JSON.parse(x.store.getItem(key));
 saved.intent.data='0x12345678';x.store.setItem(key,JSON.stringify(saved));
 const tx=x.provider.transactions.get(pending.hash);x.provider.transactions.set(pending.hash,{...tx,input:'0x12345678'});x.provider.hideReceiptAt=0;
 const restarted=setup({provider:x.provider,store:x.store});await restarted.pilot.connect();
 await assert.rejects(restarted.pilot.resume(),/SAVED_STAGE_INTENT_MISMATCH/);
 assert.equal(restarted.pilot.report().totals.principalReturnVerified,false);assert.equal(x.provider.sent.length,3);
});

test('temporary RPC error with known hash stays resumable without resending',async()=>{
 const x=setup();await x.pilot.connect();await x.pilot.review();
 const original=x.provider.request.bind(x.provider);let once=true;
 x.provider.request=async args=>{if(args.method==='eth_getTransactionByHash'&&once){once=false;throw Error('fake transport outage');}return original(args);};
 await assert.rejects(x.pilot.start({reviewConfirmed:true}),/RPC_UNAVAILABLE/);
 assert.equal(x.pilot.snapshot().phase,'pending');assert.ok(x.pilot.snapshot().hash);assert.equal(x.provider.sent.length,1);
 const done=await x.pilot.resume();assert.equal(done.phase,'complete');assert.equal(x.provider.sent.length,3);
});

test('temporary preflight read failure at ready stage remains safely resumable',async()=>{
 const x=setup();await x.pilot.connect();await x.pilot.review();
 const original=x.provider.request.bind(x.provider);let once=true;
 x.provider.request=async args=>{if(args.method==='eth_getCode'&&args.params[0]===x.provider.receiver&&x.pilot.state?.stageIndex===1&&x.pilot.state?.phase==='ready'&&once){once=false;throw Error('fake preflight outage');}return original(args);};
 await assert.rejects(x.pilot.start({reviewConfirmed:true}),/RPC_UNAVAILABLE/);
 assert.equal(x.pilot.snapshot().phase,'ready');assert.equal(x.pilot.snapshot().stageIndex,1);assert.equal(x.provider.sent.length,1);
 assert.equal((await x.pilot.resume()).phase,'complete');assert.equal(x.provider.sent.length,3);
});

test('rejected owner return leaves principal with receiver and requires manual recovery',async()=>{
 const x=setup();x.provider.rejectAt=3;await x.pilot.connect();await x.pilot.review();
 await assert.rejects(x.pilot.start({reviewConfirmed:true}),/UNCERTAIN_OR_HELD_NO_RESEND/);
 assert.equal(x.pilot.snapshot().stageIndex,2);assert.equal(x.pilot.snapshot().phase,'rejected');
 assert.match(x.pilot.snapshot().message,/manual recovery steps/);
 assert.equal(x.provider.receiverBalance,10n**16n);assert.equal(x.provider.sent.length,2);
 await assert.rejects(x.pilot.resume(),/UNCERTAIN_OR_HELD_NO_RESEND/);assert.equal(x.provider.sent.length,2);
});

test('cancelled initial wallet prompt leaves no transaction and cannot silently retry',async()=>{
 const x=setup();x.provider.rejectAt=1;await x.pilot.connect();await x.pilot.review();
 await assert.rejects(x.pilot.start({reviewConfirmed:true}),/UNCERTAIN_OR_HELD_NO_RESEND/);
 assert.equal(x.pilot.snapshot().stageIndex,0);assert.equal(x.pilot.snapshot().phase,'rejected');
 assert.match(x.pilot.snapshot().message,/No automatic retry/);
 assert.equal(x.provider.sent.length,0);
 const restarted=setup({provider:x.provider,store:x.store});await restarted.pilot.connect();
 await assert.rejects(restarted.pilot.resume(),/UNCERTAIN_OR_HELD_NO_RESEND/);
 assert.equal(x.provider.sent.length,0);
});

test('hung read and wallet prompt have bounded, no-resend recovery',async()=>{
 const read=setup({readTimeoutMs:5});await read.pilot.connect();await read.pilot.review();
 const originalRead=read.provider.request.bind(read.provider);let hung=true;
 read.provider.request=args=>args.method==='eth_getTransactionByHash'&&hung?new Promise(()=>{}):originalRead(args);
 await assert.rejects(read.pilot.start({reviewConfirmed:true}),/RPC_READ_TIMEOUT/);
 assert.equal(read.pilot.snapshot().phase,'pending');assert.equal(read.provider.sent.length,1);
 hung=false;assert.equal((await read.pilot.resume()).phase,'complete');assert.equal(read.provider.sent.length,3);
 const wallet=setup({walletTimeoutMs:5});await wallet.pilot.connect();await wallet.pilot.review();
 const originalWallet=wallet.provider.request.bind(wallet.provider);let late,delayed=false;
 wallet.provider.request=async args=>{if(args.method==='eth_sendTransaction'&&!delayed){delayed=true;const hash=await originalWallet(args);return new Promise(resolve=>{late=()=>resolve(hash);});}return originalWallet(args);};
 await assert.rejects(wallet.pilot.start({reviewConfirmed:true}),/UNCERTAIN_OR_HELD_NO_RESEND/);
 assert.equal(wallet.pilot.snapshot().phase,'unknown');assert.equal(wallet.provider.sent.length,1);
 late();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(wallet.pilot.snapshot().phase,'hash-known');assert.equal((await wallet.pilot.resume()).phase,'complete');assert.equal(wallet.provider.sent.length,3);
});

test('contract wallet and converted EIP-1559 fee envelope fail closed',async()=>{
 const contract=setup();const original=contract.provider.request.bind(contract.provider);
 contract.provider.request=args=>args.method==='eth_getCode'&&args.params[0]===contract.provider.account?'0x1234':original(args);
 await assert.rejects(contract.pilot.connect(),/CONTRACT_WALLET_UNSUPPORTED/);assert.equal(contract.provider.sent.length,0);
 const fee=setup();await fee.pilot.connect();await fee.pilot.review();const send=fee.provider.request.bind(fee.provider);
 fee.provider.request=async args=>{const out=await send(args);if(args.method==='eth_sendTransaction')fee.provider.transactions.get(out).maxFeePerGas='0x4a817c800';return out;};
 await assert.rejects(fee.pilot.start({reviewConfirmed:true}),/UNSUPPORTED_WALLET_FEE_ENVELOPE/);
 assert.equal(fee.pilot.snapshot().phase,'hold');assert.equal(fee.provider.sent.length,1);
});

test('bounded public RPC snapshots retain mismatch evidence without provider secret fields',async()=>{
 const x=setup();const original=x.provider.request.bind(x.provider);
 x.provider.request=async args=>{const value=await original(args);
  if(args.method==='eth_getTransactionReceipt'&&value)return{...value,privateKey:'DO_NOT_EXPORT',headers:{authorization:'DO_NOT_EXPORT'},logs:value.logs.map(log=>({...log,privateKey:'DO_NOT_EXPORT'}))};
  return value;};
 await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
 const report=x.pilot.report(),text=JSON.stringify(report);
 assert.equal(report.run.checks.length,3);assert.equal(report.run.checks[1].outcome,'verified');
 assert.ok(report.run.checks.every(c=>c.at&&c.finishedAt&&c.responses.transaction&&c.responses.receipt&&c.responses.finalizedHead));
 assert.ok(report.run.receipts.every(r=>r.verifiedAt));assert.ok(!text.includes('DO_NOT_EXPORT'));
 assert.ok(report.run.checks.every(c=>JSON.stringify(c).length<=12000));
});

test('new run is possible only after verified completion and explicit evidence export',async()=>{
 const pending=setup({polls:1});pending.provider.hideReceiptAt=1;await pending.pilot.connect();await pending.pilot.review();await pending.pilot.start({reviewConfirmed:true});
 await assert.rejects(pending.pilot.newRun({evidenceExportConfirmed:true}),/COMPLETED_EXPORT_REQUIRED/);
 assert.ok(pending.store.getItem('settleref.bot.wallet-runner.testnet.v1'));
 const done=setup();await done.pilot.connect();await done.pilot.review();await done.pilot.start({reviewConfirmed:true});
 await assert.rejects(done.pilot.newRun(),/COMPLETED_EXPORT_REQUIRED/);
 assert.equal(done.provider.sent.length,3);
 await done.pilot.newRun({evidenceExportConfirmed:true});
 assert.equal(done.store.getItem('settleref.bot.wallet-runner.testnet.v1'),null);assert.equal(done.pilot.snapshot(),null);
 assert.equal(done.provider.sent.length,3);
});

test('wallet event during completed revalidation cannot verify report or clear journal',async()=>{
 const makeCompleted=async()=>{const x=setup();await x.pilot.connect();await x.pilot.review();await x.pilot.start({reviewConfirmed:true});
  x.provider.ownerOverride=x.pilot.account;
  const restarted=setup({provider:x.provider,store:x.store});restarted.pilot.load();await restarted.pilot.connect();
  const original=x.provider.request.bind(x.provider);let fired=false;
  x.provider.request=async args=>{const result=await original(args);if(args.method==='eth_getTransactionReceipt'&&!fired){fired=true;x.provider.changeAccount('0x'+'22'.repeat(20));}return result;};
  return{x,restarted};};
 const verify=await makeCompleted();
 await assert.rejects(verify.restarted.pilot.resume(),/WALLET_CHANGED_HOLD/);
 assert.equal(verify.restarted.pilot.report().totals.principalReturnVerified,false);
 assert.ok(verify.x.store.getItem('settleref.bot.wallet-runner.testnet.v1'));
 const clear=await makeCompleted();
 await assert.rejects(clear.restarted.pilot.newRun({evidenceExportConfirmed:true}),/WALLET_CHANGED_HOLD/);
 assert.ok(clear.x.store.getItem('settleref.bot.wallet-runner.testnet.v1'));assert.equal(clear.x.provider.sent.length,3);
});
