/**
 * Pause or unpause via AdminController (preferred) or Vault owner directly.
 *
 * Env:
 *   ACTION=pause|unpause  — required
 *   ADMIN_ADDRESS         — optional override
 *   VAULT_ADDRESS         — used only if AdminController not deployed
 *
 * Usage:
 *   ACTION=pause pnpm vault:pause
 *   ACTION=unpause pnpm vault:unpause
 */
import hre from "hardhat";
import {requireDeployment, vaultAddress} from "../lib/deployments";
import {
  getDeployer,
  networkName,
  optionalEnv,
  parseAddress,
  requireEnv,
} from "../lib/env";

async function main() {
  const deployer = await getDeployer();
  const network = networkName();
  const deployment = requireDeployment(network);
  const action = requireEnv("ACTION").toLowerCase();
  if (action !== "pause" && action !== "unpause") {
    throw new Error('ACTION must be "pause" or "unpause"');
  }

  console.log(`Network:  ${network}`);
  console.log(`Signer:   ${deployer.address}`);
  console.log(`Action:   ${action}`);

  const adminAddr =
    deployment.contracts.AdminController || process.env.ADMIN_ADDRESS;
  if (adminAddr) {
    const admin = await hre.ethers.getContractAt(
      "AdminController",
      parseAddress("ADMIN_ADDRESS", optionalEnv("ADMIN_ADDRESS", adminAddr)!)
    );
    console.log(`Admin:    ${await admin.getAddress()}`);
    const tx =
      action === "pause"
        ? await admin.emergencyPauseAll()
        : await admin.unpauseAll();
    console.log(`${action} tx: ${tx.hash}`);
    await tx.wait();
  } else {
    const fallback = vaultAddress(deployment);
    if (!fallback) throw new Error("No AdminController or Vault in deployment");
    const vaultAddr = parseAddress(
      "VAULT_ADDRESS",
      optionalEnv("VAULT_ADDRESS", fallback)!
    );
    console.log(`Vault:    ${vaultAddr}`);
    const vault = await hre.ethers.getContractAt("Vault", vaultAddr);
    const tx = action === "pause" ? await vault.pause() : await vault.unpause();
    console.log(`${action} tx: ${tx.hash}`);
    await tx.wait();
    console.log(`paused: ${await vault.paused()}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
