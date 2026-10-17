/**
 * Print deployment addresses and on-chain Vault status.
 *
 * Usage:
 *   pnpm status
 */
import hre from "hardhat";
import {loadDeployment, vaultAddress} from "../lib/deployments";
import {chainId, networkName} from "../lib/env";

async function main() {
  const network = networkName();
  const cid = await chainId();
  const deployment = loadDeployment(network);

  console.log(`Network: ${network} (chainId ${cid})`);
  if (!deployment) {
    console.log("No deployment file found.");
    return;
  }

  console.log(`Deployer: ${deployment.deployer}`);
  console.log(`Updated:  ${deployment.updatedAt}`);
  console.log("\nContracts:");
  for (const [name, addr] of Object.entries(deployment.contracts)) {
    console.log(`  ${name.padEnd(20)} ${addr ?? "(missing)"}`);
  }

  console.log("\nTokens (from deployment file):");
  if (deployment.tokens.length === 0) {
    console.log("  (none)");
  } else {
    for (const t of deployment.tokens) {
      console.log(
        `  ${t.symbol.padEnd(8)} ${t.address}  decimals=${t.decimals}  enabled=${t.enabled}`
      );
    }
  }

  const vaultAddr = vaultAddress(deployment);
  if (!vaultAddr) return;

  console.log("\nOn-chain:");
  try {
    const vault = await hre.ethers.getContractAt("Vault", vaultAddr);
    await vault.paused();

    console.log(`  paused:             ${await vault.paused()}`);
    console.log(`  depositCounter:     ${await vault.depositCounter()}`);
    console.log(`  nextDepositId:      ${await vault.nextDepositId()}`);
    console.log(`  token:              ${await vault.token()}`);
    console.log(`  denomination:       ${await vault.denomination()}`);
    console.log(`  feeRecipient:       ${await vault.feeRecipient()}`);
    console.log(`  verifier:           ${await vault.verifier()}`);
    console.log(`  rootManager:        ${await vault.rootManager()}`);
    console.log(`  nftContract:        ${await vault.nftContract()}`);
    console.log(`  owner:              ${await vault.owner()}`);

    if (deployment.contracts.AdminController) {
      const admin = await hre.ethers.getContractAt(
        "AdminController",
        deployment.contracts.AdminController
      );
      console.log(`  adminController:    ${await admin.getAddress()}`);
      console.log(`  admin.vault:        ${await admin.vault()}`);
      console.log(`  admin.feeManager:   ${await admin.feeManager()}`);
    }

    if (deployment.contracts.MerkleRootManager) {
      const rm = await hre.ethers.getContractAt(
        "MerkleRootManager",
        deployment.contracts.MerkleRootManager
      );
      console.log(`  latestRoot:         ${await rm.latestRoot()}`);
      console.log(`  postedCount:        ${await rm.postedCount()}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  (unavailable — ${msg.split("\n")[0]})`);
    if (network === "hardhat" || network === "localhost") {
      console.log(
        "  Tip: in-memory Hardhat resets between runs. Use `pnpm hardhat node` + `--network localhost`, or a remote network."
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
