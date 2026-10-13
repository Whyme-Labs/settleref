import { reviewDeployment, submitDeployment, verifyDeployment } from './browser-deploy-wallet.mjs';

const config = await (await fetch('./config.json')).json();
const el = id => document.getElementById(id);
const key = `settleref.deploy.${config.chainId}.${config.runtimeCodeSha256}`;
let review = null;
let report = null;
let pending = JSON.parse(sessionStorage.getItem(key) ?? 'null');
el('network').textContent = `${config.network} · chain ${config.chainId} · source ${config.sourceCommit}`;
if (pending) {
  el('owner').value = pending.owner;
  el('hash').value = pending.transactionHash ?? '';
  el('status').textContent = pending.transactionHash
    ? 'Recovered original transaction. Check its receipt; do not deploy again.'
    : 'A wallet request may already exist. Inspect your wallet and paste its transaction hash. Do not deploy again.';
}

async function rpc(method, params) {
  const response = await fetch(config.rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const result = await response.json();
  if (result.error || !Object.hasOwn(result, 'result')) throw new Error(result.error?.message ?? 'RPC returned no result.');
  return result.result;
}

function displayError(error) { el('status').textContent = error.message ?? String(error); }
function save() { sessionStorage.setItem(key, JSON.stringify(pending)); }

el('connect').onclick = async () => {
  review = null;
  el('deploy').disabled = true;
  try {
    if (!window.ethereum?.request) throw new Error('Open this page in the browser where your EVM wallet is installed.');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    review = await reviewDeployment(window.ethereum, rpc, config, el('owner').value);
    const fee = BigInt(review.feeCeilingWei);
    const decimal = `${fee / 10n ** 18n}.${(fee % (10n ** 18n)).toString().padStart(18, '0')}`;
    el('review').textContent = `Network: ${config.network}\nOwner: ${review.owner}\nContract: SettleRef, capped at 1 USDC per payment\nDeployment value: 0 USDC\nMaximum gas cost: ${decimal} USDC\nSource: ${config.sourceCommit}\nRuntime SHA-256: ${config.runtimeCodeSha256}`;
    el('deploy').disabled = pending !== null;
    el('status').textContent = pending ? 'An earlier wallet request exists. Check its receipt.' : 'Review complete. The deployment button opens one wallet signing request.';
  } catch (error) { displayError(error); }
};

el('deploy').onclick = async () => {
  if (!review || pending) return;
  el('deploy').disabled = true;
  try {
    const transactionHash = await submitDeployment(window.ethereum, rpc, config, review, () => {
      // Save before requesting a signature. A reload during the request must not resend.
      pending = { owner: review.owner, transactionHash: null, status: 'WALLET_REQUESTED' };
      save();
    });
    pending.transactionHash = transactionHash;
    save();
    el('hash').value = transactionHash;
    el('status').textContent = `Transaction submitted: ${transactionHash}. Check its receipt. No automatic retry.`;
  } catch (error) {
    if (error.code === 4001) {
      pending = null;
      sessionStorage.removeItem(key);
      review = null;
      el('status').textContent = 'Wallet rejected the request. No retry. Connect and review again if you choose to continue.';
    } else { displayError(error); }
  }
};

el('owner').oninput = () => { review = null; el('deploy').disabled = true; };

el('verify').onclick = async () => {
  report = null;
  el('export').disabled = true;
  try {
    if (pending && el('owner').value.toLowerCase() !== pending.owner) throw new Error('Keep the original deployment owner when recovering.');
    if (pending?.transactionHash && el('hash').value.toLowerCase() !== pending.transactionHash) throw new Error('Keep the original deployment hash when recovering.');
    report = await verifyDeployment(rpc, config, el('hash').value, el('owner').value);
    el('status').textContent = report ? JSON.stringify(report, null, 2) : 'Receipt is pending. Check again later. Do not deploy again.';
    el('export').disabled = !report;
  } catch (error) { displayError(error); }
};

el('export').onclick = () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `deployment-${config.network}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
