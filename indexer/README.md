Watches `Vault` deposits (via **Goldsky** or RPC), maintains the canonical
Poseidon Merkle tree, posts roots to `MerkleRootManager`, and serves membership
witnesses.

**Never** stores secrets. **Never** generates ZK proofs.

```
Goldsky Deposit (or RPC logs)
    → ingest (pending)
    → wait CONFIRMATIONS
    → insert leaf (in leafIndex order)
    → compute root
    → postRoot()   ← indexer / relayer (verifier path)
    → GET /witness/:commitment
```

Goldsky = data fetcher. Indexer = tree + root poster + witness API.

## Layout

```
indexer/src/
├── goldsky/          GraphQL deposit + root sources
├── watcher/          RPC eth_getLogs fallback
├── merkle/PoseidonTree.ts
├── blockchain/RootPoster.ts
├── db/          schema + repositories
├── api/routes.ts
├── services/SyncService.ts
├── config/
├── types/
└── main.ts
```

## Setup

```bash
cd indexer
pnpm install --ignore-workspace
cp .env.example .env
# fill RELAYER_PRIVATE_KEY + DATABASE_URL + VAULT_ADDRESS + Goldsky URLs
# Create DB: createdb redsand_indexer
```

PostgreSQL:

```bash
# DATABASE_URL=postgresql://USER:PASS@HOST:5432/redsand_indexer
pnpm db:migrate
```

Run:

```bash
pnpm --dir indexer dev
# API: http://127.0.0.1:4010
```

### Render deploy

| Setting | Value |
|--------|--------|
| **Root Directory** | `indexer` |
| **Build Command** | `npx --yes pnpm@9 install --ignore-workspace --prod=false --no-frozen-lockfile && npx --yes pnpm@9 build` |
| **Start Command** | `npx --yes pnpm@9 start` |

`pnpm build` installs + builds sibling `../sdk` first (typescript / `@types/node` are SDK dependencies so Render production installs still compile).

`pnpm build` also installs + builds `../sdk` (required dependency).

Do **not** use plain `yarn` / `yarn start` — this package has no Yarn lockfile and needs the sibling `sdk` built first.

Env (minimum):

```env
DATABASE_URL=postgresql://…/redsand_indexer?sslmode=require
RPC_URL=https://forno.celo-sepolia.celo-testnet.org/
CHAIN_ID=11142220
VAULT_ADDRESS=0x71d91e48b88DaEb94A6E14c34e791150a994BA5F
MERKLE_ROOT_MANAGER_ADDRESS=0x90Dfd581393104EAe03Fd349b4867A7E8F51313b
RELAYER_PRIVATE_KEY=0x…
EVENT_SOURCE=rpc
GOLDSKY_VAULT_URL=
GOLDSKY_ROOT_MANAGER_URL=
CORS_ORIGIN=https://your-frontend.example
```

Render injects `PORT`; the indexer listens on `PORT` if set, else `API_PORT` (default 4010).
Schema migrate runs automatically on boot via `main.ts`.

## Env

| Var | Meaning |
|-----|---------|
| `EVENT_SOURCE` | `goldsky` (default) or `rpc` |
| `GOLDSKY_VAULT_URL` | Deposit subgraph GraphQL endpoint |
| `GOLDSKY_ROOT_MANAGER_URL` | RootPosted subgraph (skip redundant postRoot) |
| `RPC_URL` | EVM JSON-RPC (still needed for `postRoot`) |
| `VAULT_ADDRESS` | Vault address |
| `MERKLE_ROOT_MANAGER_ADDRESS` | Root poster target |
| `RELAYER_PRIVATE_KEY` | Must **own** MerkleRootManager |
| `DATABASE_URL` | PostgreSQL (`…/redsand_indexer`) |
| `CONFIRMATIONS` | Blocks before finalizing a leaf (default 8) |
| `SKIP_POST_ROOT=1` | Build tree + API without posting |

## API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | status, eventSource, lastBlock, latestRoot |
| GET | `/root` | latest root + leafCount |
| GET | `/witness/:commitment` | siblings + pathIndices (no secret) |
| GET | `/deposit/:commitment` | deposit metadata |
| GET | `/stats` | leaves, roots, latestRoot |

## Recovery

On restart the indexer:

1. Loads finalized deposits from PostgreSQL in `leaf_index` order
2. Rebuilds the in-memory Poseidon tree
3. Re-posts the latest root if needed
4. Continues from `sync_state.last_processed_block`

Never rebuilds from zero unless the DB is empty.
