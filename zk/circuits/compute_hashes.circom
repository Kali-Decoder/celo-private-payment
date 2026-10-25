pragma circom 2.0.0;

// Helper: compute nullifier, commitment, and a depth-20 root for leaf index 0
// with empty siblings. Used by gen-test-proof.mjs to discover correct public
// values before proving withdraw.circom.

include "../node_modules/circomlib/circuits/poseidon.circom";

template ComputeHashes(DEPTH) {
    signal input secret;
    signal input recipientDigest;
    signal input amount;
    signal input tokenHash;

    signal output nullifier;
    signal output commitment;
    signal output root;
    // pathElements[i] for leaf index 0 = empty subtree at height i
    signal output zeroHashes[DEPTH];

    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== secret;
    nullifier <== nullifierHasher.out;

    component commitmentHasher = Poseidon(4);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== recipientDigest;
    commitmentHasher.inputs[2] <== amount;
    commitmentHasher.inputs[3] <== tokenHash;
    commitment <== commitmentHasher.out;

    // empty[0] = 0 (empty leaf), empty[i+1] = Poseidon(empty[i], empty[i])
    signal empty[DEPTH + 1];
    empty[0] <== 0;
    component eh[DEPTH];
    for (var i = 0; i < DEPTH; i++) {
        eh[i] = Poseidon(2);
        eh[i].inputs[0] <== empty[i];
        eh[i].inputs[1] <== empty[i];
        empty[i + 1] <== eh[i].out;
        zeroHashes[i] <== empty[i];
    }

    component mh[DEPTH];
    signal level[DEPTH + 1];
    level[0] <== commitment;
    for (var i = 0; i < DEPTH; i++) {
        mh[i] = Poseidon(2);
        mh[i].inputs[0] <== level[i];
        mh[i].inputs[1] <== empty[i];
        level[i + 1] <== mh[i].out;
    }
    root <== level[DEPTH];
}

component main = ComputeHashes(20);
