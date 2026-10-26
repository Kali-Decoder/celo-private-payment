import {readFileSync} from "node:fs";
import {groth16} from "snarkjs";
import {frToBytes32, toFr, type Fr} from "./field.js";
import type {MerkleProof} from "./merkle.js";
import type {Note} from "./note.js";

export interface CircuitPaths {
  wasmPath: string;
  zkeyPath: string;
}

export interface WithdrawPublicInputs {
  root: Fr;
  nullifier: Fr;
  recipientDigest: Fr;
  amount: Fr;
  tokenHash: Fr;
}

export interface WithdrawProofResult {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
  publicInputs: WithdrawPublicInputs;
  /** ABI-encoded proof for Vault.redeem (via PaymentNFT staging) / WithdrawVerifier. */
  proofBytes: `0x${string}`;
}

/**
 * Encode snarkjs proof into 8×uint256 words for WithdrawVerifier:
 * [a0, a1, b00, b01, b10, b11, c0, c1]
 * with G2 limbs endian-swapped for the Solidity verifier.
 */
export function encodeProof(proof: {
  pi_a: (string | number)[];
  pi_b: (string | number)[][];
  pi_c: (string | number)[];
}): `0x${string}` {
  const a0 = BigInt(proof.pi_a[0]);
  const a1 = BigInt(proof.pi_a[1]);
  // snarkjs → solidity: swap each G2 Fp2 coordinate pair
  const b00 = BigInt(proof.pi_b[0][1]);
  const b01 = BigInt(proof.pi_b[0][0]);
  const b10 = BigInt(proof.pi_b[1][1]);
  const b11 = BigInt(proof.pi_b[1][0]);
  const c0 = BigInt(proof.pi_c[0]);
  const c1 = BigInt(proof.pi_c[1]);

  const words = [a0, a1, b00, b01, b10, b11, c0, c1];
  return ("0x" +
    words.map((w) => w.toString(16).padStart(64, "0")).join("")) as `0x${string}`;
}

export async function generateProof(
  note: Note,
  merkle: MerkleProof,
  circuits: CircuitPaths
): Promise<WithdrawProofResult> {
  if (merkle.pathElements.length !== 20 || merkle.pathIndices.length !== 20) {
    throw new Error("Merkle proof must be depth 20");
  }

  const input = {
    root: merkle.root.toString(),
    nullifier: note.nullifier.toString(),
    recipientDigest: note.recipientDigest.toString(),
    amount: note.amount.toString(),
    tokenHash: note.tokenHash.toString(),
    secret: note.secret.toString(),
    pathElements: merkle.pathElements.map((x) => x.toString()),
    pathIndices: merkle.pathIndices,
  };

  const {proof, publicSignals} = await groth16.fullProve(
    input,
    circuits.wasmPath,
    circuits.zkeyPath
  );

  const typedProof = proof as WithdrawProofResult["proof"];

  return {
    proof: typedProof,
    publicSignals,
    publicInputs: {
      root: toFr(BigInt(publicSignals[0])),
      nullifier: toFr(BigInt(publicSignals[1])),
      recipientDigest: toFr(BigInt(publicSignals[2])),
      amount: toFr(BigInt(publicSignals[3])),
      tokenHash: toFr(BigInt(publicSignals[4])),
    },
    proofBytes: encodeProof(typedProof),
  };
}

export async function verifyProofOffchain(
  proof: WithdrawProofResult["proof"],
  publicSignals: string[],
  vkeyPathOrObject: string | object
): Promise<boolean> {
  const vkey =
    typeof vkeyPathOrObject === "string"
      ? JSON.parse(readFileSync(vkeyPathOrObject, "utf8"))
      : vkeyPathOrObject;
  return groth16.verify(vkey, publicSignals, proof);
}

/** Helpers for contract calldata. */
export function publicInputBytes32(inputs: WithdrawPublicInputs) {
  return {
    root: frToBytes32(inputs.root),
    nullifier: frToBytes32(inputs.nullifier),
    recipientDigest: frToBytes32(inputs.recipientDigest),
    amount: inputs.amount,
    tokenHash: inputs.tokenHash,
  };
}
