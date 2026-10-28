import type {DepositEvent} from "../types/index.js";
import {goldskyQuery} from "./client.js";

export type DepositSource = {
  latestBlock(): Promise<number>;
  fetchDeposits(fromBlock: number, toBlock: number): Promise<DepositEvent[]>;
};

type GoldskyDeposit = {
  id: string;
  commitment: string | null;
  leafIndex: string | null;
  token: string | null;
  amount: string | null;
  block_number: string;
  transactionHash_: string;
};

/**
 * Fetch Vault Deposit entities from Goldsky instead of eth_getLogs.
 * Indexer still finalizes leaves, builds Poseidon tree, posts roots, serves witnesses.
 * Note: republish the subgraph after the Vault event signature change.
 */
export class GoldskyDepositSource implements DepositSource {
  constructor(private readonly endpoint: string) {}

  async latestBlock(): Promise<number> {
    const data = await goldskyQuery<{_meta: {block: {number: number}}}>(
      this.endpoint,
      `{ _meta { block { number } } }`
    );
    return Number(data._meta.block.number);
  }

  async fetchDeposits(
    fromBlock: number,
    toBlock: number
  ): Promise<DepositEvent[]> {
    if (toBlock < fromBlock) return [];

    const pageSize = 500;
    const events: DepositEvent[] = [];
    let skip = 0;

    for (;;) {
      const data = await goldskyQuery<{deposits: GoldskyDeposit[]}>(
        this.endpoint,
        `query Deposits($from: BigInt!, $to: BigInt!, $first: Int!, $skip: Int!) {
          deposits(
            first: $first
            skip: $skip
            orderBy: block_number
            orderDirection: asc
            where: { block_number_gte: $from, block_number_lte: $to }
          ) {
            id
            commitment
            leafIndex
            token
            amount
            block_number
            transactionHash_
          }
        }`,
        {
          from: String(fromBlock),
          to: String(toBlock),
          first: pageSize,
          skip,
        }
      );

      const batch = data.deposits ?? [];
      for (const d of batch) {
        const ev = mapDeposit(d);
        if (ev) events.push(ev);
      }

      if (batch.length < pageSize) break;
      skip += pageSize;
    }

    events.sort((a, b) =>
      a.blockNumber !== b.blockNumber
        ? a.blockNumber - b.blockNumber
        : a.logIndex - b.logIndex
    );
    return events;
  }
}

function mapDeposit(d: GoldskyDeposit): DepositEvent | null {
  if (!d.commitment || d.leafIndex == null || !d.token) {
    return null;
  }
  const commitment = normalizeHex(d.commitment);
  const token = normalizeHex(d.token);
  const txHash = normalizeHex(d.transactionHash_);
  if (!commitment || !token || !txHash) return null;

  const blockNumber = Number(d.block_number);
  // Goldsky entity id is typically `${txHash}-${logIndex}`.
  const logIndex = parseLogIndex(d.id, d.transactionHash_);

  return {
    commitment,
    leafIndex: Number(d.leafIndex),
    token,
    // Amount may be absent after amount-private Vault upgrade.
    amount: d.amount != null ? BigInt(d.amount) : 0n,
    blockNumber,
    // Subgraph has no block hash — synthetic placeholder (uniqueness uses tx+log).
    blockHash: syntheticBlockHash(blockNumber),
    txHash,
    logIndex,
  };
}

function parseLogIndex(id: string, txHash: string): number {
  const lowerTx = txHash.toLowerCase();
  const lowerId = id.toLowerCase();
  if (lowerId.startsWith(lowerTx + "-")) {
    const n = Number(lowerId.slice(lowerTx.length + 1));
    if (Number.isFinite(n)) return n;
  }
  const parts = id.split("-");
  const last = Number(parts[parts.length - 1]);
  return Number.isFinite(last) ? last : 0;
}

function normalizeHex(value: string): `0x${string}` | null {
  const v = (value.startsWith("0x") ? value : `0x${value}`).toLowerCase();
  if (!/^0x[a-f0-9]+$/.test(v)) return null;
  return v as `0x${string}`;
}

function syntheticBlockHash(blockNumber: number): `0x${string}` {
  return `0x${blockNumber.toString(16).padStart(64, "0")}` as `0x${string}`;
}
