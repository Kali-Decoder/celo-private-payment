/**
 * Verify core contracts on Celo Sepolia Blockscout.
 *
 * Usage:
 *   pnpm verify:all
 *   pnpm verify:all --network celoSepolia
 */
import hre from "hardhat";
import {loadDeployment, vaultAddress} from "../lib/deployments";
import {optionalEnv, parseAddress} from "../lib/env";

async function verify(
  label: string,
  address: string,
  constructorArguments: unknown[] = [],
  contract?: string
) {
  console.log(`\n→ Verifying ${label} @ ${address}`);
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
      ...(contract ? {contract} : {}),
    });
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already verified/i.test(msg)) {
      console.log(`  ✓ ${label} (already verified)`);
      return;
    }
    console.error(`  ✗ ${label}: ${msg}`);
    throw err;
  }
}

const EXPLORER = "https://celo-sepolia.blockscout.com";

async function main() {
  const network = hre.network.name;
  if (network !== "celoSepolia") {
    throw new Error(`Run with --network celoSepolia (got ${network})`);
  }

  const dep = loadDeployment(network);
  const vaultAddr = dep ? vaultAddress(dep) : undefined;
  if (!dep?.contracts.DepositVerifier || !dep.contracts.MerkleRootManager || !vaultAddr) {
    throw new Error(
      `deployments/${network}.json missing required contract addresses. Deploy first.`
    );
  }

  const deployer = parseAddress("deployer", dep.deployer);
  const verifier = parseAddress("DepositVerifier", dep.contracts.DepositVerifier);
  const rootManager = parseAddress(
    "MerkleRootManager",
    dep.contracts.MerkleRootManager
  );
  const vault = parseAddress("Vault", vaultAddr);

  const rootOwner = parseAddress(
    "RELAYER_ADDRESS",
    optionalEnv("RELAYER_ADDRESS", deployer)!
  );

  console.log(`Network:  ${network}`);
  console.log(`Deployer: ${deployer}`);
  console.log(`Root owner (MerkleRootManager): ${rootOwner}`);
  console.log("Note: UUPS proxies — verifying implementations with empty constructors.");

  await verify("DepositVerifier", verifier, []);
  await verify("MerkleRootManager", rootManager, [rootOwner]);

  console.log(
    `\n(Proxy addresses — verify impl separately if needed)\n  Vault proxy: ${vault}`
  );

  if (dep.contracts.PaymentNFT) {
    console.log(`  PaymentNFT proxy: ${dep.contracts.PaymentNFT}`);
  }
  if (dep.contracts.FeeManager) {
    console.log(`  FeeManager proxy: ${dep.contracts.FeeManager}`);
  }
  if (dep.contracts.Treasury) {
    console.log(`  Treasury proxy: ${dep.contracts.Treasury}`);
  }
  if (dep.contracts.AdminController) {
    console.log(`  AdminController proxy: ${dep.contracts.AdminController}`);
  }

  console.log("\nDone.");
  console.log(`Explorer: ${EXPLORER}/address/${vault}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
