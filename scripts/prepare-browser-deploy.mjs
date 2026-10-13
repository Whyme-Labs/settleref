// Generates a localhost-only operator page. It never accesses a signing key.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const network = process.argv[2] ?? 'testnet';
if (!['testnet', 'mainnet'].includes(network)) throw new Error('Use testnet or mainnet.');
const mainnet = network === 'mainnet';
const foundryConfig = JSON.parse(execFileSync(process.env.FORGE_BIN ?? 'arc-forge', ['config', '--json'], {
  encoding: 'utf8', env: { ...process.env, FOUNDRY_PROFILE: 'arc' },
}));
if (foundryConfig.network !== 'arc' || String(foundryConfig.arc_hardfork ?? foundryConfig.hardfork).toLowerCase().replace(/^arc:/, '') !== 'zero8') {
  throw new Error('Owner deployment requires Arc Foundry with the Arc Zero8 profile.');
}
const artifact = JSON.parse(await readFile('out/SettleRef.sol/SettleRef.json', 'utf8'));
function bytecode(raw) {
  const value = (raw.startsWith('0x') ? raw : `0x${raw}`).toLowerCase();
  if (!/^0x(?:[0-9a-f]{2})+$/.test(value)) throw new Error('Missing or unlinked compiled bytecode. Compile the Arc profile first.');
  return value;
}
const creationBytecode = bytecode(artifact.bytecode.object);
const runtimeBytecode = bytecode(artifact.deployedBytecode.object);
const runtimeCodeSha256 = `0x${createHash('sha256').update(runtimeBytecode).digest('hex')}`;
if (mainnet) {
  if (process.env.CONFIRM_MAINNET !== 'DEPLOY_CAPPED_EXPERIMENT') throw new Error('Mainnet requires explicit owner confirmation.');
  const testnet = JSON.parse(await readFile('evidence/sr03/owner/testnet-verified.json', 'utf8'));
  if (testnet.status !== 'PASS' || testnet.network !== 'testnet' || testnet.chainId !== 5042002 ||
      testnet.contract.runtimeCodeSha256 !== runtimeCodeSha256 || !testnet.payment.independentlyRpcVerified) {
    throw new Error('Mainnet requires independently verified testnet payment evidence for this runtime.');
  }
}
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim()) {
  throw new Error('Commit the reviewed source before preparing an owner deployment.');
}
// The operator page must use the intended contract artifact.
if (artifact.metadata?.settings?.compilationTarget?.['contracts/SettleRef.sol'] !== 'SettleRef') {
  throw new Error('Unexpected contract artifact.');
}
await mkdir('dist/deploy', { recursive: true });
for (const file of ['browser-deploy.html', 'browser-deploy-page.mjs', 'browser-deploy-wallet.mjs']) {
  await cp(`scripts/${file}`, `dist/deploy/${file === 'browser-deploy.html' ? 'index.html' : file}`);
}
const config = {
  network, chainId: mainnet ? 5042 : 5042002, sourceCommit, creationBytecode, runtimeBytecode, runtimeCodeSha256,
  rpcUrl: mainnet ? 'https://rpc.mainnet.arc.io' : 'https://rpc.testnet.arc.network',
  explorerUrl: mainnet ? 'https://explorer.arc.io' : 'https://explorer.testnet.arc.io',
};
await writeFile('dist/deploy/config.json', JSON.stringify(config, null, 2) + '\n');
console.log(`Owner ${network} deployment ready at http://127.0.0.1:4173/deploy/index.html`);
console.log('Run node scripts/serve.mjs, then open that URL in your wallet browser.');
