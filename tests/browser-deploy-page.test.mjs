import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewDeployment, submitDeployment, verifyDeployment } from '../scripts/browser-deploy-wallet.mjs';

const source = (await readFile(new URL('../scripts/browser-deploy-page.mjs', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const owner = '0x' + '11'.repeat(20);
const transactionHash = '0x' + '44'.repeat(32);
const olderHash = '0x' + '66'.repeat(32);
const blockHash = '0x' + '55'.repeat(32);
const config = { network: 'testnet', chainId: 5042002, creationBytecode: '0x60006000', runtimeBytecode: '0x6000', runtimeCodeSha256: blockHash, sourceCommit: 'reviewed', explorerUrl: 'https://example.invalid' };
const key = `settleref.deploy.${config.chainId}.${config.runtimeCodeSha256}`;
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function page({ storage = new Map(), pauseBalance = false, pauseReceipt = false, rejection = null } = {}) {
  const elements = Object.fromEntries(['network', 'owner', 'hash', 'status', 'review', 'connect', 'deploy', 'verify', 'export'].map(id => [id, { value: '', textContent: '', disabled: ['deploy', 'export'].includes(id) }]));
  elements.owner.value = owner;
  const entered = deferred(), release = deferred();
  let balanceReads = 0, signingRequests = 0;
  const wallet = { async request({ method }) {
    if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [owner];
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_sendTransaction') {
      signingRequests++;
      if (rejection) throw rejection;
      return transactionHash;
    }
    throw new Error(`Unexpected wallet request ${method}`);
  } };
  async function fetch(url, options) {
    if (url === './config.json') return { json: async () => config };
    const { method, params } = JSON.parse(options.body);
    let result;
    if (method === 'eth_chainId') result = '0x4cef52';
    else if (method === 'eth_estimateGas') result = '0x10000';
    else if (method === 'eth_gasPrice') result = '0x100';
    else if (method === 'eth_getBalance') {
      if (pauseBalance && ++balanceReads === 2) { entered.resolve(); await release.promise; }
      result = '0xde0b6b3a7640000';
    } else if (method === 'eth_getTransactionReceipt') {
      if (pauseReceipt) { entered.resolve(); await release.promise; }
      result = { transactionHash: params[0], status: '0x1', from: owner, to: null, contractAddress: '0x' + '33'.repeat(20), blockNumber: '0x10', blockHash };
    } else if (method === 'eth_getTransactionByHash') result = { hash: params[0], from: owner, to: null, value: '0x0', input: config.creationBytecode, chainId: '0x4cef52', blockNumber: '0x10', blockHash };
    else if (method === 'eth_getCode') result = config.runtimeBytecode;
    else if (method === 'eth_getBlockByNumber') result = { hash: blockHash };
    else throw new Error(`Unexpected RPC request ${method}`);
    return { ok: true, json: async () => ({ result }) };
  }
  await new AsyncFunction('document', 'sessionStorage', 'window', 'fetch', 'reviewDeployment', 'submitDeployment', 'verifyDeployment', source)(
    { getElementById: id => elements[id] },
    { getItem: id => storage.get(id) ?? null, setItem: (id, value) => storage.set(id, value), removeItem: id => storage.delete(id) },
    { ethereum: wallet }, fetch, reviewDeployment, submitDeployment, verifyDeployment,
  );
  return { elements, storage, entered: entered.promise, release: release.resolve, signingRequests: () => signingRequests };
}

test('deployment page locks overlapping reconnect and deploy during asynchronous preflight', async () => {
  const p = await page({ pauseBalance: true });
  await p.elements.connect.onclick();
  const request = p.elements.deploy.onclick();
  await p.entered;
  await p.elements.connect.onclick();
  await p.elements.deploy.onclick();
  await p.elements.verify.onclick();
  assert.equal(p.elements.connect.disabled, true);
  assert.equal(p.elements.verify.disabled, true);
  assert.equal(p.elements.deploy.disabled, true);
  assert.equal(p.signingRequests(), 0);
  p.release();
  await request;
  assert.equal(p.signingRequests(), 1);
  assert.equal(JSON.parse(p.storage.get(key)).transactionHash, transactionHash);
});

test('verified manual recovery persists the original hash across reload and prevents redeployment', async () => {
  const storage = new Map([[key, JSON.stringify({ owner, transactionHash: null, status: 'WALLET_REQUESTED' })]]);
  const p = await page({ storage });
  p.elements.hash.value = transactionHash;
  await p.elements.verify.onclick();
  assert.equal(JSON.parse(storage.get(key)).transactionHash, transactionHash);
  assert.equal(JSON.parse(storage.get(key)).status, 'VERIFIED');
  const reloaded = await page({ storage });
  assert.equal(reloaded.elements.hash.value, transactionHash);
  await reloaded.elements.connect.onclick();
  assert.equal(reloaded.elements.deploy.disabled, true);
  assert.equal(reloaded.signingRequests(), 0);
});

test('verification locks signing so a stale receipt cannot replace a newer pending deployment', async () => {
  const p = await page({ pauseReceipt: true });
  await p.elements.connect.onclick();
  p.elements.hash.value = olderHash;
  const verification = p.elements.verify.onclick();
  await p.entered;
  await p.elements.connect.onclick();
  await p.elements.deploy.onclick();
  assert.equal(p.signingRequests(), 0);
  assert.equal(p.elements.hash.disabled, true);
  assert.equal(p.elements.owner.disabled, true);
  p.release();
  await verification;
  assert.equal(JSON.parse(p.storage.get(key)).transactionHash, olderHash);
  assert.equal(p.elements.hash.value, olderHash);
});

test('explicit wallet rejection releases the page for a fresh review without retrying', async () => {
  const p = await page({ rejection: Object.assign(new Error('rejected'), { code: 4001 }) });
  await p.elements.connect.onclick();
  await p.elements.deploy.onclick();
  assert.equal(p.signingRequests(), 1);
  assert.equal(p.storage.has(key), false);
  assert.equal(p.elements.connect.disabled, false);
  assert.equal(p.elements.deploy.disabled, true);
});
