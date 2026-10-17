/**
 * Configure Vault token/denomination via AdminController (or Vault if no admin).
 *
 * Env:
 *   TOKEN_ADDRESS   — required
 *   DENOMINATION    — human units (default: "10")
 *   ADMIN_ADDRESS   — optional override
 *   VAULT_ADDRESS   — fallback if no AdminController
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

  const tokenAddr = parseAddress("TOKEN_ADDRESS", requireEnv("TOKEN_ADDRESS"));
  const token = new hre.ethers.Contract(
    tokenAddr,
    ["function decimals() view returns (uint8)"],
    deployer
  );
  const decimals = Number(await token.decimals());
  const humanDenom = optionalEnv("DENOMINATION", "10")!;
  const denomination = hre.ethers.parseUnits(humanDenom, decimals);

  console.log(`Token:        ${tokenAddr}`);
  console.log(`Denomination: ${humanDenom} (${denomination} base units)`);
  console.log(`Signer:       ${deployer.address}`);

  const adminAddr =
    deployment.contracts.AdminController || process.env.ADMIN_ADDRESS;
  if (adminAddr) {
    const admin = await hre.ethers.getContractAt(
      "AdminController",
      parseAddress("ADMIN_ADDRESS", optionalEnv("ADMIN_ADDRESS", adminAddr)!)
    );
    console.log(`Admin:        ${await admin.getAddress()}`);
    const tx = await admin.configureVaultToken(tokenAddr, denomination);
    console.log(`configureVaultToken tx: ${tx.hash}`);
    await tx.wait();
  } else {
    const fallback = vaultAddress(deployment);
    if (!fallback) throw new Error("No AdminController or Vault in deployment");
    const vaultAddr = parseAddress(
      "VAULT_ADDRESS",
      optionalEnv("VAULT_ADDRESS", fallback)!
    );
    console.log(`Vault:        ${vaultAddr}`);
    const vault = await hre.ethers.getContractAt("Vault", vaultAddr);
    const tx = await vault.setToken(tokenAddr, denomination);
    console.log(`setToken tx: ${tx.hash}`);
    await tx.wait();
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
