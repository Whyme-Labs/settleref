// Verify owner-produced SR-03 deployment and payment evidence without any signer.
// Usage:
//   npm run build
//   node scripts/sr03-verify-live.mjs testnet 0xCONTRACT 0xDEPLOY_TX path/to/receipt-bundle.json
//   node scripts/sr03-verify-live.mjs mainnet 0xCONTRACT 0xDEPLOY_TX path/to/receipt-bundle.json
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { address, hash, parseInstruction } from '../dist/app/domain.js';
import {
  checkDuplicate,
  httpTransport,
  quantity,
  verifyPayment,
} from '../dist/app/chain.js';

const [network, rawContract, rawDeploymentTx, bundlePath, customOutput] = process.argv.slice(2);
if (!['testnet', 'mainnet'].includes(network)) {
  throw new Error('Network must be testnet or mainnet.');
}
if (!rawContract || !rawDeploymentTx || !bundlePath) {
  throw new Error(
    'Usage: node scripts/sr03-verify-live.mjs <testnet|mainnet> <contract> <deploymentTx> <receiptBundle.json> [output.json]',
  );
}

const isMainnet = network === 'mainnet';
const chainId = isMainnet ? 5042 : 5_042_002;
const rpcUrl = isMainnet
  ? process.env.ARC_MAINNET_RPC_URL ?? 'https://rpc.mainnet.arc.io'
  : process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.network';
const explorerUrl = isMainnet
  ? process.env.ARC_MAINNET_EXPLORER_URL ?? 'https://explorer.arc.io'
  : process.env.ARC_TESTNET_EXPLORER_URL ?? 'https://explorer.testnet.arc.io';
const contractAddress = address(rawContract);
const deploymentTransactionHash = hash(rawDeploymentTx);
const outputPath =
  customOutput ?? `evidence/sr03/owner/${network}-verified.json`;
const rpc = httpTransport(rpcUrl);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function normalizeBytecode(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be hexadecimal bytecode.`);
  const normalized = value.toLowerCase().startsWith('0x')
    ? value.toLowerCase()
    : `0x${value.toLowerCase()}`;
  if (!/^0x[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${label} is malformed.`);
  }
  return normalized;
}

function runtimeSha256(code) {
  return `0x${createHash('sha256').update(code).digest('hex')}`;
}

function decimalUnits(amount) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(amount);
  if (!match) throw new Error('Payment amount is not a canonical six-decimal USDC value.');
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}

const observedChainId = quantity(await rpc.request('eth_chainId', []));
if (observedChainId !== BigInt(chainId)) {
  throw new Error(`RPC chain mismatch. Expected ${chainId}, received ${observedChainId}.`);
}

const artifact = JSON.parse(
  await readFile('out/SettleRef.sol/SettleRef.json', 'utf8'),
);
const expectedCreation = normalizeBytecode(artifact.bytecode.object, 'Creation bytecode');
const expectedRuntime = normalizeBytecode(
  artifact.deployedBytecode.object,
  'Runtime bytecode',
);
const remoteRuntime = normalizeBytecode(
  await rpc.request('eth_getCode', [contractAddress, 'latest']),
  'Remote runtime bytecode',
);
if (remoteRuntime === '0x' || remoteRuntime !== expectedRuntime) {
  throw new Error('Deployed runtime does not match the reviewed local artifact.');
}

const deploymentReceipt = object(
  await rpc.request('eth_getTransactionReceipt', [deploymentTransactionHash]),
  'Deployment receipt',
);
if (deploymentReceipt.status !== '0x1') {
  throw new Error('Deployment transaction did not succeed.');
}
if (address(deploymentReceipt.contractAddress) !== contractAddress) {
  throw new Error('Deployment receipt contract address mismatch.');
}
if (deploymentReceipt.to !== null) {
  throw new Error('Deployment receipt unexpectedly has a target address.');
}

const deploymentTransaction = object(
  await rpc.request('eth_getTransactionByHash', [deploymentTransactionHash]),
  'Deployment transaction',
);
if (hash(deploymentTransaction.hash) !== deploymentTransactionHash) {
  throw new Error('Deployment transaction hash mismatch.');
}
if (deploymentTransaction.to !== null) {
  throw new Error('Deployment transaction is not contract creation.');
}
const deploymentInput = normalizeBytecode(
  deploymentTransaction.input,
  'Deployment transaction input',
);
if (deploymentInput !== expectedCreation) {
  throw new Error('Deployment transaction creation bytecode differs from the reviewed artifact.');
}

const bundle = object(
  JSON.parse(await readFile(bundlePath, 'utf8')),
  'Receipt bundle',
);
if (bundle.schema !== 'settleref.bundle.v1') {
  throw new Error('Expected a SettleRef real receipt bundle, not a simulation.');
}
const instruction = parseInstruction(bundle.instruction);
if (instruction.chainId !== chainId) {
  throw new Error('Receipt bundle instruction belongs to another network.');
}
const paymentTransactionHash = hash(bundle.transactionHash);
const deployment = {
  chainId,
  rpcUrl,
  explorerUrl,
  contractAddress,
  runtimeCodeSha256: runtimeSha256(remoteRuntime),
  writesEnabled: false,
};
const verifiedReceipt = await verifyPayment(
  rpc,
  deployment,
  instruction,
  paymentTransactionHash,
);
if (!(await checkDuplicate(rpc, deployment, instruction))) {
  throw new Error('Onchain duplicate flag is false after the claimed settlement.');
}

const amountMicroUsdc = decimalUnits(instruction.amount);
if (amountMicroUsdc > 100_000n) {
  throw new Error('SR-03 smoke payment exceeds the approved 0.10 USDC limit.');
}

const deploymentBlock = quantity(deploymentReceipt.blockNumber);
const report = {
  schema: 'settleref.sr03-owner-verification.v1',
  generatedAt: new Date().toISOString(),
  sourceCommit: process.env.GITHUB_SHA ?? null,
  status: 'PASS',
  network,
  chainId,
  rpcUrl,
  explorerUrl,
  contract: {
    address: contractAddress,
    runtimeBytes: (remoteRuntime.length - 2) / 2,
    runtimeCodeSha256: deployment.runtimeCodeSha256,
    exactRuntimeMatch: true,
    exactCreationBytecodeMatch: true,
    explorerUrl: `${explorerUrl}/address/${contractAddress}`,
  },
  deployment: {
    transactionHash: deploymentTransactionHash,
    blockNumber: deploymentBlock.toString(),
    blockHash: hash(deploymentReceipt.blockHash),
    deployer: address(deploymentTransaction.from),
    explorerUrl: `${explorerUrl}/tx/${deploymentTransactionHash}`,
  },
  payment: {
    transactionHash: paymentTransactionHash,
    amount: instruction.amount,
    amountMicroUsdc: amountMicroUsdc.toString(),
    payer: instruction.payer,
    beneficiary: instruction.beneficiary,
    instructionId: verifiedReceipt.instructionId,
    contentHash: verifiedReceipt.contentHash,
    blockNumber: verifiedReceipt.blockNumber,
    blockHash: verifiedReceipt.blockHash,
    timestamp: verifiedReceipt.timestamp,
    duplicateFlag: true,
    independentlyRpcVerified: true,
    explorerUrl: `${explorerUrl}/tx/${paymentTransactionHash}`,
  },
  claims: {
    privateKeyRead: false,
    signerInvoked: false,
    customerFunds: false,
    securityAudit: false,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
