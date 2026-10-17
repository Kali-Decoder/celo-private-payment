/**
 * Post a Merkle root (MerkleRootManager owner / relayer only).
 *
 * Env:
 *   ROOT                 — required bytes32 hex
 *   ROOT_MANAGER_ADDRESS — optional override
 *
 * Usage:
 *   ROOT=0xabc... pnpm post:root
 */
import hre from "hardhat";
import {requireDeployment} from "../lib/deployments";
import {
  getDeployer,
  networkName,
  optionalEnv,
  requireEnv,
} from "../lib/env";

async function main() {
  const deployer = await getDeployer();
  const network = networkName();
  const deployment = requireDeployment(network);

  const root = requireEnv("ROOT");
  if (!/^0x[0-9a-fA-F]{64}$/.test(root)) {
    throw new Error(`ROOT must be bytes32 hex, got: ${root}`);
  }

  const managerAddr =
    optionalEnv("ROOT_MANAGER_ADDRESS") ?? deployment.contracts.MerkleRootManager;
  if (!managerAddr) {
    throw new Error("Set ROOT_MANAGER_ADDRESS or deploy MerkleRootManager first.");
  }

  console.log(`Network:  ${network}`);
  console.log(`Signer:   ${deployer.address}`);
  console.log(`Manager:  ${managerAddr}`);
  console.log(`Root:     ${root}`);

  const manager = await hre.ethers.getContractAt("MerkleRootManager", managerAddr);
  const tx = await manager.postRoot(root);
  console.log(`postRoot tx: ${tx.hash}`);
  await tx.wait();

  console.log(`isKnownRoot: ${await manager.isKnownRoot(root)}`);
  console.log(`latestRoot:  ${await manager.latestRoot()}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
