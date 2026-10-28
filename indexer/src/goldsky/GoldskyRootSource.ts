import {goldskyQuery} from "./client.js";

/**
 * Read posted roots from the MerkleRootManager Goldsky subgraph.
 * Used to mark DB roots posted without waiting on RPC when possible.
 */
export class GoldskyRootSource {
  constructor(private readonly endpoint: string) {}

  async latestIndexedBlock(): Promise<number> {
    const data = await goldskyQuery<{_meta: {block: {number: number}}}>(
      this.endpoint,
      `{ _meta { block { number } } }`
    );
    return Number(data._meta.block.number);
  }

  /** True if this root appears in Goldsky rootPosteds. */
  async isRootPosted(root: string): Promise<boolean> {
    const normalized = root.toLowerCase();
    const data = await goldskyQuery<{
      rootPosteds: Array<{root: string | null}>;
    }>(
      this.endpoint,
      `query Root($root: String!) {
        rootPosteds(first: 1, where: { root: $root }) {
          root
        }
      }`,
      {root: normalized}
    );
    return (data.rootPosteds?.length ?? 0) > 0;
  }
}
