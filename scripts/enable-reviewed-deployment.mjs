// Enable browser writes only after rechecking the pinned deployment against Arc RPC.
//
// Testnet:
//   CONFIRM_ENABLE_WRITES=ENABLE_OWNER_TESTNET_WRITES \
//     node scripts/enable-reviewed-deployment.mjs testnet
//
// Mainnet:
//   CONFIRM_ENABLE_WRITES=ENABLE_CAPPED_MAINNET_WRITES \
//     node scripts/enable-reviewed-deployment.mjs mainnet
//
// Run `npm run build` first so `public/app` contains the reviewed TypeScript output.
import { readFile, writeFile } from 'node:fs/promises';
import {
  SELECTORS,
  httpTransport,
  parseDeployment,
  requireDeployment,
} from '../public/app/chain.js';

const network = process.argv[2];
if (network !== 'testnet' && network !== 'mainnet') {
  throw new Error('Network must be testnet or mainnet.');
}

const expectedChainId = network === 'testnet' ? 5_042_002 : 5_042;
const requiredConfirmation =
  network === 'testnet'
    ? 'ENABLE_OWNER_TESTNET_WRITES'
    : 'ENABLE_CAPPED_MAINNET_WRITES';
if (process.env.CONFIRM_ENABLE_WRITES !== requiredConfirmation) {
  throw new Error(
    `Writes remain disabled. Set CONFIRM_ENABLE_WRITES=${requiredConfirmation} only after owner review.`,
  );
}

const configPath = process.env.DEPLOYMENT_CONFIG_PATH ?? 'public/deployment.json';
const raw = JSON.parse(await readFile(configPath, 'utf8'));
const deployment = parseDeployment(raw);
if (deployment.chainId !== expectedChainId) {
  throw new Error(
    `Deployment chain ${deployment.chainId} does not match requested ${network}.`,
  );
}
if (deployment.writesEnabled) {
  throw new Error('Writes are already enabled. Refusing an ambiguous second enable operation.');
}

const rpc = httpTransport(deployment.rpcUrl);
const contractAddress = await requireDeployment(rpc, deployment);
const maxValue = await rpc.request('eth_call', [
  { to: contractAddress, data: SELECTORS.max },
  'latest',
]);
if (typeof maxValue !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(maxValue)) {
  throw new Error('Contract returned a malformed MAX_PAYMENT value.');
}
const maxNative = BigInt(maxValue);
if (maxNative !== 1_000_000_000_000_000_000n) {
  throw new Error(
    `Unexpected contract cap ${maxNative}. Expected exactly one native USDC.`,
  );
}

const enabled = {
  chainId: deployment.chainId,
  rpcUrl: deployment.rpcUrl,
  explorerUrl: deployment.explorerUrl,
  contractAddress: deployment.contractAddress,
  runtimeCodeSha256: deployment.runtimeCodeSha256,
  writesEnabled: true,
};
await writeFile(configPath, `${JSON.stringify(enabled, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      status: 'WRITES_ENABLED_AFTER_REVIEW',
      network,
      configPath,
      chainId: enabled.chainId,
      contractAddress: enabled.contractAddress,
      runtimeCodeSha256: enabled.runtimeCodeSha256,
      maxNative: maxNative.toString(),
      writesEnabled: true,
    },
    null,
    2,
  ),
);
