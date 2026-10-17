/**
 * End-to-end flow on Celo Sepolia using the deployer private key
 * (`CELO_SEPOLIA_PRIVATE_KEY` / `PRIVATE_KEY`).
 *
 * Product path under test (Idea A):
 *   mint → create note → deposit → postRoot → stage proof on NFT → redeem
 *
 * Notes:
 *   - Does NOT require the indexer (this script posts the Merkle root itself).
 *   - Uses the deployed mock DepositVerifier, so proof bytes can be "0x01".
 *   - For a real Groth16 path later: deploy WithdrawVerifier + SDK generateProof.
 *
 * Usage:
 *   pnpm e2e
 *   hardhat run test/e2e-flow.ts --network celoSepolia
 */
import {execFileSync} from "node:child_process";
import path from "node:path";
import hre from "hardhat";
import {requireDeployment, vaultAddress} from "../scripts/lib/deployments";
import {getDeployer, networkName, chainId} from "../scripts/lib/env";
import {waitForClearMempool} from "../scripts/lib/proxy";

interface NotePayload {
  commitmentBytes32: `0x${string}`;
  nullifierBytes32: `0x${string}`;
  recipientDigestBytes32: `0x${string}`;
}

/**
 * Build a Poseidon note via the ESM SDK helper.
 * Hardhat runs as CJS, so we shell out to `test/helpers/create-note.mjs`.
 */
function createNote(amount: bigint, token: string): NotePayload {
  const helper = path.join(__dirname, "helpers", "create-note.mjs");
  const out = execFileSync(process.execPath, [helper], {
    encoding: "utf8",
    env: {
      ...process.env,
      E2E_AMOUNT: amount.toString(),
      E2E_TOKEN: token,
    },
  });
  const line = out.trim().split("\n").filter(Boolean).pop();
  if (!line) throw new Error("create-note helper returned no output");
  return JSON.parse(line) as NotePayload;
}

/**
 * Send one write tx safely — wait for a clear mempool before and after each send.
 */
async function send(
  deployer: {address: string},
  label: string,
  sendTx: () => Promise<{hash: string; wait: (n?: number) => Promise<unknown>}>
) {
  await waitForClearMempool(deployer.address, `${label} (pre)`);
  const tx = await sendTx();
  console.log(`  ${label}: ${tx.hash}`);
  await tx.wait(1);
  await waitForClearMempool(deployer.address, `${label} (post)`);
}

async function main() {
  // ── Step 0: Load deployer + deployed addresses ───────────────────────────
  // Signer comes from CELO_SEPOLIA_PRIVATE_KEY in hardhat.config / .env.
  // Addresses come from deployments/celoSepolia.json (from deploy:all).
  const deployer = await getDeployer();
  const network = networkName();
  const cid = await chainId();
  const deployment = requireDeployment(network);

  const vaultAddr = vaultAddress(deployment);
  const nftAddr = deployment.contracts.PaymentNFT;
  const usdcAddr = deployment.contracts.MockUSDC;
  const rootManagerAddr = deployment.contracts.MerkleRootManager;

  if (!vaultAddr || !nftAddr || !usdcAddr || !rootManagerAddr) {
    throw new Error(
      "deployments file missing Vault / PaymentNFT / MockUSDC / MerkleRootManager"
    );
  }

  console.log(`\n=== Redsand E2E (${network} / chainId ${cid}) ===`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Vault:    ${vaultAddr}`);
  console.log(`NFT:      ${nftAddr}`);
  console.log(`USDC:     ${usdcAddr}`);
  console.log(`Roots:    ${rootManagerAddr}\n`);

  // Attach to live proxies / contracts.
  const vault = await hre.ethers.getContractAt("Vault", vaultAddr);
  const nft = await hre.ethers.getContractAt("PaymentNFT", nftAddr);
  const usdc = await hre.ethers.getContractAt("MockUSDC", usdcAddr);
  const rootManager = await hre.ethers.getContractAt(
    "MerkleRootManager",
    rootManagerAddr
  );

  // ── Step 1: Read Vault token config ──────────────────────────────────────
  // Vault is fixed-denomination: every deposit must equal `denomination`
  // of the configured ERC-20. Fail fast if misconfigured.
  const denomination: bigint = await vault.denomination();
  const token: string = await vault.token();
  if (token.toLowerCase() !== usdcAddr.toLowerCase()) {
    throw new Error(`Vault.token ${token} != MockUSDC ${usdcAddr}`);
  }
  if (denomination === 0n) {
    throw new Error("Vault denomination is 0 — run set:token first");
  }

  const decimals = Number(await usdc.decimals());
  console.log(
    `[1/6] Token ready — denomination ${hre.ethers.formatUnits(denomination, decimals)} USDC`
  );

  // ── Step 2: Ensure deployer has enough MockUSDC ──────────────────────────
  // Owner of MockUSDC can mint. Skip if balance already covers one deposit.
  let bal: bigint = await usdc.balanceOf(deployer.address);
  if (bal < denomination) {
    const mintAmount = denomination * 10n;
    console.log(
      `[2/6] Minting ${hre.ethers.formatUnits(mintAmount, decimals)} USDC…`
    );
    await send(deployer, "usdc.mint", () =>
      usdc.mint(deployer.address, mintAmount)
    );
  } else {
    console.log(
      `[2/6] Balance OK — ${hre.ethers.formatUnits(bal, decimals)} USDC (skip mint)`
    );
  }

  // ── Step 3: Create off-chain Poseidon note ───────────────────────────────
  // Note binds: secret, recipientDigest, amount, tokenHash.
  //   commitment = Poseidon4(...)  → leaf / Vault.deposit arg
  //   nullifier  = Poseidon1(secret) → spent on redeem (anti double-spend)
  // Keep the secret off-chain in a real app; here we only need public fields.
  console.log("[3/6] Creating Poseidon note…");
  const note = createNote(denomination, usdcAddr);
  const commitment = note.commitmentBytes32;
  const nullifier = note.nullifierBytes32;
  const recipientDigest = note.recipientDigestBytes32;
  console.log(`  commitment:      ${commitment}`);
  console.log(`  nullifier:       ${nullifier}`);
  console.log(`  recipientDigest: ${recipientDigest}`);

  // ── Step 4: Approve ERC-20 + deposit into Vault ──────────────────────────
  // deposit():
  //   - pulls `denomination` USDC from msg.sender
  //   - records commitment / leafIndex
  //   - mints PaymentNFT claim ticket to depositor
  //   - emits Deposit(commitment, leafIndex, token, amount, depositId, tokenId)
  console.log("[4/6] Approve + deposit…");
  const allowance: bigint = await usdc.allowance(deployer.address, vaultAddr);
  if (allowance < denomination) {
    await send(deployer, "usdc.approve", () =>
      usdc.approve(vaultAddr, denomination)
    );
  }

  let depositId = 0n;
  let tokenId = 0n;
  await waitForClearMempool(deployer.address, "deposit (pre)");
  const depositTx = await vault.deposit(commitment);
  console.log(`  vault.deposit: ${depositTx.hash}`);
  const receipt = await depositTx.wait(1);
  await waitForClearMempool(deployer.address, "deposit (post)");

  // Parse Deposit event so we know which NFT / depositId to redeem later.
  for (const log of receipt!.logs) {
    try {
      const parsed = vault.interface.parseLog(log);
      if (parsed?.name === "Deposit") {
        depositId = parsed.args.depositId as bigint;
        tokenId = parsed.args.tokenId as bigint;
      }
    } catch {
      /* not a Vault log */
    }
  }
  if (tokenId === 0n) {
    throw new Error("Deposit event not found in receipt");
  }
  console.log(`  depositId=${depositId} tokenId=${tokenId}`);
  console.log(`  NFT owner: ${await nft.ownerOf(tokenId)}`);

  // ── Step 5: Post Merkle root (indexer stand-in) ──────────────────────────
  // Production: indexer builds Poseidon tree from Deposit events and posts
  // the real root. Here we post a unique synthetic root so redeem's
  // `isKnownRoot` check passes. Mock verifier does not check membership.
  // Root must be unique per run or MerkleRootManager reverts RootAlreadyKnown.
  const root = hre.ethers.keccak256(
    hre.ethers.solidityPacked(
      ["bytes32", "uint256", "address"],
      [commitment, depositId, deployer.address]
    )
  );
  console.log(`[5/6] Posting root ${root}…`);
  const rmOwner: string = await rootManager.owner();
  if (rmOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `MerkleRootManager owner is ${rmOwner}, not deployer ${deployer.address}. ` +
        `Cannot postRoot — use the owner key or run the indexer as relayer.`
    );
  }
  await send(deployer, "rootManager.postRoot", () => rootManager.postRoot(root));

  // ── Step 6a: Stage redemption proof on the claim NFT ─────────────────────
  // Only the NFT owner can call setRedemptionProof.
  // Vault.redeem later reads this staged data via getRedemptionProof(tokenId).
  // proof = "0x01" is enough for DepositVerifier (always returns true).
  console.log("[6/6] Stage proof + redeem…");
  await send(deployer, "nft.setRedemptionProof", () =>
    nft.setRedemptionProof(
      tokenId,
      "0x01",
      root,
      nullifier,
      recipientDigest
    )
  );

  // ── Step 6b: Redeem — verify, burn NFT, pay out ──────────────────────────
  // Vault.redeem(depositId):
  //   - requires msg.sender owns the claim NFT
  //   - checks root known, nullifier unused, mock proof OK
  //   - burns NFT, marks nullifier spent
  //   - transfers denomination − fee to msg.sender (fee → feeRecipient)
  const balBefore: bigint = await usdc.balanceOf(deployer.address);
  await send(deployer, "vault.redeem", () => vault.redeem(depositId));
  const balAfter: bigint = await usdc.balanceOf(deployer.address);

  // ── Step 7: Assert success ───────────────────────────────────────────────
  const spent: boolean = await vault.nullifierSpent(nullifier);
  let nftBurned = false;
  try {
    await nft.ownerOf(tokenId);
  } catch {
    // ownerOf reverts after burn — expected success path
    nftBurned = true;
  }

  console.log("\n=== E2E RESULT ===");
  console.log(`  nullifierSpent: ${spent}`);
  console.log(`  NFT burned:     ${nftBurned}`);
  console.log(
    `  USDC delta:     ${hre.ethers.formatUnits(balAfter - balBefore, decimals)} ` +
      `(expected ≈ denomination minus fee)`
  );

  if (!spent || !nftBurned) {
    throw new Error("E2E incomplete — nullifier or NFT burn check failed");
  }
  if (balAfter <= balBefore) {
    throw new Error("E2E incomplete — balance did not increase after redeem");
  }

  console.log("\n✓ End-to-end flow passed\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
