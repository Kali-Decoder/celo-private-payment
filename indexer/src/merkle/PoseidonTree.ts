import {frToBytes32, MerkleTree, type Fr} from "@redsand/sdk";
import type {WitnessResponse} from "../types/index.js";

/**
 * Canonical Poseidon Merkle tree for Redsand deposits.
 * Leaves MUST be inserted in on-chain leafIndex order — never reordered.
 */
export class PoseidonTree {
  private tree: MerkleTree | null = null;
  private commitments: string[] = [];

  constructor(private readonly depth: number) {}

  async init(): Promise<void> {
    this.tree = await MerkleTree.create(this.depth);
    this.commitments = [];
  }

  get size(): number {
    return this.tree?.size ?? 0;
  }

  /** Rebuild from finalized commitments in leafIndex order. */
  async rebuild(commitmentsHex: string[]): Promise<string> {
    await this.init();
    for (const c of commitmentsHex) {
      await this.insert(c);
    }
    return this.rootHex();
  }

  async insert(commitmentHex: string): Promise<{leafIndex: number; root: string}> {
    if (!this.tree) await this.init();
    const normalized = commitmentHex.toLowerCase();
    const fr = BigInt(normalized) as Fr;
    const leafIndex = await this.tree!.insert(fr);
    this.commitments[leafIndex] = normalized;
    return {leafIndex, root: await this.rootHex()};
  }

  async rootHex(): Promise<string> {
    if (!this.tree) await this.init();
    return frToBytes32(await this.tree!.root());
  }

  async witness(leafIndex: number): Promise<WitnessResponse> {
    if (!this.tree) throw new Error("tree not initialized");
    const proof = await this.tree.proof(leafIndex);
    return {
      root: frToBytes32(proof.root),
      leafIndex: proof.leafIndex,
      siblings: proof.pathElements.map((s) => frToBytes32(s)),
      pathIndices: proof.pathIndices,
    };
  }

  async witnessByCommitment(commitmentHex: string): Promise<WitnessResponse | null> {
    const normalized = commitmentHex.toLowerCase();
    const leafIndex = this.commitments.indexOf(normalized);
    if (leafIndex < 0) return null;
    return this.witness(leafIndex);
  }
}
