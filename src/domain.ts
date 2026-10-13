export type Address = `0x${string}`;
export type Hash = `0x${string}`;
export interface Instruction {
  schema: "settleref.instruction.v1";
  chainId: number;
  endToEndId: string;
  payer: Address;
  beneficiary: Address;
  asset: "USDC";
  amount: string;
  reference: string;
  expiresAt: number;
  privacySalt: Hash;
}
export const MAX_MICROS = 1_000_000n;
export const NATIVE_PER_MICRO = 1_000_000_000_000n;
export const ALLOWED_CHAINS = [5042, 5042002, 31337];

export function object(value: unknown, label = "Value"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
export function address(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error("Use a nonzero, 20-byte wallet address.");
  }
  return value.toLowerCase() as Address;
}
export function hash(value: unknown): Hash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Expected a 32-byte hash.");
  return value.toLowerCase() as Hash;
}
export function micros(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/.test(value)) {
    throw new Error("Amount must be a decimal string with at most 6 decimal places. No rounding or exponent notation.");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (result <= 0n || result > MAX_MICROS) throw new Error("This experiment accepts 0.000001 to 1 USDC per payment.");
  return result;
}
export function parseInstruction(value: unknown): Instruction {
  const v = object(value, "Instruction");
  const keys = ["schema", "chainId", "endToEndId", "payer", "beneficiary", "asset", "amount", "reference", "expiresAt", "privacySalt"];
  if (Object.keys(v).some(k => !keys.includes(k))) throw new Error("Instruction contains unsupported fields.");
  if (v.schema !== "settleref.instruction.v1" || v.asset !== "USDC") throw new Error("Only SettleRef v1 USDC instructions are supported.");
  if (typeof v.chainId !== "number" || !ALLOWED_CHAINS.includes(v.chainId)) throw new Error("Unsupported chain ID.");
  if (typeof v.endToEndId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/.test(v.endToEndId)) {
    throw new Error("End-to-end ID must be 8 to 64 letters, numbers, dots, colons, underscores or hyphens.");
  }
  if (typeof v.reference !== "string" || v.reference.length < 1 || v.reference.length > 140 || /[\x00-\x1F\x7F]/.test(v.reference)) {
    throw new Error("Reference must be 1 to 140 characters without control characters.");
  }
  if (typeof v.expiresAt !== "number" || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= 0) throw new Error("Expiry must be a positive Unix timestamp in seconds.");
  const payer = address(v.payer), beneficiary = address(v.beneficiary);
  if (payer === beneficiary) throw new Error("Payer and beneficiary must be different wallets.");
  const units = micros(v.amount);
  const salt = hash(v.privacySalt);
  if (/^0x0{64}$/.test(salt)) throw new Error("Use a nonzero random privacy salt.");
  return {
    schema: "settleref.instruction.v1", chainId: v.chainId, endToEndId: v.endToEndId,
    payer, beneficiary, asset: "USDC",
    amount: `${units / 1_000_000n}.${(units % 1_000_000n).toString().padStart(6, "0")}`,
    reference: v.reference, expiresAt: v.expiresAt, privacySalt: salt,
  };
}
export function nativeAmount(i: Instruction): bigint { return micros(i.amount) * NATIVE_PER_MICRO; }
export async function sha256(text: string): Promise<Hash> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hash(`0x${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("")}`);
}
export async function commitments(i: Instruction): Promise<{ instructionId: Hash; contentHash: Hash }> {
  // Identity deliberately excludes amount, recipient, expiry and salt. Editing those fields
  // cannot bypass duplicate protection when the payer and end-to-end ID stay the same.
  const instructionId = await sha256(JSON.stringify(["settleref.identity.v1", i.endToEndId]));
  const contentHash = await sha256(JSON.stringify([
    "settleref.content.v1", i.chainId, i.endToEndId, i.payer, i.beneficiary,
    i.asset, i.amount, i.reference, i.expiresAt, i.privacySalt,
  ]));
  return { instructionId, contentHash };
}
export function randomHash(): Hash {
  return hash(`0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")}`);
}
export function makeExample(chainId = 5042): Instruction {
  return parseInstruction({
    schema: "settleref.instruction.v1", chainId, endToEndId: crypto.randomUUID(),
    payer: "0x1111111111111111111111111111111111111111",
    beneficiary: "0x2222222222222222222222222222222222222222",
    asset: "USDC", amount: "0.10", reference: "INV-DEMO-001",
    expiresAt: Math.floor(Date.now() / 1000) + 86400, privacySalt: randomHash(),
  });
}
export function assertPayable(i: Instruction, now = Math.floor(Date.now() / 1000)): void {
  if (i.expiresAt <= now) throw new Error("Instruction expired. Do not create a new ID to retry a payment whose outcome is unknown.");
  if (["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"].includes(i.payer) ||
      ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"].includes(i.beneficiary)) {
    throw new Error("Replace both demonstration addresses before making a real payment.");
  }
}
export function csvCell(value: string): string {
  // Spreadsheet formula injection defence, including leading whitespace.
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
