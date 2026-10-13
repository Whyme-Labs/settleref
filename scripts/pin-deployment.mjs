// Run only after the contract has been compiled, tested and deployed by its owner.
import { readFile, writeFile } from 'node:fs/promises';
import { address, sha256 } from '../public/app/domain.js';
import { httpTransport, quantity } from '../public/app/chain.js';
const contractAddress = address(process.argv[2]);
const chainId = Number(process.argv[3] ?? 5042002);
if (![5042,5042002].includes(chainId)) throw new Error('Use Arc mainnet 5042 or testnet 5042002.');
const rpcUrl = chainId === 5042 ? 'https://rpc.mainnet.arc.io' : 'https://rpc.testnet.arc.io';
const explorerUrl = chainId === 5042 ? 'https://explorer.arc.io' : 'https://explorer.testnet.arc.io';
const rpc = httpTransport(rpcUrl);
if (quantity(await rpc.request('eth_chainId',[])) !== BigInt(chainId)) throw new Error('RPC returned the wrong chain.');
const artifact = JSON.parse(await readFile('out/SettleRef.sol/SettleRef.json','utf8'));
const expected = artifact.deployedBytecode.object.toLowerCase();
const remote = await rpc.request('eth_getCode',[contractAddress,'latest']);
if (typeof remote !== 'string' || remote === '0x' || remote.toLowerCase() !== expected) throw new Error('Onchain runtime differs from the locally compiled artifact. Do not enable payments.');
const config = { chainId, rpcUrl, explorerUrl, contractAddress, runtimeCodeSha256: await sha256(remote.toLowerCase()), writesEnabled: false };
await writeFile('public/deployment.json',JSON.stringify(config,null,2)+'\n');
console.log('Runtime matches the compiled artifact. Pinned configuration saved; writes remain disabled until the owner enables them.');
