import {frToBytes32, randomFr, tokenHash, toFr, type Fr} from "./field.js";
import {poseidon1, poseidon4} from "./poseidon.js";

export interface Note {
  secret: Fr;
  recipientDigest: Fr;
  amount: Fr;
  tokenHash: Fr;
  /** Poseidon4 commitment — deposit leaf. */
  commitment: Fr;
  /** Poseidon1 nullifier — revealed on withdraw. */
  nullifier: Fr;
}

export interface NoteJSON {
  secret: string;
  recipientDigest: string;
  amount: string;
  tokenHash: string;
  commitment: string;
  nullifier: string;
  commitmentBytes32: `0x${string}`;
  nullifierBytes32: `0x${string}`;
}

/** Sample a fresh note secret in Fr. */
export function generateSecret(): Fr {
  return randomFr();
}

export async function generateNullifier(secret: Fr | string): Promise<Fr> {
  return poseidon1(secret);
}

export async function generateCommitment(
  secret: Fr | string,
  recipientDigest: Fr | string,
  amount: Fr | string | number | bigint,
  tokenHashValue: Fr | string
): Promise<Fr> {
  return poseidon4(secret, recipientDigest, toFr(BigInt(amount)), tokenHashValue);
}

/**
 * Build a full note ready for deposit.
 * `token` is the Vault-supported ERC-20 address (cleartext on Celo).
 * Hashed via `tokenHash()` (= uint160 of the address).
 */
export async function createNote(params: {
  recipientDigest: Fr | string;
  amount: bigint | number | string;
  token: string;
  secret?: Fr;
}): Promise<Note> {
  const secret = params.secret ?? generateSecret();
  const recipientDigest = toFr(
    typeof params.recipientDigest === "bigint"
      ? params.recipientDigest
      : BigInt(params.recipientDigest)
  );
  const amount = toFr(BigInt(params.amount));
  const th = tokenHash(params.token);
  const commitment = await generateCommitment(secret, recipientDigest, amount, th);
  const nullifier = await generateNullifier(secret);
  return {secret, recipientDigest, amount, tokenHash: th, commitment, nullifier};
}

export function noteToJSON(note: Note): NoteJSON {
  return {
    secret: note.secret.toString(),
    recipientDigest: note.recipientDigest.toString(),
    amount: note.amount.toString(),
    tokenHash: note.tokenHash.toString(),
    commitment: note.commitment.toString(),
    nullifier: note.nullifier.toString(),
    commitmentBytes32: frToBytes32(note.commitment),
    nullifierBytes32: frToBytes32(note.nullifier),
  };
}

export function noteFromJSON(json: NoteJSON): Note {
  return {
    secret: toFr(BigInt(json.secret)),
    recipientDigest: toFr(BigInt(json.recipientDigest)),
    amount: toFr(BigInt(json.amount)),
    tokenHash: toFr(BigInt(json.tokenHash)),
    commitment: toFr(BigInt(json.commitment)),
    nullifier: toFr(BigInt(json.nullifier)),
  };
}
