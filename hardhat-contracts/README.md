# Redsand · hardhat-contracts

Solidity + ZK stack for **private payments via claim NFTs** on **Celo Sepolia**.

## Architecture

```
Any supported ERC-20 (USDC / USDT / DAI / custom)
        │ approve + depositTo
        ▼
     Redsand Vault  (locks cleartext ERC-20)
        │
   ┌────┴────┐
 ZK note   PaymentNFT  ←── transfer NFT to recipient
   └────┬────┘
        │ stage proof → redeem
        ▼
     Recipient receives ERC-20 (− fee)
```

**Payment flow:** `approve` → `depositTo(commitment, token, amount, recipient, noteURI)` → claim NFT minted → transfer NFT → stage ZK proof → `vault.redeem` → ERC-20 payout.

**Create payment:**
- `depositTo(commitment, token, amount, recipient, noteURI)` — any amount > 0, any `supportedTokens` ERC-20
- Legacy helper: `deposit(commitment)` — default denomination of default token

`supportedTokens` are **plain ERC-20** addresses (mocks or real).  
Note `tokenHash = uint256(uint160(token))` binds the ERC-20 used at deposit.

**Option B Merkle:** off-chain Poseidon tree, on-chain `MerkleRootManager` roots, Groth16 withdraw proofs.

> **Network:** Celo Sepolia only (`11142220` · `celoSepolia`). No confidential / FHE wrappers.

---

## Network

| Setting | Value |
|---------|--------|
| Name | Celo Sepolia · `celoSepolia` |
| Chain ID | `11142220` |
| Currency | CELO (18 decimals) |
| RPC | `https://forno.celo-sepolia.celo-testnet.org/` |
| Explorer | [Celo Sepolia Blockscout](https://celo-sepolia.blockscout.com) |

Env (see `.env.example`):

```bash
CELO_SEPOLIA_PRIVATE_KEY=...
CELO_SEPOLIA_RPC_URL=https://forno.celo-sepolia.celo-testnet.org/
```

---

## Layout

```
hardhat-contracts/
├── contracts/
│   ├── Vault.sol                 # UUPS — deposit / redeem + PaymentNFT
│   ├── PaymentNFT.sol
│   ├── FeeManager.sol / Treasury.sol / AdminController.sol
│   ├── MerkleRootManager.sol
│   ├── DepositVerifier.sol       # mock — replace with WithdrawVerifier
│   ├── MockUSDC.sol / MockERC20.sol
│   └── verifiers/
├── scripts/deploy/
├── scripts/ops/
├── test/
└── deployments/
```

### Public inputs (locked)

```
[root, nullifier, recipientDigest, amount, tokenHash]
```

Deposit needs **no** circuit. Only redeem does.

### Upgradeability (UUPS)

| Contract | Pattern | Upgrade authority |
|----------|---------|-------------------|
| Vault | ERC1967 + UUPS | Vault `owner` (AdminController after deploy) |
| FeeManager / PaymentNFT / Treasury / AdminController | ERC1967 + UUPS | `UPGRADER_ROLE` |
| MerkleRootManager / DepositVerifier | Immutable | Replace via setters / redeploy |

---

## Setup

```bash
cd hardhat-contracts
pnpm install --ignore-workspace
cp .env.example .env
pnpm compile
```

### ZK + SDK

```bash
pnpm zk:install && pnpm zk:build
pnpm sdk:install && pnpm sdk:build && pnpm sdk:test
```

After `zk:build`, deploy `WithdrawVerifier` and call `vault.setVerifier(...)`.

---

## Deploy (Celo Sepolia)

```bash
pnpm deploy
pnpm status
```

Writes `deployments/celoSepolia.json` with MockERC20 USDC/USDT/DAI enabled on Vault.

### Custom ERC-20

```bash
TOKEN_ADDRESS=0x... TOKEN_SYMBOL=FOO pnpm deploy:token
```

### User flow after deploy

1. `token.approve(vault, amount)`
2. SDK `createNote({ amount, token })`
3. `vault.depositTo(commitment, token, amount, recipient, noteURI)`
4. Transfer PaymentNFT to recipient (optional)
5. Indexer `postRoot`
6. Stage proof on NFT → `vault.redeem(depositId)` → ERC-20 payout

---

## Protocol sketch

1. **Deposit** — pull ERC-20 into Vault → NFT minted → indexer leaf → `postRoot`.
2. **Redeem** — witness → ZK proof → `nft.setRedemptionProof` → `vault.redeem` → burn NFT → pay ERC-20.

```ts
import {
  createNote,
  generateProof,
  encodeProof,
  buildRedemptionProofArgs,
} from "@redsand/sdk";
```

---

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm compile` | Compile contracts |
| `pnpm deploy` | Full deploy on Celo Sepolia |
| `pnpm deploy:token` | Deploy mocks or enable `TOKEN_ADDRESS` |
| `pnpm mint:all` | Fresh mock stables + enable on Vault |
| `pnpm status` | Addresses + on-chain status |
| `pnpm zk:build` | Circuit → verifier Solidity |
| `pnpm sdk:test` | SDK unit tests |

---

## Security notes

- `ReentrancyGuard` + `Pausable` + `Ownable2Step` on the Vault.
- Mock verifier must never hold real funds.
- Relayer key is for `postRoot` only. Never store user secrets in the indexer.
- Owner emergency paths while paused can drain — production should use multisig + limits.
- Amount is cleartext on deposit (ERC-20 transfer + event). Privacy is via NFT claim transfer + ZK nullifier, not amount encryption.
