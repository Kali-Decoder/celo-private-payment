import {connectDb, getDb} from "./client.js";
import type {DepositRecord, SyncState} from "../types/index.js";

type DepositRow = {
  id: string;
  commitment: string;
  leaf_index: number;
  token: string;
  amount: string;
  block_number: number;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  finalized: boolean;
  created_at: Date;
};

type RootRow = {
  root: string;
  leaf_count: number;
  posted: boolean;
};

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as {code: string}).code === "23505"
  );
}

function mapDeposit(row: DepositRow): DepositRecord {
  return {
    id: String(row.id),
    commitment: row.commitment,
    leafIndex: row.leaf_index,
    token: row.token,
    amount: row.amount,
    blockNumber: row.block_number,
    blockHash: row.block_hash,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    finalized: row.finalized,
    createdAt: row.created_at,
  };
}

export class DepositRepository {
  async insertIgnore(d: DepositRecord): Promise<boolean> {
    try {
      await getDb().query(
        `INSERT INTO deposits (
           commitment, leaf_index, token, amount,
           block_number, block_hash, tx_hash, log_index, finalized, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [
          d.commitment.toLowerCase(),
          d.leafIndex,
          d.token.toLowerCase(),
          d.amount,
          d.blockNumber,
          d.blockHash.toLowerCase(),
          d.txHash.toLowerCase(),
          d.logIndex,
          d.finalized,
        ]
      );
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  async markFinalized(id: string): Promise<void> {
    await getDb().query(`UPDATE deposits SET finalized = TRUE WHERE id = $1`, [
      id,
    ]);
  }

  async findByCommitment(commitment: string): Promise<DepositRecord | null> {
    const {rows} = await getDb().query<DepositRow>(
      `SELECT * FROM deposits WHERE commitment = $1 LIMIT 1`,
      [commitment.toLowerCase()]
    );
    return rows[0] ? mapDeposit(rows[0]) : null;
  }

  async listFinalizedOrdered(): Promise<DepositRecord[]> {
    const {rows} = await getDb().query<DepositRow>(
      `SELECT * FROM deposits WHERE finalized = TRUE ORDER BY leaf_index ASC`
    );
    return rows.map(mapDeposit);
  }

  async listPendingFinalization(maxBlock: number): Promise<DepositRecord[]> {
    const {rows} = await getDb().query<DepositRow>(
      `SELECT * FROM deposits
       WHERE finalized = FALSE AND block_number <= $1
       ORDER BY leaf_index ASC, log_index ASC`,
      [maxBlock]
    );
    return rows.map(mapDeposit);
  }

  async countFinalized(): Promise<number> {
    const {rows} = await getDb().query<{count: string}>(
      `SELECT COUNT(*)::text AS count FROM deposits WHERE finalized = TRUE`
    );
    return Number(rows[0]?.count ?? 0);
  }

  async nextExpectedLeafIndex(): Promise<number> {
    const {rows} = await getDb().query<{leaf_index: number}>(
      `SELECT leaf_index FROM deposits
       WHERE finalized = TRUE
       ORDER BY leaf_index DESC
       LIMIT 1`
    );
    if (!rows[0]) return 0;
    return rows[0].leaf_index + 1;
  }
}

export class RootRepository {
  async upsert(
    root: string,
    leafCount: number,
    blockNumber: number | null
  ): Promise<void> {
    try {
      await getDb().query(
        `INSERT INTO merkle_roots (root, leaf_count, block_number, posted, posted_tx_hash, created_at)
         VALUES ($1,$2,$3,FALSE,NULL,NOW())`,
        [root.toLowerCase(), leafCount, blockNumber]
      );
    } catch (err) {
      if (isUniqueViolation(err)) return;
      throw err;
    }
  }

  async markPosted(root: string, txHash: string): Promise<void> {
    await getDb().query(
      `UPDATE merkle_roots
       SET posted = TRUE, posted_tx_hash = $2
       WHERE root = $1`,
      [root.toLowerCase(), txHash.toLowerCase()]
    );
  }

  async latest(): Promise<{
    root: string;
    leafCount: number;
    posted: boolean;
  } | null> {
    const {rows} = await getDb().query<RootRow>(
      `SELECT root, leaf_count, posted FROM merkle_roots
       ORDER BY leaf_count DESC
       LIMIT 1`
    );
    const doc = rows[0];
    if (!doc) return null;
    return {
      root: doc.root,
      leafCount: doc.leaf_count,
      posted: doc.posted,
    };
  }

  async count(): Promise<number> {
    const {rows} = await getDb().query<{count: string}>(
      `SELECT COUNT(*)::text AS count FROM merkle_roots`
    );
    return Number(rows[0]?.count ?? 0);
  }

  async unposted(): Promise<string[]> {
    const {rows} = await getDb().query<{root: string}>(
      `SELECT root FROM merkle_roots
       WHERE posted = FALSE
       ORDER BY leaf_count ASC`
    );
    return rows.map((d) => d.root);
  }
}

export class SyncStateRepository {
  async get(): Promise<SyncState> {
    await connectDb();
    const {rows} = await getDb().query<{
      last_processed_block: number;
      last_root: string | null;
      tree_depth: number;
      updated_at: Date;
    }>(`SELECT * FROM sync_state WHERE id = 'singleton' LIMIT 1`);

    const row = rows[0];
    if (!row) {
      return {
        lastProcessedBlock: 0,
        lastRoot: null,
        treeDepth: 20,
        updatedAt: new Date(),
      };
    }
    return {
      lastProcessedBlock: row.last_processed_block,
      lastRoot: row.last_root,
      treeDepth: row.tree_depth,
      updatedAt: row.updated_at,
    };
  }

  async update(partial: {
    lastProcessedBlock?: number;
    lastRoot?: string | null;
    treeDepth?: number;
  }): Promise<void> {
    const cur = await this.get();
    await getDb().query(
      `INSERT INTO sync_state (id, last_processed_block, last_root, tree_depth, updated_at)
       VALUES ('singleton', $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET
         last_processed_block = EXCLUDED.last_processed_block,
         last_root = EXCLUDED.last_root,
         tree_depth = EXCLUDED.tree_depth,
         updated_at = NOW()`,
      [
        partial.lastProcessedBlock ?? cur.lastProcessedBlock,
        partial.lastRoot === undefined ? cur.lastRoot : partial.lastRoot,
        partial.treeDepth ?? cur.treeDepth,
      ]
    );
  }
}
