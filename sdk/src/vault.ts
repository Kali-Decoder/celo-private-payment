/**
 * Helpers for the Vault + PaymentNFT redeem path (Celo Sepolia cleartext ERC-20).
 *
 * Flow:
 *   1. createNote({ recipientDigest, amount, token })  // token = ERC-20 address
 *   2. approve(vault) → vault.depositTo(commitment, token, amount, recipient, noteURI)
 *      → locks `amount` of `token`, mints claim NFT to `recipient` (or msg.sender)
 *   3. transfer PaymentNFT (optional) → indexer posts Poseidon root
 *   4. generateProof(...) → encodeProof
 *      public inputs: [root, nullifier, recipientDigest, amount, tokenHash]
 *   5. nft.setRedemptionProof(tokenId, proof, root, nullifier, recipientDigest)
 *   6. vault.redeem(depositId) → ERC-20 payout (− fee)
 *
 * Legacy: vault.deposit(commitment) still deposits default denomination to msg.sender.
 */
import {frToBytes32, type Fr} from "./field.js";
import type {Note} from "./note.js";
import type {WithdrawProofResult} from "./proof.js";

export interface StagedRedemptionArgs {
  tokenId: bigint | number | string;
  proofBytes: `0x${string}`;
  root: `0x${string}`;
  nullifier: `0x${string}`;
  recipientDigest: `0x${string}`;
}

/** Build args for PaymentNFT.setRedemptionProof from a note + proof result. */
export function buildRedemptionProofArgs(
  note: Note,
  proof: WithdrawProofResult,
  tokenId: bigint | number | string
): StagedRedemptionArgs {
  return {
    tokenId,
    proofBytes: proof.proofBytes,
    root: frToBytes32(proof.publicInputs.root),
    nullifier: frToBytes32(note.nullifier),
    recipientDigest: frToBytes32(note.recipientDigest),
  };
}

/** Encode recipientDigest Fr as bytes32 for NFT staging / circuit. */
export function recipientDigestBytes32(digest: Fr | string | bigint): `0x${string}` {
  if (typeof digest === "bigint") return frToBytes32(digest);
  if (typeof digest === "string" && digest.startsWith("0x") && digest.length === 66) {
    return digest as `0x${string}`;
  }
  return frToBytes32(BigInt(digest));
}
