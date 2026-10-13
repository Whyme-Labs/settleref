// Run only after the contract has been compiled, tested and deployed by its owner.
import { readFile, writeFile } from 'node:fs/promises';
import { address, sha256 } from '../public/app/domain.js';
import { httpTransport, quantity } from '../public/app/chain.js';

const contractAddress = address(process.argv[2]);
const chainId = Number(process.argv[3] ?? 5042002);
if (![5042, 5042002].includes(chainId)) {
  throw new Error('Use Arc mainnet 5042 or Arc testnet 5042002.');
}

const isMainnet = chainId === 5042;
const rpcUrl = isMainnet
  ? process.env.ARC_MAINNET_RPC_URL ?? 'https://rpc.mainnet.arc.io'
  : process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.network';
const explorerUrl = isMainnet
  ? process.env.ARC_MAINNET_EXPLORER_URL ?? 'https://explorer.arc.io'
  : process.env.ARC_TESTNET_EXPLORER_URL ?? 'https://explorer.testnet.arc.io';
const outputPath = process.env.DEPLOYMENT_CONFIG_PATH ?? 'public/deployment.json';

const rpc = httpTransport(rpcUrl);
if (quantity(await rpc.request('eth_chainId', [])) !== BigInt(chainId)) {
  throw new Error('RPC returned the wrong chain.');
}

const artifact = JSON.parse(
  await readFile('out/SettleRef.sol/SettleRef.json', 'utf8'),
);
let expected = artifact.deployedBytecode.object.toLowerCase();
if (!expected.startsWith('0x')) expected = `0x${expected}`;
const remoteValue = await rpc.request('eth_getCode', [contractAddress, 'latest']);
if (typeof remoteValue !== 'string') {
  throw new Error('RPC returned malformed runtime bytecode.');
}
const remote = remoteValue.toLowerCase();
if (remote === '0x' || remote !== expected) {
  throw new Error(
    'Onchain runtime differs from the locally compiled artifact. Do not enable payments.',
  );
}

const runtimeCodeSha256 = await sha256(remote);
const config = {
  chainId,
  rpcUrl,
  explorerUrl,
  contractAddress,
  runtimeCodeSha256,
  writesEnabled: false,
};
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      status: 'PINNED_WRITES_DISABLED',
      outputPath,
      chainId,
      rpcUrl,
      explorerUrl,
      contractAddress,
      runtimeBytes: (remote.length - 2) / 2,
      runtimeCodeSha256,
      writesEnabled: false,
    },
    null,
    2,
  ),
);
