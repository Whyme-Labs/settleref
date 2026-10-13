import { address, assertPayable, commitments, hash, nativeAmount, object, sha256 } from "./domain.js";
import type { Address, Hash, Instruction } from "./domain.js";

// Static ABI only. CI checks these selectors against solc's method identifiers.
export const SELECTORS = { settle: "0x355b5dd4", settled: "0x86efd7ea", max: "0xb1c1008c" };
export const SETTLED_TOPIC = "0x62d217e5449ea37cc82d49f6ade136c256d3a8c81b72e30bcd42cd6f611cf876";
export interface Transport { request(method: string, params: unknown[]): Promise<unknown> }
export interface Wallet { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
export interface Deployment {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  contractAddress: Address | null;
  runtimeCodeSha256: Hash | null;
  writesEnabled: boolean;
}
export interface VerifiedReceipt {
  schema: "settleref.receipt.v1";
  kind: "rpc-verified";
  chainId: number;
  contractAddress: Address;
  transactionHash: Hash;
  blockHash: Hash;
  blockNumber: string;
  timestamp: number;
  instructionId: Hash;
  contentHash: Hash;
  payer: Address;
  beneficiary: Address;
  amount: string;
  asset: "USDC";
  reference: string;
}
export function hexQuantity(value: bigint): string { return `0x${value.toString(16)}`; }
function hexData(value: unknown): string {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) throw new Error("Malformed RPC byte data.");
  return value.toLowerCase();
}
export function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) throw new Error("Malformed RPC quantity.");
  return BigInt(value);
}
export function word(value: bigint | string): string {
  const text = typeof value === "bigint" ? value.toString(16) : value.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{1,64}$/.test(text)) throw new Error("ABI word is out of range.");
  return text.toLowerCase().padStart(64, "0");
}
export async function encodeSettlement(i: Instruction): Promise<string> {
  const c = await commitments(i);
  return SELECTORS.settle + [c.instructionId, i.beneficiary, nativeAmount(i), c.contentHash, BigInt(i.expiresAt)].map(word).join("");
}
export function parseDeployment(value: unknown): Deployment {
  const v = object(value, "Deployment");
  if (v.chainId !== 5042 && v.chainId !== 5042002 && v.chainId !== 31337) throw new Error("Unsupported deployment chain.");
  if (typeof v.rpcUrl !== "string" || typeof v.explorerUrl !== "string" || typeof v.writesEnabled !== "boolean") throw new Error("Invalid deployment settings.");
  const rpc = new URL(v.rpcUrl), explorer = new URL(v.explorerUrl);
  const localRpc = v.chainId === 31337 && ["localhost", "127.0.0.1"].includes(rpc.hostname);
  if ((rpc.protocol !== "https:" && !localRpc) || explorer.protocol !== "https:") throw new Error("Use HTTPS for public network endpoints.");
  const contractAddress = v.contractAddress === null ? null : address(v.contractAddress);
  const runtimeCodeSha256 = v.runtimeCodeSha256 === null ? null : hash(v.runtimeCodeSha256);
  if (v.writesEnabled && (!contractAddress || !runtimeCodeSha256)) throw new Error("Writes require a deployment address and pinned runtime bytecode hash.");
  return { chainId: v.chainId, rpcUrl: rpc.href, explorerUrl: explorer.href.replace(/\/$/, ""), contractAddress, runtimeCodeSha256, writesEnabled: v.writesEnabled };
}
export function httpTransport(url: string): Transport {
  let id = 0;
  return { async request(method, params) {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}. Payment status is not established.`);
    const data = object(await response.json(), "RPC response");
    if (data.error) {
      const err = object(data.error, "RPC error");
      throw new Error(typeof err.message === "string" ? err.message : "RPC rejected the request.");
    }
    if (!("result" in data)) throw new Error("RPC returned no result.");
    return data.result;
  } };
}
export async function requireDeployment(rpc: Transport, d: Deployment): Promise<Address> {
  if (!d.contractAddress || !d.runtimeCodeSha256) throw new Error("No verified contract deployment is configured. Live payments are disabled.");
  if (quantity(await rpc.request("eth_chainId", [])) !== BigInt(d.chainId)) throw new Error("RPC network does not match the configured chain.");
  const code = hexData(await rpc.request("eth_getCode", [d.contractAddress, "latest"]));
  // Hash the normalized hexadecimal bytecode string, not an ambiguous binary encoding.
  if (code === "0x" || await sha256(code) !== d.runtimeCodeSha256) throw new Error("Contract runtime does not match the trusted deployment. Refusing to proceed.");
  return d.contractAddress;
}
export async function isSettled(rpc: Transport, contract: Address, i: Instruction): Promise<boolean> {
  const c = await commitments(i);
  const data = SELECTORS.settled + word(i.payer) + word(c.instructionId);
  const result = hexData(await rpc.request("eth_call", [{ to: contract, data }, "latest"]));
  if (result !== `0x${word(0n)}` && result !== `0x${word(1n)}`) throw new Error("Unexpected duplicate-check result.");
  return result === `0x${word(1n)}`;
}
export async function checkDuplicate(rpc: Transport, d: Deployment, i: Instruction): Promise<boolean> {
  if (i.chainId !== d.chainId) throw new Error("Instruction chain does not match deployment.");
  const contract = await requireDeployment(rpc, d);
  return isSettled(rpc, contract, i);
}
export async function sendPayment(wallet: Wallet, rpc: Transport, d: Deployment, i: Instruction): Promise<Hash> {
  assertPayable(i);
  if (!d.writesEnabled) throw new Error("Live payments are disabled in this build.");
  if (i.chainId !== d.chainId) throw new Error("Instruction chain does not match deployment.");
  const contract = await requireDeployment(rpc, d);
  if (i.beneficiary === contract) throw new Error("The settlement contract cannot be the beneficiary.");
  if (await isSettled(rpc, contract, i)) throw new Error("Duplicate blocked: this payer already settled this instruction.");
  const accounts = await wallet.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || address(accounts[0]) !== i.payer) throw new Error("Connected wallet is not the instruction's payer.");
  if (quantity(await wallet.request({ method: "eth_chainId" })) !== BigInt(i.chainId)) throw new Error("Switch your wallet to the instruction's network.");
  const data = await encodeSettlement(i);
  const tx = { from: i.payer, to: contract, data, value: hexQuantity(nativeAmount(i)) };
  // Read-only simulation. No automatic retries of eth_sendTransaction.
  await rpc.request("eth_call", [tx, "latest"]);
  const estimate = quantity(await rpc.request("eth_estimateGas", [tx]));
  const gas = estimate * 12n / 10n + 1000n;
  if (gas > 300000n) throw new Error("Unexpected gas estimate. Refusing this demo payment.");
  const suggested = quantity(await rpc.request("eth_gasPrice", []));
  const maxFee = suggested * 2n > 20000000000n ? suggested * 2n : 20000000000n;
  if (maxFee * gas > 100000000000000000n) throw new Error("Estimated maximum fee exceeds the 0.10 USDC demo safety limit.");
  const balance = quantity(await rpc.request("eth_getBalance", [i.payer, "latest"]));
  if (balance < nativeAmount(i) + gas * maxFee) throw new Error("Insufficient USDC for payment plus the maximum gas fee.");
  return hash(await wallet.request({ method: "eth_sendTransaction", params: [{
    ...tx, chainId: hexQuantity(BigInt(i.chainId)), gas: hexQuantity(gas),
    maxFeePerGas: hexQuantity(maxFee), maxPriorityFeePerGas: "0x0",
  }] }));
}
export async function verifyPayment(rpc: Transport, d: Deployment, i: Instruction, txHash: Hash): Promise<VerifiedReceipt> {
  if (d.chainId !== i.chainId) throw new Error("Instruction belongs to another network.");
  const contract = await requireDeployment(rpc, d);
  const result = await rpc.request("eth_getTransactionReceipt", [txHash]);
  if (result === null) throw new Error("Receipt not found. The transaction may be pending or dropped. Do not resend with a new instruction ID.");
  const receipt = object(result, "Receipt");
  if (receipt.status !== "0x1") throw new Error("Transaction did not succeed. No settled receipt can be issued.");
  if (hash(receipt.transactionHash) !== txHash) throw new Error("Receipt transaction hash mismatch.");
  if (address(receipt.to) !== contract || address(receipt.from) !== i.payer) throw new Error("Receipt sender or target mismatch.");
  const tx = object(await rpc.request("eth_getTransactionByHash", [txHash]), "Transaction");
  if (hash(tx.hash) !== txHash || address(tx.from) !== i.payer || address(tx.to) !== contract || quantity(tx.value) !== nativeAmount(i)) throw new Error("Transaction does not match the payment instruction.");
  if (hexData(tx.input) !== await encodeSettlement(i)) throw new Error("Transaction calldata does not match the committed instruction.");
  const c = await commitments(i);
  if (!Array.isArray(receipt.logs)) throw new Error("Receipt has no valid log list.");
  const matches = receipt.logs.filter((raw: unknown) => {
    const log = object(raw, "Log");
    return typeof log.address === "string" && log.address.toLowerCase() === contract && Array.isArray(log.topics) && log.topics[0] === SETTLED_TOPIC;
  });
  if (matches.length !== 1) throw new Error("Expected exactly one settlement event from the trusted contract.");
  const event = object(matches[0], "Settlement event");
  const expectedTopics = [SETTLED_TOPIC, `0x${word(i.payer)}`, c.instructionId, `0x${word(i.beneficiary)}`];
  if (!Array.isArray(event.topics) || event.topics.length !== 4 || event.topics.some((t: unknown, n: number) => hash(t) !== expectedTopics[n])) throw new Error("Settlement event parties or identity do not match.");
  if (hexData(event.data) !== "0x" + [nativeAmount(i), c.contentHash, BigInt(i.expiresAt)].map(word).join("")) throw new Error("Settlement event amount or content does not match.");
  const blockNumber = quantity(receipt.blockNumber);
  const blockHash = hash(receipt.blockHash);
  const block = object(await rpc.request("eth_getBlockByNumber", [hexQuantity(blockNumber), false]), "Block");
  if (hash(block.hash) !== blockHash || quantity(block.number) !== blockNumber) throw new Error("Receipt block is not canonical according to this RPC.");
  if (hash(tx.blockHash) !== blockHash || quantity(tx.blockNumber) !== blockNumber) throw new Error("Transaction block does not match receipt.");
  const timestamp = quantity(block.timestamp);
  if (timestamp >= BigInt(i.expiresAt) || timestamp > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Settlement timestamp is invalid.");
  return {
    schema: "settleref.receipt.v1", kind: "rpc-verified", chainId: d.chainId,
    contractAddress: contract, transactionHash: txHash, blockHash, blockNumber: blockNumber.toString(), timestamp: Number(timestamp),
    instructionId: c.instructionId, contentHash: c.contentHash, payer: i.payer, beneficiary: i.beneficiary,
    amount: i.amount, asset: "USDC", reference: i.reference,
  };
}
