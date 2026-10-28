import pg from "pg";
import {config} from "../config/index.js";

const {Pool} = pg;

let pool: pg.Pool | null = null;

export async function connectDb(): Promise<pg.Pool> {
  if (pool) return pool;
  pool = new Pool({connectionString: config.databaseUrl});
  // Fail fast if URL/credentials are wrong
  await pool.query("SELECT 1");
  return pool;
}

export function getDb(): pg.Pool {
  if (!pool) {
    throw new Error("PostgreSQL not connected — call connectDb() / migrate() first");
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Create tables + indexes (idempotent). */
export async function migrate(): Promise<void> {
  const db = await connectDb();

  await db.query(`
    CREATE TABLE IF NOT EXISTS deposits (
      id              BIGSERIAL PRIMARY KEY,
      commitment      TEXT NOT NULL,
      leaf_index      INTEGER NOT NULL,
      token           TEXT NOT NULL,
      amount          TEXT NOT NULL,
      block_number    INTEGER NOT NULL,
      block_hash      TEXT NOT NULL,
      tx_hash         TEXT NOT NULL,
      log_index       INTEGER NOT NULL,
      finalized       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS deposits_commitment_unique
      ON deposits (commitment);
    CREATE UNIQUE INDEX IF NOT EXISTS deposits_leaf_index_unique
      ON deposits (leaf_index);
    CREATE UNIQUE INDEX IF NOT EXISTS deposits_tx_log_unique
      ON deposits (tx_hash, log_index);
    CREATE INDEX IF NOT EXISTS deposits_block_idx
      ON deposits (block_number);
    CREATE INDEX IF NOT EXISTS deposits_finalized_idx
      ON deposits (finalized, leaf_index);

    CREATE TABLE IF NOT EXISTS merkle_roots (
      id              BIGSERIAL PRIMARY KEY,
      root            TEXT NOT NULL,
      leaf_count      INTEGER NOT NULL,
      block_number    INTEGER,
      posted          BOOLEAN NOT NULL DEFAULT FALSE,
      posted_tx_hash  TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS merkle_roots_root_unique
      ON merkle_roots (root);
    CREATE INDEX IF NOT EXISTS merkle_roots_leaf_count_idx
      ON merkle_roots (leaf_count DESC);

    CREATE TABLE IF NOT EXISTS sync_state (
      id                    TEXT PRIMARY KEY,
      last_processed_block  INTEGER NOT NULL DEFAULT 0,
      last_root             TEXT,
      tree_depth            INTEGER NOT NULL DEFAULT 20,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO sync_state (id, last_processed_block, last_root, tree_depth, updated_at)
    VALUES ('singleton', 0, NULL, 20, NOW())
    ON CONFLICT (id) DO NOTHING;
  `);

  console.log("[db] PostgreSQL tables + indexes + sync_state ready");
}
