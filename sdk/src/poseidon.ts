import {buildPoseidon} from "circomlibjs";
import {toFr, type Fr} from "./field.js";

type PoseidonFn = ((inputs: (bigint | number)[]) => Uint8Array) & {
  F: {toObject: (x: Uint8Array) => bigint};
};

let poseidonPromise: Promise<PoseidonFn> | null = null;

async function getPoseidon(): Promise<PoseidonFn> {
  if (!poseidonPromise) {
    poseidonPromise = buildPoseidon() as Promise<PoseidonFn>;
  }
  return poseidonPromise;
}

/** Poseidon over BN254 — matches circomlib / withdraw.circom. */
export async function poseidon(inputs: (Fr | string | number)[]): Promise<Fr> {
  const h = await getPoseidon();
  const mapped = inputs.map((x) => toFr(typeof x === "bigint" ? x : BigInt(x)));
  const out = h(mapped);
  return h.F.toObject(out);
}

export async function poseidon1(a: Fr | string): Promise<Fr> {
  return poseidon([a]);
}

export async function poseidon2(a: Fr | string, b: Fr | string): Promise<Fr> {
  return poseidon([a, b]);
}

export async function poseidon4(
  a: Fr | string,
  b: Fr | string,
  c: Fr | string,
  d: Fr | string
): Promise<Fr> {
  return poseidon([a, b, c, d]);
}
