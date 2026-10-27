# Redsand Backend

API for wallet auth, username resolution, encrypted notes, and **dashboard**
data (payments, activity, notifications, settings).

Target network label: **Celo Sepolia** (cleartext ERC-20 + PaymentNFT flow).

Does **not** prove ZK, maintain Merkle trees, or talk to the chain.
Those stay in SDK / indexer / contracts. The backend stores off-chain
certificate metadata and user activity so the dashboard can render.

## Dashboard APIs

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/payments` | yes | List certificates (`?status=active\|pending\|…`) |
| GET | `/payments/:id` | yes | Payment detail |
| POST | `/payments` | yes | Create pending payment after deposit |
| POST | `/payments/:id/mint` | yes | Confirm mint (`tokenId`, optional `mintTxHash`) |
| POST | `/payments/:id/transfer` | yes | Transfer to `toWallet` or `toUsername` |
| POST | `/payments/:id/redeem` | yes | Mark redeemed |
| GET | `/activity` | yes | Activity feed (`?tone=&rangeDays=&limit=`) |
| GET | `/notifications` | yes | Notifications (`?filter=unread\|minting\|…`) |
| POST | `/notifications/read-all` | yes | Mark all read |
| PATCH | `/notifications/:id/read` | yes | Mark one read |
| GET | `/settings` | yes | Profile + notification prefs |
| PATCH | `/settings` | yes | Update `displayName`, `email`, `prefs` |

## Core APIs

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/wallet` | no | Register / login via personal_sign |
| GET | `/auth/message` | no | Preview the message to sign |
| GET | `/users/wallet/:wallet` | no | Resolve wallet → username + redsandPublicKey |
| GET | `/users/:username` | no | Resolve `@name` → wallet + redsandPublicKey |
| POST | `/users/me/twitter` | yes | Link Twitter via Privy |
| DELETE | `/users/me/twitter` | yes | Unlink Twitter |
| POST | `/notes` | yes | Store encrypted note for a recipient |
| GET | `/notes` | yes | Inbox for the authenticated user |
| GET | `/notes/history` | yes | Paginated sent/received notes |
| PATCH | `/notes/:id/claim` | yes | Mark note claimed after withdraw |
| GET | `/health` | no | Liveness |

## Payment lifecycle

1. `POST /payments` after deposit → status `pending`, activity `deposit`
2. `POST /payments/:id/mint` when NFT confirms → `active`
3. `POST /payments/:id/transfer` → recipient sees `received`
4. `POST /payments/:id/redeem` → `redeemed`

Each step writes **ActivityEvent** + **Notification** rows for the dashboard.

Join key with the indexer remains `commitment` / deposit tx hash when provided.

## Setup

```bash
cd backend
# Create DB first, e.g.:
#   createdb redsand
pnpm install --ignore-workspace
cp .env.example .env   # set DATABASE_URL to your Postgres
pnpm db:generate
pnpm db:push
pnpm dev
# → http://127.0.0.1:4020
```

### Render deploy

| Setting | Value |
|--------|--------|
| **Root Directory** | `backend` |
| **Build Command** | `npx --yes pnpm@9 install --ignore-workspace --prod=false && npx --yes pnpm@9 db:generate` |
| **Start Command** | `npx --yes pnpm@9 start` |
| **Env** | `DATABASE_URL=postgresql://…/postgre_redsand` (shared OK — backend uses schema `redsand`, indexer uses `public`) |

Link a Render Postgres addon (or set `DATABASE_URL` yourself). Backend tables live in PostgreSQL schema **`redsand`** so `db push` will **not** drop indexer tables (`sync_state`, `deposits`, …) in `public`.

Do **not** put `db:push` in Build Command — `pnpm start` runs it at boot.

Ideal: separate databases (`redsand` + `redsand_indexer`). If you share one instance, the `redsand` schema isolation is required.

## Auth flow (frontend)

```ts
const username = "alice";
const redsandPublicKey = "0x" + "..."; // 32-byte hex
const wallet = address;

const { message } = await fetch(
  `/auth/message?wallet=${wallet}&username=${username}&redsandPublicKey=${redsandPublicKey}`
).then((r) => r.json());

const signature = await walletClient.signMessage({ message });

const { token, user } = await fetch("/auth/wallet", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ wallet, username, redsandPublicKey, signature }),
}).then((r) => r.json());

// later
fetch("/payments", { headers: { Authorization: `Bearer ${token}` } });
```
