pragma circom 2.0.0;

// Redsand withdraw circuit — Groth16 / BN254, Poseidon-Merkle membership + nullifier.
//
// Proof statement:
//   prover knows `secret` such that:
//     nullifier         = Poseidon([secret])
//     commitment        = Poseidon([secret, recipientDigest, amount, tokenHash])
//     commitment ∈ Merkle tree at `root` (opening path of depth 20)
//
// Public inputs (LOCKED — order must match IVerifier / Vault):
//   [root, nullifier, recipientDigest, amount, tokenHash]
//
//   amount    = raw ERC-20 base units (e.g. 10e6 for 10 USDC with 6 decimals)
//   tokenHash = uint256(uint160(tokenAddress))  — fits in BN254 Fr
//
// Security:
//   - recipientDigest in commitment → cannot front-run / re-target recipient
//   - amount in commitment          → cannot inflate withdraw amount
//   - tokenHash in commitment       → cannot claim as a different ERC-20
//   - nullifier arity 1 vs commitment arity 4 → domain separation
//
// Deposit does NOT use this circuit. Deposit = commitment + ERC20 transfer + event.

include "../node_modules/circomlib/circuits/poseidon.circom";

template Withdraw(DEPTH) {
    // ── public inputs (order matches PROTOCOL.md) ─────────────────────────────
    signal input root;
    signal input nullifier;
    signal input recipientDigest;
    signal input amount;
    signal input tokenHash;

    // ── private inputs ────────────────────────────────────────────────────────
    signal input secret;
    signal input pathElements[DEPTH];
    signal input pathIndices[DEPTH];

    // ── nullifier = Poseidon([secret]) ────────────────────────────────────────
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.out === nullifier;

    // ── commitment = Poseidon([secret, recipientDigest, amount, tokenHash]) ───
    component commitmentHasher = Poseidon(4);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== recipientDigest;
    commitmentHasher.inputs[2] <== amount;
    commitmentHasher.inputs[3] <== tokenHash;

    // ── Merkle membership (Poseidon2) ─────────────────────────────────────────
    component levelHashers[DEPTH];
    signal levelHashes[DEPTH + 1];
    signal left[DEPTH];
    signal right[DEPTH];

    levelHashes[0] <== commitmentHasher.out;

    for (var i = 0; i < DEPTH; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        left[i]  <== (pathElements[i] - levelHashes[i]) * pathIndices[i] + levelHashes[i];
        right[i] <== (levelHashes[i] - pathElements[i]) * pathIndices[i] + pathElements[i];

        levelHashers[i] = Poseidon(2);
        levelHashers[i].inputs[0] <== left[i];
        levelHashers[i].inputs[1] <== right[i];
        levelHashes[i + 1] <== levelHashers[i].out;
    }

    levelHashes[DEPTH] === root;
}

component main {public [root, nullifier, recipientDigest, amount, tokenHash]} = Withdraw(20);
