import {MERKLE_DEPTH, toFr, type Fr} from "./field.js";
import {poseidon2} from "./poseidon.js";

export interface MerkleProof {
  root: Fr;
  pathElements: Fr[];
  pathIndices: number[];
  leafIndex: number;
}

/** Incremental Poseidon Merkle tree (depth fixed to circuit DEPTH). */
export class MerkleTree {
  readonly depth: number;
  private zeros: Fr[] = [];
  private layers: Fr[][] = [];
  private filled = 0;

  private constructor(depth: number, zeros: Fr[], layers: Fr[][]) {
    this.depth = depth;
    this.zeros = zeros;
    this.layers = layers;
  }

  static async create(depth: number = MERKLE_DEPTH): Promise<MerkleTree> {
    const zeros: Fr[] = [0n];
    for (let i = 0; i < depth; i++) {
      zeros.push(await poseidon2(zeros[i], zeros[i]));
    }
    const layers: Fr[][] = Array.from({length: depth + 1}, () => []);
    return new MerkleTree(depth, zeros, layers);
  }

  get size(): number {
    return this.filled;
  }

  async root(): Promise<Fr> {
    if (this.filled === 0) return this.zeros[this.depth];
    const top = this.layers[this.depth];
    return top.length ? top[0] : this.zeros[this.depth];
  }

  async insert(leaf: Fr | string): Promise<number> {
    const index = this.filled;
    if (index >= 1 << this.depth) throw new Error("tree full");

    let current = toFr(typeof leaf === "bigint" ? leaf : BigInt(leaf));
    let i = index;
    this.layers[0][i] = current;

    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = i ^ 1;
      const sibling =
        siblingIndex < this.layers[level].length
          ? this.layers[level][siblingIndex]
          : this.zeros[level];

      if (i % 2 === 0) {
        current = await poseidon2(current, sibling);
      } else {
        current = await poseidon2(sibling, current);
      }
      i >>= 1;
      this.layers[level + 1][i] = current;
    }

    this.filled = index + 1;
    return index;
  }

  async proof(leafIndex: number): Promise<MerkleProof> {
    if (leafIndex < 0 || leafIndex >= this.filled) {
      throw new Error(`leaf ${leafIndex} out of range`);
    }
    const pathElements: Fr[] = [];
    const pathIndices: number[] = [];
    let i = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = i ^ 1;
      const sibling =
        siblingIndex < this.layers[level].length
          ? this.layers[level][siblingIndex]
          : this.zeros[level];
      pathElements.push(sibling);
      pathIndices.push(i % 2);
      i >>= 1;
    }

    return {
      root: await this.root(),
      pathElements,
      pathIndices,
      leafIndex,
    };
  }
}
