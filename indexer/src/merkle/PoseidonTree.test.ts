import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {PoseidonTree} from "./PoseidonTree.js";

describe("PoseidonTree", () => {
  it("inserts in order and returns depth-20 witnesses", async () => {
    const tree = new PoseidonTree(20);
    await tree.init();

    const c0 =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    const c1 =
      "0x0000000000000000000000000000000000000000000000000000000000000002";

    const a = await tree.insert(c0);
    assert.equal(a.leafIndex, 0);
    const b = await tree.insert(c1);
    assert.equal(b.leafIndex, 1);
    assert.notEqual(a.root, b.root);

    const w = await tree.witnessByCommitment(c0);
    assert.ok(w);
    assert.equal(w!.leafIndex, 0);
    assert.equal(w!.siblings.length, 20);
    assert.equal(w!.pathIndices.length, 20);
    assert.equal(w!.root, b.root);
  });

  it("rebuild preserves order", async () => {
    const leaves = [
      "0x000000000000000000000000000000000000000000000000000000000000000a",
      "0x000000000000000000000000000000000000000000000000000000000000000b",
      "0x000000000000000000000000000000000000000000000000000000000000000c",
    ];
    const t1 = new PoseidonTree(20);
    const root1 = await t1.rebuild(leaves);
    const t2 = new PoseidonTree(20);
    const root2 = await t2.rebuild(leaves);
    assert.equal(root1, root2);
    assert.equal(t1.size, 3);
  });
});
