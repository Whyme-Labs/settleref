import { address, commitments, csvCell, hash, makeExample, object, parseInstruction } from "./domain.js";
import type { Instruction } from "./domain.js";
import { checkDuplicate, httpTransport, parseDeployment, sendPayment, verifyPayment } from "./chain.js";
import type { Deployment, VerifiedReceipt, Wallet } from "./chain.js";

function el(id: string): HTMLElement { const v = document.getElementById(id); if (!v) throw new Error(`Missing ${id}`); return v; }
function input(id: string): HTMLInputElement { const v = el(id); if (!(v instanceof HTMLInputElement)) throw new Error(`Invalid input ${id}`); return v; }
function button(id: string): HTMLButtonElement { const v = el(id); if (!(v instanceof HTMLButtonElement)) throw new Error(`Invalid button ${id}`); return v; }
function text(id: string, value: string): void { el(id).textContent = value; }
function message(value: string, kind = ""): void { text("status", value); el("status").className = `status ${kind}`; }
function provider(): Wallet {
  if (!("ethereum" in window)) throw new Error("No browser wallet found. Open this app in your wallet browser or install an EVM wallet.");
  const candidate = object(window.ethereum, "Wallet");
  if (typeof candidate.request !== "function") throw new Error("Wallet does not implement EIP-1193.");
  return candidate as unknown as Wallet;
}
let mode: "demo" | "live" = "demo";
let deployment: Deployment | null = null;
let draft = makeExample();
let reviewed: Instruction | null = null;
let receipt: VerifiedReceipt | null = null;
let simulated = false;
let simulatedVerified = false;
const demoLedger = new Set<string>();
let busy = false;
function sync(): void {
  button("pay").disabled = busy || !reviewed || !input("confirm").checked || (mode === "live" && !deployment?.writesEnabled);
  button("retry").disabled = busy || !reviewed || (!simulated && mode === "demo");
  button("verify-button").disabled = busy || !reviewed || (mode === "demo" && !simulated);
  button("export-instruction").disabled = busy || !reviewed;
  button("export-receipt").disabled = busy || (!receipt && !simulatedVerified);
  button("export-csv").disabled = busy || (!receipt && !simulatedVerified);
  input("confirm").disabled = busy || !reviewed;
  button("connect").hidden = mode !== "live";
  button("pay").textContent = mode === "demo" ? "Simulate settlement" : "Sign and pay USDC";
}
async function run(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  document.querySelectorAll("button,input").forEach(v => { if (v instanceof HTMLButtonElement || v instanceof HTMLInputElement) v.disabled = true; });
  try { await action(); } catch (error) { message(error instanceof Error ? error.message : "Operation failed. No successful settlement has been established.", "error"); }
  finally {
    busy = false; document.body.classList.remove("busy");
    document.querySelectorAll("button,input").forEach(v => { if (v instanceof HTMLButtonElement || v instanceof HTMLInputElement) v.disabled = false; });
    sync();
  }
}
function download(name: string, content: string, mime = "application/json"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function clearProgress(): void {
  receipt = null; simulated = false; simulatedVerified = false;
  input("confirm").checked = false;
  ["t-review", "t-settle", "t-duplicate", "t-verify"].forEach(id => el(id).classList.remove("complete"));
  el("receipt-result").hidden = true; text("receipt-status", "Not verified");
  text("settlement-status", "Awaiting review");
}
function load(i: Instruction): void {
  draft = i; reviewed = null; clearProgress();
  input("reference").value = i.reference; input("amount").value = i.amount;
  input("payer").value = i.payer; input("beneficiary").value = i.beneficiary; input("instruction-id").value = i.endToEndId;
  const date = new Date(i.expiresAt * 1000);
  input("expiry").value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  text("payment-summary", "Review an instruction before making a payment."); sync();
}
function current(): Instruction {
  // Preserve imported expiry seconds unless the displayed minute was actually edited.
  const shown = new Date(draft.expiresAt * 1000);
  const original = new Date(shown.getTime() - shown.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  const expiresAt = input("expiry").value === original ? draft.expiresAt : Math.floor(new Date(input("expiry").value).getTime() / 1000);
  return parseInstruction({ ...draft, reference: input("reference").value, amount: input("amount").value, payer: input("payer").value, beneficiary: input("beneficiary").value, endToEndId: input("instruction-id").value, expiresAt });
}
async function review(): Promise<void> {
  reviewed = current(); draft = reviewed; clearProgress();
  sessionStorage.setItem("settleref.instruction", JSON.stringify(reviewed));
  const c = await commitments(reviewed);
  const box = document.createElement("div"); box.className = "payment-box";
  const amount = document.createElement("div"); amount.className = "big"; amount.textContent = `${reviewed.amount.replace(/0+$/, "").replace(/\.$/, "")} `;
  const asset = document.createElement("small"); asset.textContent = "USDC"; amount.append(asset); box.append(amount);
  const dl = document.createElement("dl");
  for (const [label, value] of [["Reference", reviewed.reference], ["Payer", reviewed.payer], ["Beneficiary", reviewed.beneficiary], ["Identity", c.instructionId], ["Content", c.contentHash]]) {
    const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label ?? ""; dd.textContent = value ?? ""; dd.className = "mono"; dl.append(dt,dd);
  }
  box.append(dl); el("payment-summary").replaceChildren(box); el("t-review").classList.add("complete");
  text("settlement-status", "Ready to review & sign");
  message("Instruction reviewed. Export it before payment so the recipient can independently reconcile the receipt.", "success");
}
async function setMode(next: "demo" | "live"): Promise<void> {
  mode = next; reviewed = null; clearProgress();
  for (const [id, active] of [["mode-demo", next === "demo"], ["mode-live", next === "live"]] satisfies [string, boolean][]) {
    button(id).classList.toggle("selected", active); button(id).setAttribute("aria-pressed", String(active));
  }
  text("mode-help", next === "demo" ? "No wallet needed. No money moves. This is not onchain evidence." : "Real USDC. Your wallet signs. Review the beneficiary and network carefully.");
  const disabled = next === "live" && !deployment?.writesEnabled;
  el("deployment-notice").hidden = !disabled;
  text("deployment-notice", "Live payments are disabled. A deployed contract, pinned bytecode and mainnet verification evidence are still required.");
  text("payment-summary", "Review the instruction again after switching modes.");
  message(next === "demo" ? "Local walkthrough selected. No blockchain transaction will be submitted." : "Arc payment mode selected. No funds have moved.");
}
async function parseFile(id: string): Promise<unknown> {
  const file = input(id).files?.[0];
  if (!file) throw new Error("Choose a JSON file.");
  if (file.size > 65536) throw new Error("File too large. Use a JSON instruction or receipt smaller than 64 KB.");
  return JSON.parse(await file.text());
}
function showReceipt(): void {
  const container = el("receipt-result"); container.replaceChildren(); container.hidden = false;
  const heading = document.createElement("strong");
  heading.textContent = receipt ? "Receipt reconciled against Arc RPC" : "Simulation reconciled. Not onchain evidence.";
  const detail = document.createElement("p"); detail.textContent = receipt ? `Verified ${receipt.amount} USDC at block ${receipt.blockNumber}. Sender, recipient, amount, identity, commitment and canonical block match.` : "The local model matched the original instruction and simulated payment. No blockchain receipt exists.";
  container.append(heading, detail);
  if (receipt && deployment) {
    const link = document.createElement("a"); link.href = `${deployment.explorerUrl}/tx/${receipt.transactionHash}`; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open transaction in explorer"; container.append(link);
  }
  text("receipt-status", receipt ? "RPC verified" : "Simulation only"); el("t-verify").classList.add("complete");
}
button("load-sample").addEventListener("click", () => { if (busy) return; load(makeExample(deployment?.chainId ?? 5042)); input("tx-hash").value = ""; message("Fresh example loaded with a new instruction ID. These are dummy wallet addresses."); });
button("mode-demo").addEventListener("click", () => void run(() => setMode("demo")));
button("mode-live").addEventListener("click", () => void run(() => setMode("live")));
el("instruction-form").addEventListener("submit", e => { e.preventDefault(); void run(review); });
el("instruction-form").addEventListener("input", () => { reviewed = null; clearProgress(); sync(); });
input("confirm").addEventListener("change", sync);
input("instruction-file").addEventListener("change", () => void run(async () => { load(parseInstruction(await parseFile("instruction-file"))); input("tx-hash").value = ""; message("Instruction imported without changing its identity. Review the details."); }));
button("export-instruction").addEventListener("click", () => { if (reviewed) download("settleref-instruction.json", JSON.stringify(reviewed, null, 2)); });
button("connect").addEventListener("click", () => void run(async () => {
  const wallet = provider(); const accounts = await wallet.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || !accounts.length) throw new Error("No wallet account was authorized.");
  message(`Connected ${address(accounts[0])}. The payer instruction is not modified. Select chain ${deployment?.chainId ?? 5042} in your wallet.`, "success");
}));
button("pay").addEventListener("click", () => void run(async () => {
  if (!reviewed || !input("confirm").checked) throw new Error("Review and confirm the payment first.");
  const i = reviewed; const c = await commitments(i);
  if (mode === "demo") {
    const key = `${i.payer}:${c.instructionId}`;
    if (demoLedger.has(key)) throw new Error("Duplicate blocked by the local model. No second simulated transfer.");
    demoLedger.add(key); simulated = true; input("tx-hash").value = "";
    text("settlement-status", "Simulated only"); message("Simulated settlement complete. No funds moved. Now test the duplicate and reconcile.", "success");
  } else {
    if (!deployment) throw new Error("Deployment configuration is unavailable.");
    message("Waiting for wallet confirmation. This sends real USDC if you approve it.");
    const txHash = await sendPayment(provider(), httpTransport(deployment.rpcUrl), deployment, i);
    input("tx-hash").value = txHash; sessionStorage.setItem("settleref.pending", JSON.stringify({ endToEndId: i.endToEndId, transactionHash: txHash }));
    text("settlement-status", "Submitted; verify receipt"); message("Transaction submitted, not yet verified. The hash is saved in this tab. Check the receipt before retrying.");
  }
  el("t-settle").classList.add("complete");
}));
button("retry").addEventListener("click", () => void run(async () => {
  if (!reviewed) throw new Error("Review an instruction first.");
  const c = await commitments(reviewed);
  const blocked = mode === "demo" ? demoLedger.has(`${reviewed.payer}:${c.instructionId}`) : deployment ? await checkDuplicate(httpTransport(deployment.rpcUrl), deployment, reviewed) : false;
  if (!blocked) throw new Error("No settled flag found. This does not establish whether a payment is currently pending.");
  el("t-duplicate").classList.add("complete"); message(mode === "demo" ? "Duplicate rejected by the local model. One simulated payment, never two." : "Onchain settled flag is true. The contract rejects another execution with this payer and instruction ID.", "success");
}));
button("verify-button").addEventListener("click", () => void run(async () => {
  if (!reviewed) throw new Error("Import and review the original instruction first.");
  if (mode === "demo") { if (!simulated) throw new Error("Run the local settlement first."); simulatedVerified = true; }
  else {
    if (!deployment) throw new Error("No deployment configuration.");
    receipt = await verifyPayment(httpTransport(deployment.rpcUrl), deployment, reviewed, hash(input("tx-hash").value));
    text("settlement-status", "Settled & verified"); sessionStorage.removeItem("settleref.pending"); el("t-settle").classList.add("complete");
  }
  showReceipt(); message(receipt ? "Payment reconciled against the configured Arc RPC." : "Walkthrough complete. Simulation is not a mainnet deployment or submission proof.", "success");
}));
input("receipt-file").addEventListener("change", () => void run(async () => {
  const bundle = object(await parseFile("receipt-file"), "Receipt bundle");
  if (bundle.schema !== "settleref.bundle.v1") throw new Error("Only real receipt bundles can be imported for RPC verification. Simulations are not accepted.");
  const i = parseInstruction(bundle.instruction), txHash = hash(bundle.transactionHash);
  await setMode("live"); load(i); input("tx-hash").value = txHash; await review();
  message("Receipt bundle imported. Claimed receipt fields are not trusted. Press Verify receipt to check the configured chain.");
}));
button("export-receipt").addEventListener("click", () => {
  if (!reviewed) return;
  if (receipt) download("settleref-receipt.json", JSON.stringify({ schema: "settleref.bundle.v1", instruction: reviewed, transactionHash: receipt.transactionHash, receipt }, null, 2));
  else if (simulatedVerified) download("settleref-SIMULATION.json", JSON.stringify({ schema: "settleref.simulation.v1", warning: "SIMULATION ONLY. No money moved. Not onchain evidence.", instruction: reviewed }, null, 2));
});
button("export-csv").addEventListener("click", () => {
  if (!reviewed || (!receipt && !simulatedVerified)) return;
  const rows = [["status", "reference", "endToEndId", "asset", "amount", "payer", "beneficiary", "chainId", "transactionHash", "blockNumber"], [receipt ? "RPC_VERIFIED" : "SIMULATION_NOT_ONCHAIN", reviewed.reference, reviewed.endToEndId, "USDC", reviewed.amount, reviewed.payer, reviewed.beneficiary, String(reviewed.chainId), receipt?.transactionHash ?? "", receipt?.blockNumber ?? ""]];
  download("settleref-reconciliation.csv", rows.map(r => r.map(csvCell).join(",")).join("\r\n"), "text/csv");
});
async function start(): Promise<void> {
  try {
    const response = await fetch("/deployment.json", { cache: "no-store" }); if (!response.ok) throw new Error("Configuration unavailable.");
    deployment = parseDeployment(await response.json());
    text("network-chip", `${deployment.chainId === 5042 ? "Arc mainnet" : deployment.chainId === 5042002 ? "Arc testnet" : "Local EVM"} · ${deployment.contractAddress ? "Configured" : "Not deployed"}`);
    text("deployment-footer", deployment.contractAddress ? `Contract ${deployment.contractAddress}` : "Not deployed to Arc mainnet.");
  } catch (error) { deployment = null; message(error instanceof Error ? error.message : "Configuration failed. Live mode is disabled.", "error"); }
  try {
    const saved = sessionStorage.getItem("settleref.instruction");
    load(saved ? parseInstruction(JSON.parse(saved)) : makeExample(deployment?.chainId ?? 5042));
    const pendingRaw = sessionStorage.getItem("settleref.pending");
    if (pendingRaw) { const pending = object(JSON.parse(pendingRaw)); if (pending.endToEndId === draft.endToEndId) { input("tx-hash").value = hash(pending.transactionHash); message("A submitted payment exists in this tab. Switch to Arc payment mode, review the same instruction and verify the saved hash. Do not create a new ID."); } }
  } catch { load(makeExample(deployment?.chainId ?? 5042)); }
  sync();
}
void start();
