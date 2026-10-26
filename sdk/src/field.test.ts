import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  createNote,
  frToBytes32,
  generateNullifier,
  generateSecret,
  MerkleTree,
  poseidon4,
  tokenHash,
} from "./index.js";

describe("sdk crypto", () => {
  it("generateSecret is in Fr", () => {
    const s = generateSecret();
    assert.equal(typeof s, "bigint");
    assert.ok(s > 0n);
  });

  it("nullifier and commitment are deterministic", async () => {
    const secret = 12345n;
    const digest = 42n;
    const amount = 10_000_000n;
    const th = 1n;
    const n1 = await generateNullifier(secret);
    const n2 = await generateNullifier(secret);
    assert.equal(n1, n2);
    const c1 = await poseidon4(secret, digest, amount, th);
    const c2 = await poseidon4(secret, digest, amount, th);
    assert.equal(c1, c2);
  });

  it("tokenHash matches uint160", () => {
    const addr = "0x0000000000000000000000000000000000000001";
    assert.equal(tokenHash(addr), 1n);
  });

  it("createNote + merkle insert/proof", async () => {
    const note = await createNote({
      recipientDigest: 42n,
      amount: 10_000_000n,
      token: "0x0000000000000000000000000000000000000001",
      secret: 12345n,
    });
    assert.ok(note.commitment > 0n);
    assert.ok(frToBytes32(note.commitment).startsWith("0x"));

    const tree = await MerkleTree.create(20);
    const idx = await tree.insert(note.commitment);
    assert.equal(idx, 0);
    const proof = await tree.proof(0);
    assert.equal(proof.pathElements.length, 20);
    assert.equal(proof.pathIndices.length, 20);
    assert.equal(proof.root, await tree.root());
  });
});
