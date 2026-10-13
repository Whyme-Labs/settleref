// Browser-wallet signing only. RPC checks never submit or retry a transaction.
function address(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error('Enter a nonzero public wallet address.');
  }
  return value.toLowerCase();
}

function hash(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Invalid transaction hash.');
  return value.toLowerCase();
}

async function checkWallet(wallet, rpc, config, owner) {
  const expected = address(owner);
  if (BigInt(await rpc('eth_chainId', [])) !== BigInt(config.chainId)) throw new Error('RPC is on the wrong chain.');
  if (BigInt(await wallet.request({ method: 'eth_chainId' })) !== BigInt(config.chainId)) {
    throw new Error(`Switch your wallet to ${config.network}, chain ${config.chainId}, then review again.`);
  }
  const accounts = await wallet.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || address(accounts[0]) !== expected) throw new Error('Selected wallet account does not match the owner address.');
  return expected;
}

export async function reviewDeployment(wallet, rpc, config, owner) {
  const from = await checkWallet(wallet, rpc, config, owner);
  const base = { from, data: config.creationBytecode, value: '0x0' };
  const estimate = BigInt(await rpc('eth_estimateGas', [base]));
  const gas = (estimate * 120n + 99n) / 100n;
  const maxFee = BigInt(await rpc('eth_gasPrice', [])) * 2n;
  if (gas <= 0n || maxFee <= 0n) throw new Error('RPC returned an invalid gas estimate.');
  const feeCeilingWei = gas * maxFee;
  if (BigInt(await rpc('eth_getBalance', [from, 'pending'])) < feeCeilingWei) {
    throw new Error('Owner wallet needs native USDC for deployment gas. Fund it, then review again.');
  }
  return {
    owner: from,
    feeCeilingWei: feeCeilingWei.toString(),
    transaction: {
      ...base, chainId: `0x${config.chainId.toString(16)}`, gas: `0x${gas.toString(16)}`,
      maxFeePerGas: `0x${maxFee.toString(16)}`, maxPriorityFeePerGas: '0x0', type: '0x2',
    },
  };
}

export async function submitDeployment(wallet, rpc, config, review, beforeSend = () => {}) {
  await checkWallet(wallet, rpc, config, review.owner);
  const tx = review.transaction;
  if (tx.from !== review.owner || tx.to !== undefined || tx.value !== '0x0' ||
      tx.data !== config.creationBytecode || BigInt(tx.chainId) !== BigInt(config.chainId)) {
    throw new Error('Deployment review changed. Review again before signing.');
  }
  if (BigInt(await rpc('eth_getBalance', [review.owner, 'pending'])) < BigInt(tx.gas) * BigInt(tx.maxFeePerGas)) {
    throw new Error('Owner balance is below the reviewed gas ceiling.');
  }
  // One request only. Errors must never trigger an automatic broadcast retry.
  beforeSend();
  return hash(await wallet.request({ method: 'eth_sendTransaction', params: [tx] }));
}

export async function verifyDeployment(rpc, config, rawHash, owner) {
  const transactionHash = hash(rawHash);
  if (BigInt(await rpc('eth_chainId', [])) !== BigInt(config.chainId)) throw new Error('RPC is on the wrong chain.');
  const receipt = await rpc('eth_getTransactionReceipt', [transactionHash]);
  if (receipt === null) return null;
  if (receipt.status !== '0x1') throw new Error('Deployment reverted. Do not enable payments.');
  if (hash(receipt.transactionHash) !== transactionHash || receipt.to !== null || address(receipt.from) !== address(owner)) {
    throw new Error('Deployment receipt does not match the owner transaction.');
  }
  const tx = await rpc('eth_getTransactionByHash', [transactionHash]);
  if (!tx || hash(tx.hash) !== transactionHash || tx.to !== null || address(tx.from) !== address(owner) ||
      BigInt(tx.value) !== 0n || tx.input.toLowerCase() !== config.creationBytecode ||
      tx.blockNumber !== receipt.blockNumber || hash(tx.blockHash) !== hash(receipt.blockHash) ||
      BigInt(tx.chainId) !== BigInt(config.chainId)) {
    throw new Error('Deployment creation transaction differs from the reviewed artifact.');
  }
  const contractAddress = address(receipt.contractAddress);
  const runtime = await rpc('eth_getCode', [contractAddress, 'latest']);
  if (typeof runtime !== 'string' || runtime.toLowerCase() !== config.runtimeBytecode) {
    throw new Error('Deployed runtime differs from the reviewed artifact.');
  }
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (!block || hash(block.hash) !== hash(receipt.blockHash)) throw new Error('Deployment block is not canonical.');
  return {
    schema: 'settleref.browser-deployment.v1', status: 'PASS', network: config.network,
    chainId: config.chainId, sourceCommit: config.sourceCommit,
    transactionHash, contractAddress, deployer: address(owner),
    runtimeCodeSha256: config.runtimeCodeSha256, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
    exactCreationBytecodeMatch: true, exactRuntimeMatch: true,
    explorerUrl: `${config.explorerUrl}/tx/${transactionHash}`, writesEnabled: false,
  };
}
