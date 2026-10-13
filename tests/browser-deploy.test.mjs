import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDeployment, submitDeployment, verifyDeployment } from '../scripts/browser-deploy-wallet.mjs';

const owner = '0x' + '11'.repeat(20);
const other = '0x' + '22'.repeat(20);
const contract = '0x' + '33'.repeat(20);
const txHash = '0x' + '44'.repeat(32);
const blockHash = '0x' + '55'.repeat(32);
const config = { network: 'testnet', chainId: 5042002, creationBytecode: '0x60006000', runtimeBytecode: '0x6000', sourceCommit: 'reviewed', explorerUrl: 'https://explorer.testnet.arc.io' };
function fixture(overrides = {}) {
  const calls = [];
  const state = { walletChain: config.chainId, rpcChain: config.chainId, account: owner, balance: 10n ** 18n, ...overrides };
  const wallet = { async request({ method, params }) {
    calls.push({ method, params });
    if (method === 'eth_chainId') return `0x${state.walletChain.toString(16)}`;
    if (method === 'eth_accounts') return [state.account];
    if (method === 'eth_sendTransaction') {
      if (state.rejection) throw state.rejection;
      return txHash;
    }
    throw new Error('Unexpected wallet request');
  } };
  const receipt = { transactionHash: txHash, status: '0x1', from: owner, to: null, contractAddress: contract, blockNumber: '0x10', blockHash };
  const tx = { hash: txHash, from: owner, to: null, value: '0x0', input: config.creationBytecode, blockNumber: '0x10', blockHash, chainId: `0x${config.chainId.toString(16)}` };
  const results = {
    eth_estimateGas: '0x10000', eth_gasPrice: '0x100', eth_getTransactionReceipt: receipt,
    eth_getTransactionByHash: tx, eth_getCode: config.runtimeBytecode, eth_getBlockByNumber: { hash: blockHash },
  };
  async function rpc(method) {
    if (method === 'eth_chainId') return `0x${state.rpcChain.toString(16)}`;
    if (method === 'eth_getBalance') return `0x${state.balance.toString(16)}`;
    if (!(method in results)) throw new Error('Unexpected RPC request');
    return results[method];
  }
  return { wallet, rpc, calls, state, results, receipt, tx };
}
const sends = f => f.calls.filter(c => c.method === 'eth_sendTransaction');

test('deployment review rejects wrong wallet chain without signing', async () => {
  const f = fixture({ walletChain: 1 });
  await assert.rejects(reviewDeployment(f.wallet, f.rpc, config, owner), /Switch your wallet/);
  assert.equal(sends(f).length, 0);
});
test('deployment review rejects wrong RPC chain without signing', async () => {
  const f = fixture({ rpcChain: 1 });
  await assert.rejects(reviewDeployment(f.wallet, f.rpc, config, owner), /RPC is on the wrong chain/);
  assert.equal(sends(f).length, 0);
});
test('deployment review rejects unexpected signer and insufficient native balance', async () => {
  const f = fixture({ account: other });
  await assert.rejects(reviewDeployment(f.wallet, f.rpc, config, owner), /does not match/);
  f.state.account = owner;
  f.state.balance = 0n;
  await assert.rejects(reviewDeployment(f.wallet, f.rpc, config, owner), /needs native USDC/);
  assert.equal(sends(f).length, 0);
});
test('deployment rechecks signer and chain after review', async () => {
  const f = fixture();
  const review = await reviewDeployment(f.wallet, f.rpc, config, owner);
  f.state.account = other;
  await assert.rejects(submitDeployment(f.wallet, f.rpc, config, review), /does not match/);
  f.state.account = owner;
  f.state.walletChain = 1;
  await assert.rejects(submitDeployment(f.wallet, f.rpc, config, review), /Switch your wallet/);
  assert.equal(sends(f).length, 0);
});
test('deployment submits exactly one zero-value creation request with reviewed fee bounds', async () => {
  const f = fixture();
  const review = await reviewDeployment(f.wallet, f.rpc, config, owner);
  assert.equal(await submitDeployment(f.wallet, f.rpc, config, review), txHash);
  const requests = sends(f);
  assert.equal(requests.length, 1);
  const tx = requests[0].params[0];
  assert.equal(tx.to, undefined);
  assert.equal(tx.value, '0x0');
  assert.equal(tx.data, config.creationBytecode);
  assert.equal(BigInt(tx.gas) * BigInt(tx.maxFeePerGas), BigInt(review.feeCeilingWei));
});
test('wallet rejection or uncertain error never retries a deployment', async () => {
  for (const rejection of [Object.assign(new Error('rejected'), { code: 4001 }), new Error('transport disconnected')]) {
    const f = fixture({ rejection });
    const review = await reviewDeployment(f.wallet, f.rpc, config, owner);
    await assert.rejects(submitDeployment(f.wallet, f.rpc, config, review));
    assert.equal(sends(f).length, 1);
  }
});
test('changed deployment data or balance prevents a signing request', async () => {
  const f = fixture();
  const review = await reviewDeployment(f.wallet, f.rpc, config, owner);
  review.transaction.value = '0x1';
  await assert.rejects(submitDeployment(f.wallet, f.rpc, config, review), /review changed/);
  review.transaction.value = '0x0';
  f.state.balance = 0n;
  await assert.rejects(submitDeployment(f.wallet, f.rpc, config, review), /below the reviewed gas ceiling/);
  assert.equal(sends(f).length, 0);
});
test('deployment receipt verifies actual creation data, runtime and canonical block without a signer', async () => {
  const f = fixture();
  const report = await verifyDeployment(f.rpc, config, txHash, owner);
  assert.equal(report.status, 'PASS');
  assert.equal(report.contractAddress, contract);
  assert.equal(report.writesEnabled, false);
  assert.equal(f.calls.length, 0);
});
test('pending deployment receipt stays pending', async () => {
  const f = fixture();
  f.results.eth_getTransactionReceipt = null;
  assert.equal(await verifyDeployment(f.rpc, config, txHash, owner), null);
});
test('deployment verifier rejects creation, runtime, receipt and block tampering', async () => {
  for (const mutate of [
    f => { f.tx.input = '0x6001'; },
    f => { f.tx.value = '0x1'; },
    f => { f.tx.from = other; },
    f => { f.tx.chainId = '0x1'; },
    f => { f.results.eth_getCode = '0x6001'; },
    f => { f.receipt.transactionHash = blockHash; },
    f => { f.receipt.status = '0x0'; },
    f => { f.results.eth_getBlockByNumber = { hash: txHash }; },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(verifyDeployment(f.rpc, config, txHash, owner));
    assert.equal(f.calls.length, 0);
  }
});
