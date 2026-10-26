/** BN254 scalar field modulus (circom / snarkjs default). */
export const BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const MERKLE_DEPTH = 20;

export type Fr = bigint;

export function toFr(value: string | number | bigint): Fr {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n || n >= BN254_R) {
    throw new Error(`value not in Fr: ${n}`);
  }
  return n;
}

/** Pad a field element to 32-byte big-endian hex (0x…). */
export function frToBytes32(value: Fr): `0x${string}` {
  const hex = value.toString(16).padStart(64, "0");
  return `0x${hex}`;
}

export function bytes32ToFr(hex: string): Fr {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return toFr(BigInt("0x" + h));
}

/** tokenHash = uint256(uint160(tokenAddress)) — matches Vault.tokenHashOf. */
export function tokenHash(tokenAddress: string): Fr {
  const addr = tokenAddress.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(addr)) {
    throw new Error(`invalid token address: ${tokenAddress}`);
  }
  return BigInt("0x" + addr);
}

export function randomFr(): Fr {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Clear top bits so value < BN254_R with high probability; then mod.
  bytes[0] &= 0x1f;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n % BN254_R;
}
