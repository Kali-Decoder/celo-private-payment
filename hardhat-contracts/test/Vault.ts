import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import type {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {deployUUPSProxy} from "../scripts/lib/proxy";

const ONE = 1_000_000n;
const TEN = 10n * ONE;
const DIGEST = hre.ethers.id("recipient-digest-1");

describe("Vault protocol (UUPS)", function () {
  async function deployFixture() {
    const [owner, alice, bob, relayer] = await hre.ethers.getSigners();

    const verifier = await (await hre.ethers.getContractFactory("DepositVerifier")).deploy();
    const rootManager = await (
      await hre.ethers.getContractFactory("MerkleRootManager")
    ).deploy(relayer.address);

    const FeeManager = await hre.ethers.getContractFactory("FeeManager");
    const feeManager = await deployUUPSProxy(FeeManager, [owner.address]);
    await feeManager.setFeeConfig(hre.ethers.ZeroAddress, 0, 0);

    const Treasury = await hre.ethers.getContractFactory("Treasury");
    const treasury = await deployUUPSProxy(Treasury, [owner.address, owner.address]);

    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = await deployUUPSProxy(Vault, [
      owner.address,
      await verifier.getAddress(),
      await rootManager.getAddress(),
      await treasury.getAddress(),
    ]);

    const NFT = await hre.ethers.getContractFactory("PaymentNFT");
    const nft = await deployUUPSProxy(NFT, [owner.address]);
    await nft.setVault(await vault.getAddress());
    await vault.setNftContract(await nft.getAddress());
    await vault.setFeeManager(await feeManager.getAddress());

    const usdc = await (await hre.ethers.getContractFactory("MockUSDC")).deploy(owner.address);
    await usdc.mint(alice.address, 1_000n * ONE);
    await usdc.mint(bob.address, 1_000n * ONE);
    await vault.setToken(await usdc.getAddress(), TEN);

    return {owner, alice, bob, relayer, verifier, rootManager, vault, nft, usdc, feeManager, treasury};
  }

  async function depositAndPostRoot(
    vault: Awaited<ReturnType<typeof deployFixture>>["vault"],
    usdc: Awaited<ReturnType<typeof deployFixture>>["usdc"],
    rootManager: Awaited<ReturnType<typeof deployFixture>>["rootManager"],
    depositor: HardhatEthersSigner,
    relayer: HardhatEthersSigner,
    commitment: string
  ) {
    await usdc.connect(depositor).approve(await vault.getAddress(), TEN);
    const tx = await vault.connect(depositor).deposit(commitment);
    const receipt = await tx.wait();
    const parsed = receipt!.logs
      .map((l) => {
        try {
          return vault.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l) => l && l.name === "Deposit");
    const depositId = parsed!.args.depositId as bigint;
    const tokenId = parsed!.args.tokenId as bigint;
    const root = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["bytes32", "uint256"], [commitment, TEN])
    );
    await rootManager.connect(relayer).postRoot(root);
    return {root, depositId, tokenId};
  }

  async function stageProof(
    nft: Awaited<ReturnType<typeof deployFixture>>["nft"],
    owner: HardhatEthersSigner,
    tokenId: bigint,
    root: string,
    nullifier: string,
    digest: string = DIGEST
  ) {
    await nft.connect(owner).setRedemptionProof(tokenId, "0x01", root, nullifier, digest);
  }

  describe("MerkleRootManager", function () {
    it("posts roots and reports latest / known", async function () {
      const {rootManager, relayer} = await loadFixture(deployFixture);
      const root = hre.ethers.id("root-1");
      await expect(rootManager.connect(relayer).postRoot(root))
        .to.emit(rootManager, "RootPosted")
        .withArgs(root, 0, 1n);
      expect(await rootManager.isKnownRoot(root)).to.equal(true);
      expect(await rootManager.latestRoot()).to.equal(root);
    });

    it("rejects zero root, duplicate, and non-owner", async function () {
      const {rootManager, relayer, alice} = await loadFixture(deployFixture);
      const root = hre.ethers.id("root-1");
      await expect(rootManager.connect(relayer).postRoot(hre.ethers.ZeroHash)).to.be
        .revertedWithCustomError(rootManager, "ZeroRoot");
      await rootManager.connect(relayer).postRoot(root);
      await expect(rootManager.connect(relayer).postRoot(root)).to.be.revertedWithCustomError(
        rootManager,
        "RootAlreadyKnown"
      );
      await expect(rootManager.connect(alice).postRoot(hre.ethers.id("root-2"))).to.be
        .revertedWithCustomError(rootManager, "OwnableUnauthorizedAccount");
    });

    it("tracks multiple roots and latest", async function () {
      const {rootManager, relayer} = await loadFixture(deployFixture);
      const r1 = hre.ethers.id("root-a");
      const r2 = hre.ethers.id("root-b");
      await rootManager.connect(relayer).postRoot(r1);
      await rootManager.connect(relayer).postRoot(r2);
      expect(await rootManager.isKnownRoot(r1)).to.equal(true);
      expect(await rootManager.isKnownRoot(r2)).to.equal(true);
      expect(await rootManager.latestRoot()).to.equal(r2);
    });
  });

  describe("Deposit", function () {
    it("pulls tokens, mints NFT, emits Deposit", async function () {
      const {vault, nft, usdc, alice} = await loadFixture(deployFixture);
      const token = await usdc.getAddress();
      const commitment = hre.ethers.id("note-1");
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await expect(vault.connect(alice).deposit(commitment))
        .to.emit(vault, "Deposit")
        .withArgs(commitment, 0, token, TEN, 0, 1);
      expect(await vault.depositCounter()).to.equal(1);
      expect(await nft.ownerOf(1)).to.equal(alice.address);
      expect(await vault.commitments(commitment)).to.equal(true);
      expect(await vault.commitmentToDepositId(commitment)).to.equal(0);
    });

    it("increments leaf index across deposits", async function () {
      const {vault, usdc, alice, bob} = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await usdc.connect(bob).approve(await vault.getAddress(), TEN);
      await vault.connect(alice).deposit(hre.ethers.id("c1"));
      await expect(vault.connect(bob).deposit(hre.ethers.id("c2")))
        .to.emit(vault, "Deposit")
        .withArgs(hre.ethers.id("c2"), 1, await usdc.getAddress(), TEN, 1, 2);
      expect(await vault.depositCounter()).to.equal(2);
      expect(await vault.nextDepositId()).to.equal(2);
    });

    it("rejects zero commitment", async function () {
      const {vault, usdc, alice} = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await expect(vault.connect(alice).deposit(hre.ethers.ZeroHash)).to.be.revertedWithCustomError(
        vault,
        "InvalidCommitment"
      );
    });

    it("rejects duplicate commitment", async function () {
      const {vault, usdc, alice} = await loadFixture(deployFixture);
      const commitment = hre.ethers.id("dup");
      await usdc.connect(alice).approve(await vault.getAddress(), TEN * 2n);
      await vault.connect(alice).deposit(commitment);
      await expect(vault.connect(alice).deposit(commitment)).to.be.revertedWithCustomError(
        vault,
        "CommitmentExists"
      );
    });

    it("rejects when paused", async function () {
      const {vault, usdc, alice, owner} = await loadFixture(deployFixture);
      await vault.connect(owner).pause();
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await expect(vault.connect(alice).deposit(hre.ethers.id("paused"))).to.be
        .revertedWithCustomError(vault, "EnforcedPause");
    });

    it("rejects deposit before token configured", async function () {
      const [owner, alice, , relayer] = await hre.ethers.getSigners();
      const verifier = await (await hre.ethers.getContractFactory("DepositVerifier")).deploy();
      const rootManager = await (
        await hre.ethers.getContractFactory("MerkleRootManager")
      ).deploy(relayer.address);
      const Vault = await hre.ethers.getContractFactory("Vault");
      const vault = await deployUUPSProxy(Vault, [
        owner.address,
        await verifier.getAddress(),
        await rootManager.getAddress(),
        owner.address,
      ]);
      const NFT = await hre.ethers.getContractFactory("PaymentNFT");
      const nft = await deployUUPSProxy(NFT, [owner.address]);
      await nft.setVault(await vault.getAddress());
      await vault.setNftContract(await nft.getAddress());

      await expect(vault.connect(alice).deposit(hre.ethers.id("x"))).to.be.revertedWithCustomError(
        vault,
        "TokenNotConfigured"
      );
    });

    it("rejects deposit before NFT configured", async function () {
      const [owner, alice, , relayer] = await hre.ethers.getSigners();
      const verifier = await (await hre.ethers.getContractFactory("DepositVerifier")).deploy();
      const rootManager = await (
        await hre.ethers.getContractFactory("MerkleRootManager")
      ).deploy(relayer.address);
      const Vault = await hre.ethers.getContractFactory("Vault");
      const vault = await deployUUPSProxy(Vault, [
        owner.address,
        await verifier.getAddress(),
        await rootManager.getAddress(),
        owner.address,
      ]);
      const usdc = await (await hre.ethers.getContractFactory("MockUSDC")).deploy(owner.address);
      await vault.setToken(await usdc.getAddress(), TEN);

      await expect(vault.connect(alice).deposit(hre.ethers.id("x"))).to.be.revertedWithCustomError(
        vault,
        "NftNotConfigured"
      );
    });

    it("depositTo mints NFT to recipient with custom amount and note", async function () {
      const {vault, nft, usdc, alice, bob} = await loadFixture(deployFixture);
      const amount = 5n * ONE;
      const commitment = hre.ethers.id("to-bob");
      const noteURI = "redsand://note/encrypted-v1";
      await usdc.connect(alice).approve(await vault.getAddress(), amount);

      await expect(
        vault
          .connect(alice)
          .depositTo(commitment, await usdc.getAddress(), amount, bob.address, noteURI)
      )
        .to.emit(vault, "Deposit")
        .withArgs(commitment, 0, await usdc.getAddress(), amount, 0, 1)
        .and.to.emit(vault, "PaymentIssued")
        .withArgs(0, 1, bob.address, alice.address, noteURI);

      expect(await nft.ownerOf(1)).to.equal(bob.address);
      const meta = await nft.metaOf(1);
      expect(meta.depositId).to.equal(0);
      expect(meta.metadataURI).to.equal(noteURI);

      const info = await vault.deposits(0);
      expect(info.token).to.equal(await usdc.getAddress());
      expect(info.amount).to.equal(amount);
      expect(info.redeemed).to.equal(false);
    });

    it("depositTo with zero recipient mints to depositor", async function () {
      const {vault, nft, usdc, alice} = await loadFixture(deployFixture);
      const amount = ONE;
      await usdc.connect(alice).approve(await vault.getAddress(), amount);
      await vault
        .connect(alice)
        .depositTo(hre.ethers.id("self"), await usdc.getAddress(), amount, hre.ethers.ZeroAddress, "");
      expect(await nft.ownerOf(1)).to.equal(alice.address);
    });

    it("rejects unsupported token and zero amount on depositTo", async function () {
      const {vault, usdc, alice, owner} = await loadFixture(deployFixture);
      const other = await (await hre.ethers.getContractFactory("MockUSDC")).deploy(owner.address);
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await expect(
        vault
          .connect(alice)
          .depositTo(hre.ethers.id("bad-token"), await other.getAddress(), TEN, alice.address, "")
      ).to.be.revertedWithCustomError(vault, "TokenNotSupported");
      await expect(
        vault
          .connect(alice)
          .depositTo(hre.ethers.id("zero-amt"), await usdc.getAddress(), 0, alice.address, "")
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });
  });

  describe("Redeem", function () {
    it("pays claimant, burns NFT, marks nullifier", async function () {
      const {vault, nft, usdc, alice, relayer, rootManager, treasury} =
        await loadFixture(deployFixture);
      const commitment = hre.ethers.id("note-1");
      const {root, depositId, tokenId} = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        alice,
        relayer,
        commitment
      );
      const nullifier = hre.ethers.id("null-1");
      const before = await usdc.balanceOf(alice.address);

      await stageProof(nft, alice, tokenId, root, nullifier);

      await expect(vault.connect(alice).redeem(depositId))
        .to.emit(vault, "Redeemed")
        .withArgs(depositId, nullifier, alice.address, await treasury.getAddress(), 0, TEN);

      expect(await vault.nullifierSpent(nullifier)).to.equal(true);
      expect(await usdc.balanceOf(alice.address)).to.equal(before + TEN);
      await expect(nft.ownerOf(tokenId)).to.be.reverted;
      const dep = await vault.deposits(depositId);
      expect(dep.redeemed).to.equal(true);
    });

    it("redeems depositTo variable amount to NFT recipient", async function () {
      const {vault, nft, usdc, alice, bob, relayer, rootManager, treasury} =
        await loadFixture(deployFixture);
      const amount = 3n * ONE;
      const commitment = hre.ethers.id("var-amt-redeem");
      const nullifier = hre.ethers.id("nullifier-var");
      await usdc.connect(alice).approve(await vault.getAddress(), amount);
      const tx = await vault
        .connect(alice)
        .depositTo(commitment, await usdc.getAddress(), amount, bob.address, "note://x");
      const receipt = await tx.wait();
      const parsed = receipt!.logs
        .map((l) => {
          try {
            return vault.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((l) => l && l.name === "Deposit");
      const depositId = parsed!.args.depositId as bigint;
      const tokenId = parsed!.args.tokenId as bigint;

      const root = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["bytes32", "uint256"], [commitment, amount])
      );
      await rootManager.connect(relayer).postRoot(root);
      await stageProof(nft, bob, tokenId, root, nullifier);

      await expect(vault.connect(alice).redeem(depositId)).to.be.revertedWithCustomError(
        vault,
        "NotClaimOwner"
      );

      const before = await usdc.balanceOf(bob.address);
      await expect(vault.connect(bob).redeem(depositId))
        .to.emit(vault, "Redeemed")
        .withArgs(depositId, nullifier, bob.address, await treasury.getAddress(), 0, amount);
      expect(await usdc.balanceOf(bob.address)).to.equal(before + amount);
      expect((await vault.deposits(depositId)).amount).to.equal(amount);
      expect((await vault.deposits(depositId)).token).to.equal(await usdc.getAddress());
    });

    it("deducts fee and sends it to feeRecipient", async function () {
      const {vault, nft, usdc, alice, relayer, rootManager, feeManager, treasury} =
        await loadFixture(deployFixture);
      // 1% of 10e6 = 100_000
      await feeManager.setFeeConfig(await usdc.getAddress(), 0, 100);

      const {root, depositId, tokenId} = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        alice,
        relayer,
        hre.ethers.id("fee-note")
      );
      const nullifier = hre.ethers.id("null-fee");
      const fee = 100_000n;
      const payout = TEN - fee;
      const aliceBefore = await usdc.balanceOf(alice.address);
      const treasuryBefore = await usdc.balanceOf(await treasury.getAddress());

      await stageProof(nft, alice, tokenId, root, nullifier);
      await expect(vault.connect(alice).redeem(depositId))
        .to.emit(vault, "Redeemed")
        .withArgs(
          depositId,
          nullifier,
          alice.address,
          await treasury.getAddress(),
          fee,
          payout
        );

      expect(await usdc.balanceOf(alice.address)).to.equal(aliceBefore + payout);
      expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(treasuryBefore + fee);
    });

    it("rejects missing deposit", async function () {
      const {vault, alice} = await loadFixture(deployFixture);
      await expect(vault.connect(alice).redeem(999)).to.be.revertedWithCustomError(
        vault,
        "DepositMissing"
      );
    });

    it("rejects non-owner of claim NFT", async function () {
      const {vault, nft, usdc, alice, bob, relayer, rootManager} = await loadFixture(deployFixture);
      const {root, depositId, tokenId} = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        alice,
        relayer,
        hre.ethers.id("owner-check")
      );
      await stageProof(nft, alice, tokenId, root, hre.ethers.id("n1"));
      await expect(vault.connect(bob).redeem(depositId)).to.be.revertedWithCustomError(
        vault,
        "NotClaimOwner"
      );
    });

    it("rejects when no proof staged", async function () {
      const {vault, usdc, alice, relayer, rootManager} = await loadFixture(deployFixture);
      const {depositId} = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        alice,
        relayer,
        hre.ethers.id("no-proof")
      );
      await expect(vault.connect(alice).redeem(depositId)).to.be.revertedWithCustomError(
        vault,
        "NoProofStaged"
      );
    });

    it("rejects unknown merkle root", async function () {
      const {vault, nft, usdc, alice, relayer, rootManager} = await loadFixture(deployFixture);
      const {tokenId, depositId} = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        alice,
        relayer,
        hre.ethers.id("bad-root")
      );
      const fakeRoot = hre.ethers.id("not-posted");
      await stageProof(nft, alice, tokenId, fakeRoot, hre.ethers.id("n-root"));
      await expect(vault.connect(alice).redeem(depositId)).to.be.revertedWithCustomError(
        vault,
        "RootNotFound"
      );
    });

    it("rejects double redeem / already redeemed", async function () {
      const {vault, nft, usdc, alice, relayer, rootManager} = await loadFixture(deployFixture);
      const {root, depositId, tokenId} = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        alice,
        relayer,
        hre.ethers.id("once")
      );
      await stageProof(nft, alice, tokenId, root, hre.ethers.id("n-once"));
      await vault.connect(alice).redeem(depositId);
      await expect(vault.connect(alice).redeem(depositId)).to.be.revertedWithCustomError(
        vault,
        "AlreadyRedeemed"
      );
    });

    it("rejects reused nullifier across deposits", async function () {
      const {vault, nft, usdc, alice, bob, relayer, rootManager} = await loadFixture(deployFixture);
      const nullifier = hre.ethers.id("shared-null");

      const d1 = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        alice,
        relayer,
        hre.ethers.id("n1")
      );
      await stageProof(nft, alice, d1.tokenId, d1.root, nullifier);
      await vault.connect(alice).redeem(d1.depositId);

      const d2 = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        bob,
        relayer,
        hre.ethers.id("n2")
      );
      await stageProof(nft, bob, d2.tokenId, d2.root, nullifier);
      await expect(vault.connect(bob).redeem(d2.depositId)).to.be.revertedWithCustomError(
        vault,
        "NullifierAlreadyUsed"
      );
    });

    it("rejects when verifier returns false", async function () {
      const {vault, nft, usdc, alice, relayer, rootManager, owner} = await loadFixture(deployFixture);
      const rejecting = await (await hre.ethers.getContractFactory("RejectingVerifier")).deploy();
      await vault.connect(owner).setVerifier(await rejecting.getAddress());

      const {root, depositId, tokenId} = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        alice,
        relayer,
        hre.ethers.id("reject")
      );
      await stageProof(nft, alice, tokenId, root, hre.ethers.id("n-rej"));
      await expect(vault.connect(alice).redeem(depositId)).to.be.revertedWithCustomError(
        vault,
        "InvalidProof"
      );
    });

    it("rejects redeem when paused", async function () {
      const {vault, nft, usdc, alice, relayer, rootManager, owner} = await loadFixture(deployFixture);
      const {root, depositId, tokenId} = await depositAndPostRoot(
        vault,
        usdc,
        rootManager,
        alice,
        relayer,
        hre.ethers.id("pause-redeem")
      );
      await stageProof(nft, alice, tokenId, root, hre.ethers.id("n-pr"));
      await vault.connect(owner).pause();
      await expect(vault.connect(alice).redeem(depositId)).to.be.revertedWithCustomError(
        vault,
        "EnforcedPause"
      );
    });
  });

  describe("Vault owner config", function () {
    it("tokenHashOf truncates address", async function () {
      const {vault, usdc} = await loadFixture(deployFixture);
      const token = await usdc.getAddress();
      expect(await vault.tokenHashOf(token)).to.equal(BigInt(token));
    });

    it("rejects setToken after first deposit", async function () {
      const {vault, usdc, alice, owner} = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await vault.connect(alice).deposit(hre.ethers.id("lock-token"));
      await expect(
        vault.connect(owner).setToken(await usdc.getAddress(), TEN)
      ).to.be.revertedWithCustomError(vault, "TokenAlreadySet");
    });

    it("rejects invalid setToken args", async function () {
      const [owner, , , relayer] = await hre.ethers.getSigners();
      const verifier = await (await hre.ethers.getContractFactory("DepositVerifier")).deploy();
      const rootManager = await (
        await hre.ethers.getContractFactory("MerkleRootManager")
      ).deploy(relayer.address);
      const Vault = await hre.ethers.getContractFactory("Vault");
      const vault = await deployUUPSProxy(Vault, [
        owner.address,
        await verifier.getAddress(),
        await rootManager.getAddress(),
        owner.address,
      ]);
      const usdc = await (await hre.ethers.getContractFactory("MockUSDC")).deploy(owner.address);

      await expect(vault.setToken(hre.ethers.ZeroAddress, TEN)).to.be.revertedWithCustomError(
        vault,
        "ZeroAddress"
      );
      await expect(vault.setToken(await usdc.getAddress(), 0)).to.be.revertedWithCustomError(
        vault,
        "InvalidDenomination"
      );
    });

    it("only owner can update verifier / fee recipient / nft", async function () {
      const {vault, alice, verifier} = await loadFixture(deployFixture);
      await expect(vault.connect(alice).setVerifier(await verifier.getAddress())).to.be
        .revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(vault.connect(alice).setFeeRecipient(alice.address)).to.be
        .revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(vault.connect(alice).setNftContract(alice.address)).to.be
        .revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("setVerifier and setFeeRecipient update state", async function () {
      const {vault, owner, alice, verifier} = await loadFixture(deployFixture);
      const next = await (await hre.ethers.getContractFactory("DepositVerifier")).deploy();
      await expect(vault.connect(owner).setVerifier(await next.getAddress()))
        .to.emit(vault, "VerifierUpdated")
        .withArgs(await verifier.getAddress(), await next.getAddress());
      expect(await vault.verifier()).to.equal(await next.getAddress());

      await expect(vault.connect(owner).setFeeRecipient(alice.address))
        .to.emit(vault, "FeeRecipientUpdated")
        .withArgs(alice.address);
      expect(await vault.feeRecipient()).to.equal(alice.address);
    });

    it("emergencyWithdraw only while paused", async function () {
      const {vault, usdc, alice, owner} = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await vault.connect(alice).deposit(hre.ethers.id("ew"));

      await expect(
        vault.connect(owner).emergencyWithdraw(await usdc.getAddress(), owner.address, TEN)
      ).to.be.revertedWithCustomError(vault, "ExpectedPause");

      await vault.connect(owner).pause();
      const before = await usdc.balanceOf(owner.address);
      await expect(
        vault.connect(owner).emergencyWithdraw(await usdc.getAddress(), owner.address, TEN)
      )
        .to.emit(vault, "EmergencyWithdraw")
        .withArgs(await usdc.getAddress(), owner.address, TEN);
      expect(await usdc.balanceOf(owner.address)).to.equal(before + TEN);
    });
  });

  describe("PaymentNFT", function () {
    it("only vault can mint / burn", async function () {
      const {nft, alice} = await loadFixture(deployFixture);
      await expect(nft.connect(alice).mintFor(alice.address, 0)).to.be.revertedWithCustomError(
        nft,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("only NFT owner can stage proof and set metadata", async function () {
      const {vault, nft, usdc, alice, bob} = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await vault.connect(alice).deposit(hre.ethers.id("nft-meta"));
      const tokenId = 1n;

      await expect(
        nft.connect(bob).setRedemptionProof(tokenId, "0x01", hre.ethers.id("r"), hre.ethers.id("n"), DIGEST)
      ).to.be.revertedWith("not owner");

      await expect(nft.connect(bob).setMetadataURI(tokenId, "ipfs://x")).to.be.revertedWith(
        "not owner"
      );

      await nft.connect(alice).setMetadataURI(tokenId, "ipfs://claim");
      expect(await nft.tokenURI(tokenId)).to.equal("ipfs://claim");
    });

    it("rejects empty proof / zero nullifier / zero digest", async function () {
      const {vault, nft, usdc, alice} = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await vault.connect(alice).deposit(hre.ethers.id("nft-proof"));
      const tokenId = 1n;
      const root = hre.ethers.id("r");

      await expect(
        nft.connect(alice).setRedemptionProof(tokenId, "0x", root, hre.ethers.id("n"), DIGEST)
      ).to.be.revertedWith("empty proof");
      await expect(
        nft.connect(alice).setRedemptionProof(tokenId, "0x01", root, hre.ethers.ZeroHash, DIGEST)
      ).to.be.revertedWith("zero nullifier");
      await expect(
        nft
          .connect(alice)
          .setRedemptionProof(tokenId, "0x01", root, hre.ethers.id("n"), hre.ethers.ZeroHash)
      ).to.be.revertedWith("zero digest");
    });

    it("stores and returns redemption proof", async function () {
      const {vault, nft, usdc, alice} = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await vault.connect(alice).deposit(hre.ethers.id("nft-get"));
      const tokenId = 1n;
      const root = hre.ethers.id("root-g");
      const nullifier = hre.ethers.id("null-g");
      await nft.connect(alice).setRedemptionProof(tokenId, "0xabcd", root, nullifier, DIGEST);
      const proof = await nft.getRedemptionProof(tokenId);
      expect(proof.proof).to.equal("0xabcd");
      expect(proof.root).to.equal(root);
      expect(proof.nullifier).to.equal(nullifier);
      expect(proof.recipientDigest).to.equal(DIGEST);
    });
  });

  describe("FeeManager", function () {
    it("computes flat + percent fee", async function () {
      const {feeManager, usdc} = await loadFixture(deployFixture);
      const token = await usdc.getAddress();
      await feeManager.setFeeConfig(token, 1_000n, 50); // flat 1000 + 0.5%
      expect(await feeManager.computeFee(token, TEN)).to.equal(1_000n + (TEN * 50n) / 10_000n);
    });

    it("falls back to default (address(0)) config", async function () {
      const {feeManager} = await loadFixture(deployFixture);
      await feeManager.setFeeConfig(hre.ethers.ZeroAddress, 0, 30);
      const unknown = hre.ethers.getAddress("0x00000000000000000000000000000000000000aa");
      expect(await feeManager.computeFee(unknown, TEN)).to.equal((TEN * 30n) / 10_000n);
    });

    it("rejects percent above 100%", async function () {
      const {feeManager, usdc} = await loadFixture(deployFixture);
      await expect(feeManager.setFeeConfig(await usdc.getAddress(), 0, 10_001)).to.be.revertedWith(
        "percent too high"
      );
    });

    it("only admin can set fee config", async function () {
      const {feeManager, usdc, alice} = await loadFixture(deployFixture);
      await expect(
        feeManager.connect(alice).setFeeConfig(await usdc.getAddress(), 0, 10)
      ).to.be.revertedWithCustomError(feeManager, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Treasury", function () {
    it("governor can withdraw; others cannot", async function () {
      const {treasury, usdc, owner, alice} = await loadFixture(deployFixture);
      await usdc.mint(await treasury.getAddress(), TEN);
      expect(await treasury.balanceOf(await usdc.getAddress())).to.equal(TEN);

      await expect(
        treasury.connect(alice).withdraw(await usdc.getAddress(), alice.address, TEN)
      ).to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount");

      await expect(treasury.connect(owner).withdraw(await usdc.getAddress(), alice.address, TEN))
        .to.emit(treasury, "Withdrawn")
        .withArgs(await usdc.getAddress(), alice.address, TEN);
      expect(await usdc.balanceOf(alice.address)).to.equal(1_000n * ONE + TEN);
    });

    it("emits Received on notifyReceived", async function () {
      const {treasury, usdc, alice} = await loadFixture(deployFixture);
      await expect(treasury.connect(alice).notifyReceived(await usdc.getAddress(), 123n))
        .to.emit(treasury, "Received")
        .withArgs(await usdc.getAddress(), alice.address, 123n);
    });
  });

  describe("AdminController + UUPS upgrade", function () {
    async function adminFixture() {
      const base = await deployFixture();
      const {owner, vault, feeManager, nft, treasury} = base;

      const Admin = await hre.ethers.getContractFactory("AdminController");
      const admin = await deployUUPSProxy(Admin, [owner.address]);
      await admin.setVault(await vault.getAddress());
      await admin.setFeeManager(await feeManager.getAddress());
      await admin.setPaymentNft(await nft.getAddress());
      await admin.setTreasury(await treasury.getAddress());
      await admin.setPausableContracts([await vault.getAddress()]);

      await feeManager.grantRole(await feeManager.ADMIN_ROLE(), await admin.getAddress());
      await feeManager.grantRole(await feeManager.UPGRADER_ROLE(), await admin.getAddress());
      await nft.grantRole(await nft.UPGRADER_ROLE(), await admin.getAddress());
      await treasury.grantRole(await treasury.UPGRADER_ROLE(), await admin.getAddress());

      await vault.transferOwnership(await admin.getAddress());
      await admin.acceptVaultOwnership();

      return {...base, admin};
    }

    it("owns Vault and can pause / set fees", async function () {
      const {admin, vault, feeManager, usdc, owner, alice} = await loadFixture(adminFixture);
      expect(await vault.owner()).to.equal(await admin.getAddress());

      await expect(admin.connect(owner).emergencyPauseAll()).to.emit(admin, "ProtocolPaused");
      expect(await vault.paused()).to.equal(true);

      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await expect(vault.connect(alice).deposit(hre.ethers.id("paused"))).to.be
        .revertedWithCustomError(vault, "EnforcedPause");

      await admin.connect(owner).unpauseAll();
      await admin.connect(owner).setFeeConfig(await usdc.getAddress(), 0, 50);
      const cfg = await feeManager.feeConfigs(await usdc.getAddress());
      expect(cfg.percentBps).to.equal(50);
    });

    it("upgrades Vault implementation via AdminController", async function () {
      const {admin, vault, owner, alice, usdc} = await loadFixture(adminFixture);

      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await vault.connect(alice).deposit(hre.ethers.id("pre-upgrade"));
      expect(await vault.depositCounter()).to.equal(1);

      const Vault = await hre.ethers.getContractFactory("Vault");
      const newImpl = await Vault.deploy();
      await newImpl.waitForDeployment();

      await expect(admin.connect(owner).upgradeVault(await newImpl.getAddress(), "0x"))
        .to.emit(admin, "ProxyUpgraded")
        .withArgs(await vault.getAddress(), await newImpl.getAddress());

      expect(await vault.depositCounter()).to.equal(1);
      expect(await vault.denomination()).to.equal(TEN);
      expect(await vault.owner()).to.equal(await admin.getAddress());
    });

    it("rejects non-role callers for pause / fee / upgrade", async function () {
      const {admin, alice, vault} = await loadFixture(adminFixture);
      await expect(admin.connect(alice).emergencyPauseAll()).to.be.revertedWithCustomError(
        admin,
        "AccessControlUnauthorizedAccount"
      );
      await expect(admin.connect(alice).setFeeConfig(alice.address, 0, 1)).to.be
        .revertedWithCustomError(admin, "AccessControlUnauthorizedAccount");
      await expect(admin.connect(alice).upgradeVault(await vault.getAddress(), "0x")).to.be
        .revertedWithCustomError(admin, "AccessControlUnauthorizedAccount");
    });

    it("setVerifier via AdminController", async function () {
      const {admin, vault, owner} = await loadFixture(adminFixture);
      const next = await (await hre.ethers.getContractFactory("DepositVerifier")).deploy();
      await expect(admin.connect(owner).setVerifier(await next.getAddress()))
        .to.emit(admin, "VerifierSet")
        .withArgs(await next.getAddress());
      expect(await vault.verifier()).to.equal(await next.getAddress());
    });

    it("emergencyWithdrawFromVault when paused", async function () {
      const {admin, vault, usdc, owner, alice} = await loadFixture(adminFixture);
      await usdc.connect(alice).approve(await vault.getAddress(), TEN);
      await vault.connect(alice).deposit(hre.ethers.id("admin-ew"));
      await admin.connect(owner).emergencyPauseAll();

      const before = await usdc.balanceOf(owner.address);
      await admin
        .connect(owner)
        .emergencyWithdrawFromVault(await usdc.getAddress(), owner.address, TEN);
      expect(await usdc.balanceOf(owner.address)).to.equal(before + TEN);
    });

    it("upgrades FeeManager / PaymentNFT / Treasury", async function () {
      const {admin, feeManager, nft, treasury, owner} = await loadFixture(adminFixture);

      const FeeManager = await hre.ethers.getContractFactory("FeeManager");
      const feeImpl = await FeeManager.deploy();
      await expect(admin.connect(owner).upgradeFeeManager(await feeImpl.getAddress(), "0x"))
        .to.emit(admin, "ProxyUpgraded")
        .withArgs(await feeManager.getAddress(), await feeImpl.getAddress());

      const NFT = await hre.ethers.getContractFactory("PaymentNFT");
      const nftImpl = await NFT.deploy();
      await expect(admin.connect(owner).upgradePaymentNft(await nftImpl.getAddress(), "0x"))
        .to.emit(admin, "ProxyUpgraded")
        .withArgs(await nft.getAddress(), await nftImpl.getAddress());

      const Treasury = await hre.ethers.getContractFactory("Treasury");
      const trImpl = await Treasury.deploy();
      await expect(admin.connect(owner).upgradeTreasury(await trImpl.getAddress(), "0x"))
        .to.emit(admin, "ProxyUpgraded")
        .withArgs(await treasury.getAddress(), await trImpl.getAddress());
    });
  });
});
