export {
  BN254_R,
  MERKLE_DEPTH,
  bytes32ToFr,
  frToBytes32,
  randomFr,
  toFr,
  tokenHash,
  type Fr,
} from "./field.js";

export {poseidon, poseidon1, poseidon2, poseidon4} from "./poseidon.js";

export {
  createNote,
  generateCommitment,
  generateNullifier,
  generateSecret,
  noteFromJSON,
  noteToJSON,
  type Note,
  type NoteJSON,
} from "./note.js";

export {MerkleTree, type MerkleProof} from "./merkle.js";

export {
  encodeProof,
  generateProof,
  publicInputBytes32,
  verifyProofOffchain,
  type CircuitPaths,
  type WithdrawProofResult,
  type WithdrawPublicInputs,
} from "./proof.js";

export {
  buildRedemptionProofArgs,
  recipientDigestBytes32,
  type StagedRedemptionArgs,
} from "./vault.js";
