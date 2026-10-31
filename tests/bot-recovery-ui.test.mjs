import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryAdvice} from '../public/bot-testnet/recovery-advice.mjs';

test('each unresolved stage has actionable no-resend and evidence guidance',()=>{
 for (const stageIndex of [0,1,2]) {
  const unknown=recoveryAdvice({phase:'unknown',stageIndex});
  assert.match(unknown,/Do not resend/);
  assert.match(unknown,/Download the evidence JSON/);
  assert.match(unknown,/original hash/);
  assert.match(unknown,/hash seen only in wallet history needs manual reconciliation/i);
  const pending=recoveryAdvice({phase:'pending',stageIndex});
  assert.match(pending,/same hash read-only/);
  assert.match(pending,/own wallet approval/);
 }
 const held=recoveryAdvice({phase:'hold',stageIndex:1});
 assert.match(held,/Do not resend/);
 assert.match(held,/bounded receipt snapshots/);
 assert.match(recoveryAdvice({phase:'rejected',stageIndex:2}),/withdraw\(\) with zero value/);
 assert.match(recoveryAdvice({phase:'rejected',stageIndex:0}),/unexpected send/);
 assert.equal(recoveryAdvice({phase:'complete',stageIndex:3}),'');
});

test('guidance never interpolates untrusted journal fields',()=>{
 const marker='UNTRUSTED_PRIVATE_PAYLOAD';
 for(const phase of ['unknown','pending','hold','rejected']) {
  const advice=recoveryAdvice({phase,stageIndex:2,hash:marker,receiverAddress:marker,intent:{data:marker},message:marker});
  assert.ok(advice.length>0);
  assert.ok(!advice.includes(marker));
 }
 assert.equal(recoveryAdvice(null),'');
});
