# Redsand ZK Protocol (EVM · Celo Sepolia)

Status: Vault + claim NFT on Option B Poseidon Merkle. Cleartext ERC-20 deposits
(no FHE / confidential wrappers). Matches `hardhat-contracts/contracts/Vault.sol` + `IVerifier`.

Target network: **Celo Sepolia** (`11142220`).

## Product flow

```
approve(token, vault, amount)
depositTo(commitment, token, amount, recipient, noteURI)
  → Vault pulls ERC-20 (`amount` of `token`)
  → emit Deposit(commitment, leafIndex, token, amount, depositId, tokenId)
  → mint PaymentNFT to `recipient` (or msg.sender if recipient=0) + optional noteURI
  → transfer NFT (optional) / keep Poseidon note secret (same amount + tokenHash)
 later:
  → SDK proves membership (this circuit)
  → PaymentNFT.setRedemptionProof(...)
  → Vault.redeem(depositId)
  → verify with per-deposit amount/token + burn NFT + pay out (minus fee)
```

Legacy `deposit(commitment)` still deposits default `denomination` of default `token` to `msg.sender`.

## Statement

> I know a `secret` whose commitment is a leaf of the Merkle tree at public
> `root`, and the public `nullifier` is correctly derived from that secret.
> The commitment binds `recipientDigest`, `amount`, and `tokenHash`.

Deposit needs **no** circuit. Only redeem does.

The circuit binds `amount` and `tokenHash` so a note cannot redeem a different
size or token than was committed. The Vault stores **per-deposit** `token` +
`amount` and passes those into `verifyProof` on redeem (not a global denomination).

## Private inputs (never on-chain)

| Name | Type | Notes |
|------|------|-------|
| `secret` | Fr | Random field element |
| `pathElements[20]` | Fr[] | Merkle siblings |
| `pathIndices[20]` | {0,1}[] | 0 = current is left child |

## Public inputs (order locked — must match verifier)

| # | Name | Encoding |
|---|------|----------|
| 0 | `root` | Poseidon Merkle root |
| 1 | `nullifier` | `Poseidon₁([secret])` |
| 2 | `recipientDigest` | Per-payment stealth digest (Fr) — **not** the NFT wallet recipient |
| 3 | `amount` | Raw ERC-20 amount (= deposit amount / note amount) |
| 4 | `tokenHash` | `uint256(uint160(tokenAddress))` |

## Derivations

```
nullifier  = Poseidon([secret])                          // arity 1
commitment = Poseidon([secret, recipientDigest, amount, tokenHash])  // arity 4
```

Merkle: depth **20**, Poseidon₂ hash, leaf = commitment. Tree is **off-chain**;
indexer posts roots to `MerkleRootManager`.

## Contract binding

`Vault.redeem` reads staged proof from the claim NFT and passes:

- `root`, `nullifier`, `recipientDigest` from NFT staging
- `amount` / `tokenHash` from **that deposit’s** stored `amount` + `token`
- payout goes to `msg.sender` (must own the claim NFT)

**Client must match:** `createNote({ amount, token })` values === `depositTo(..., token, amount, ...)`.

## Indexer

Listens to `Deposit(commitment, leafIndex, token, amount, depositId, tokenId)` —
same event shape as before. Stores token/amount; inserts **commitment** as Merkle
leaf (amount/token are already bound inside the commitment). Does not need
`PaymentIssued` for proofs/witnesses.

## Trust

Hackathon: own Powers-of-Tau + zkey contribution. Intermediate `.ptau` / toxic
waste are gitignored. Production needs an MPC ceremony. Vault owner can pause
and `emergencyWithdraw` — treat as trusted admin for now.
