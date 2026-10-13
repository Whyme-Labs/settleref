import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const endpoints = [
  {
    name: "arc-testnet-current",
    rpcUrl: "https://rpc.testnet.arc.network",
    expectedChainId: 5_042_002,
  },
  {
    name: "arc-testnet-legacy",
    rpcUrl: "https://rpc.testnet.arc.io",
    expectedChainId: 5_042_002,
  },
  {
    name: "arc-mainnet-current",
    rpcUrl: "https://rpc.mainnet.arc.network",
    expectedChainId: 5_042,
  },
  {
    name: "arc-mainnet-legacy",
    rpcUrl: "https://rpc.mainnet.arc.io",
    expectedChainId: 5_042,
  },
];

const explorerCandidates = [
  "https://testnet.arcscan.app",
  "https://arcscan.app",
  "https://explorer.arc.io",
];

const USDC_SYSTEM_ADDRESS = "0x3600000000000000000000000000000000000000";

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "SettleRef-SR03-Preflight/1.0",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  const body = JSON.parse(text);
  if (body.error) {
    throw new Error(`RPC ${method}: ${JSON.stringify(body.error).slice(0, 240)}`);
  }
  if (!("result" in body)) {
    throw new Error(`RPC ${method} returned no result`);
  }
  return body.result;
}

function hexNumber(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Invalid RPC quantity ${JSON.stringify(value)}`);
  }
  return Number(BigInt(value));
}

async function probeRpc(endpoint) {
  const started = Date.now();
  try {
    const chainHex = await rpc(endpoint.rpcUrl, "eth_chainId");
    const chainId = hexNumber(chainHex);
    const blockHex = await rpc(endpoint.rpcUrl, "eth_blockNumber");
    const blockNumber = hexNumber(blockHex);
    const [clientVersion, gasPriceHex, latestBlock, usdcCode] = await Promise.all([
      rpc(endpoint.rpcUrl, "web3_clientVersion"),
      rpc(endpoint.rpcUrl, "eth_gasPrice"),
      rpc(endpoint.rpcUrl, "eth_getBlockByNumber", [blockHex, false]),
      rpc(endpoint.rpcUrl, "eth_getCode", [USDC_SYSTEM_ADDRESS, "latest"]),
    ]);
    const timestamp = latestBlock && typeof latestBlock.timestamp === "string"
      ? hexNumber(latestBlock.timestamp)
      : null;
    const code = typeof usdcCode === "string" ? usdcCode.toLowerCase() : "";
    return {
      ...endpoint,
      reachable: true,
      matchesExpectedChain: chainId === endpoint.expectedChainId,
      chainId,
      blockNumber,
      latestBlockTimestamp: timestamp,
      latestBlockIso: timestamp === null ? null : new Date(timestamp * 1000).toISOString(),
      gasPrice: BigInt(gasPriceHex).toString(),
      clientVersion: typeof clientVersion === "string" ? clientVersion : null,
      usdcSystemAddress: USDC_SYSTEM_ADDRESS,
      usdcRuntimeBytes: /^0x[0-9a-f]*$/.test(code) ? (code.length - 2) / 2 : null,
      usdcRuntimeHexSha256: /^0x[0-9a-f]+$/.test(code)
        ? `0x${createHash("sha256").update(code).digest("hex")}`
        : null,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ...endpoint,
      reachable: false,
      matchesExpectedChain: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started,
    };
  }
}

async function probeExplorer(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "SettleRef-SR03-Preflight/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    return {
      url,
      reachable: response.ok,
      status: response.status,
      finalUrl: response.url,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      url,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started,
    };
  }
}

const rpcResults = await Promise.all(endpoints.map(probeRpc));
const explorerResults = await Promise.all(explorerCandidates.map(probeExplorer));
const activeTestnet = rpcResults.filter(
  (entry) => entry.reachable && entry.chainId === 5_042_002,
);
const activeMainnet = rpcResults.filter(
  (entry) => entry.reachable && entry.chainId === 5_042,
);

if (activeTestnet.length === 0) {
  throw new Error("No candidate Arc testnet RPC returned chain 5042002.");
}

const report = {
  schema: "settleref.sr03-network-probe.v1",
  generatedAt: new Date().toISOString(),
  sourceCommit: process.env.GITHUB_SHA ?? null,
  rpcResults,
  explorerResults,
  conclusions: {
    testnetReachable: true,
    preferredTestnetRpc: activeTestnet[0].rpcUrl,
    mainnetReachable: activeMainnet.length > 0,
    preferredMainnetRpc: activeMainnet[0]?.rpcUrl ?? null,
    signingPerformed: false,
    transactionSubmitted: false,
  },
};

await mkdir("evidence/sr03", { recursive: true });
await writeFile(
  "evidence/sr03/network-probe.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report.conclusions, null, 2));
