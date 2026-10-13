import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitments, parseInstruction, makeExample, sha256, nativeAmount } from '../public/app/domain.js';
import { SELECTORS, SETTLED_TOPIC, encodeSettlement, parseDeployment, verifyPayment, sendPayment, word } from '../public/app/chain.js';
const payer = '0x3333333333333333333333333333333333333333';
const beneficiary = '0x4444444444444444444444444444444444444444';
const contract = '0x5555555555555555555555555555555555555555';
const txHash = `0x${'aa'.repeat(32)}`, blockHash = `0x${'bb'.repeat(32)}`;
async function fixture() {
  const i = parseInstruction({ ...makeExample(), payer, beneficiary });
  const c = await commitments(i), data = await encodeSettlement(i);
  const code = '0x6001600055';
  const d = { chainId: 5042, rpcUrl: 'https://rpc.mainnet.arc.io', explorerUrl: 'https://explorer.arc.io', contractAddress: contract, runtimeCodeSha256: await sha256(code), writesEnabled: true };
  const receipt = { status: '0x1', transactionHash: txHash, to: contract, from: payer, blockNumber: '0x42', blockHash, logs: [{ address: contract, topics: [SETTLED_TOPIC, `0x${word(payer)}`, c.instructionId, `0x${word(beneficiary)}`], data: '0x' + [nativeAmount(i), c.contentHash, BigInt(i.expiresAt)].map(word).join('') }] };
  const tx = { hash: txHash, from: payer, to: contract, value: '0x' + nativeAmount(i).toString(16), input: data, blockHash, blockNumber: '0x42' };
  const block = { hash: blockHash, number: '0x42', timestamp: '0x' + (i.expiresAt - 1).toString(16) };
  const state = { chain: '0x13b2', code, receipt, tx, block, duplicate: false, balance: '0xde0b6b3a7640000', calls: [] };
  const rpc = { async request(method, params) {
    state.calls.push({ method, params });
    switch (method) {
      case 'eth_chainId': return state.chain;
      case 'eth_getCode': return state.code;
      case 'eth_getTransactionReceipt': return state.receipt;
      case 'eth_getTransactionByHash': return state.tx;
      case 'eth_getBlockByNumber': return state.block;
      case 'eth_call': return params[0].data.startsWith(SELECTORS.settled) ? `0x${word(state.duplicate ? 1n : 0n)}` : '0x';
      case 'eth_estimateGas': return '0x186a0';
      case 'eth_gasPrice': return '0x4a817c800';
      case 'eth_getBalance': return state.balance;
      default: throw new Error(`Unexpected RPC ${method}`);
    }
  } };
  const walletState = { sends: 0, chain: '0x13b2', account: payer, tx: null, fail: false };
  const wallet = { async request({ method, params }) {
    if (method === 'eth_accounts') return [walletState.account];
    if (method === 'eth_chainId') return walletState.chain;
    if (method === 'eth_sendTransaction') { walletState.sends++; walletState.tx = params[0]; if (walletState.fail) throw new Error('User rejected'); return txHash; }
    throw new Error(`Unexpected wallet ${method}`);
  } };
  return { i, c, d, state, rpc, wallet, walletState };
}
test('static ABI contains selector and five exact 32-byte arguments', async () => {
  const f = await fixture(); const data = await encodeSettlement(f.i);
  assert.equal(data.length, 2 + 8 + 5 * 64);
  assert.equal(data.slice(0,10), SELECTORS.settle);
  assert.equal(data.slice(10+64*2,10+64*3), word(nativeAmount(f.i)));
});
test('verifies matching receipt via RPC with pinned code', async () => {
  const f = await fixture(); const r = await verifyPayment(f.rpc, f.d, f.i, txHash);
  assert.equal(r.kind, 'rpc-verified'); assert.equal(r.amount, '0.100000'); assert.equal(r.reference, f.i.reference);
});
const corruptions = {
  'wrong chain': f => { f.state.chain = '0x1'; },
  'wrong runtime code': f => { f.state.code = '0x1234'; },
  'missing contract': f => { f.state.code = '0x'; },
  'pending receipt': f => { f.state.receipt = null; },
  'reverted receipt': f => { f.state.receipt.status = '0x0'; },
  'receipt hash mismatch': f => { f.state.receipt.transactionHash = blockHash; },
  'wrong transaction amount': f => { f.state.tx.value = '0x1'; },
  'wrong calldata': f => { f.state.tx.input = '0x'; },
  'forged emitting contract': f => { f.state.receipt.logs[0].address = beneficiary; },
  'wrong event beneficiary': f => { f.state.receipt.logs[0].topics[3] = `0x${word(payer)}`; },
  'wrong content commitment': f => { f.state.receipt.logs[0].data = `0x${word(nativeAmount(f.i))}${word(1n)}${word(BigInt(f.i.expiresAt))}`; },
  'no settlement event': f => { f.state.receipt.logs = []; },
  'ambiguous duplicate event': f => { f.state.receipt.logs.push(f.state.receipt.logs[0]); },
  'noncanonical block': f => { f.state.block.hash = txHash; },
  'wrong transaction block': f => { f.state.tx.blockHash = txHash; },
  'settled after expiry': f => { f.state.block.timestamp = `0x${f.i.expiresAt.toString(16)}`; },
};
for (const [label, corrupt] of Object.entries(corruptions)) {
  test(`rejects ${label}`, async () => { const f = await fixture(); corrupt(f); await assert.rejects(verifyPayment(f.rpc, f.d, f.i, txHash)); });
}
test('changes to invoice content invalidate original receipt', async () => {
  const f = await fixture(); await assert.rejects(verifyPayment(f.rpc, f.d, { ...f.i, reference: 'other invoice' }, txHash));
});
test('live writes are disabled without configuration', () => {
  assert.throws(() => parseDeployment({ chainId: 5042, rpcUrl: 'https://rpc.mainnet.arc.io', explorerUrl: 'https://explorer.arc.io', writesEnabled: true, contractAddress: null, runtimeCodeSha256: null }));
});
test('refuses insecure public RPC endpoints', async () => { const f = await fixture(); assert.throws(() => parseDeployment({ ...f.d, rpcUrl: 'http://evil.example' })); });
test('signs exactly one transaction after read-only checks', async () => {
  const f = await fixture(); assert.equal(await sendPayment(f.wallet, f.rpc, f.d, f.i), txHash);
  assert.equal(f.walletState.sends, 1); assert.equal(f.walletState.tx.value, f.state.tx.value);
  assert.ok(BigInt(f.walletState.tx.maxFeePerGas) >= 20000000000n);
});
test('duplicate never reaches wallet signing', async () => {
  const f = await fixture(); f.state.duplicate = true;
  await assert.rejects(sendPayment(f.wallet, f.rpc, f.d, f.i), /Duplicate blocked/); assert.equal(f.walletState.sends,0);
});
test('wrong signer never reaches wallet signing', async () => {
  const f = await fixture(); f.walletState.account = beneficiary;
  await assert.rejects(sendPayment(f.wallet, f.rpc, f.d, f.i)); assert.equal(f.walletState.sends,0);
});
test('wrong wallet chain never reaches wallet signing', async () => {
  const f = await fixture(); f.walletState.chain = '0x1';
  await assert.rejects(sendPayment(f.wallet, f.rpc, f.d, f.i)); assert.equal(f.walletState.sends,0);
});
test('insufficient funds fail before signing', async () => {
  const f = await fixture(); f.state.balance = '0x1';
  await assert.rejects(sendPayment(f.wallet, f.rpc, f.d, f.i), /Insufficient/); assert.equal(f.walletState.sends,0);
});
test('wallet rejection is never automatically retried', async () => {
  const f = await fixture(); f.walletState.fail = true;
  await assert.rejects(sendPayment(f.wallet, f.rpc, f.d, f.i), /User rejected/); assert.equal(f.walletState.sends,1);
});
