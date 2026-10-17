/**
 * Mint MockUSDC (token owner only).
 *
 * Env:
 *   TOKEN_ADDRESS — optional; defaults to deployments MockUSDC
 *   MINT_TO       — recipient (default: deployer)
 *   MINT_AMOUNT   — human units (default: 1000000)
 *
 * Usage:
 *   pnpm mint:token
 *   MINT_TO=0x... MINT_AMOUNT=5000 pnpm mint:token
 */
import hre from "hardhat";
import {requireDeployment} from "../lib/deployments";
import {
  getDeployer,
  networkName,
  optionalEnv,
  parseAddress,
} from "../lib/env";

async function main() {
  const deployer = await getDeployer();
  const network = networkName();
  const deployment = requireDeployment(network);

  const tokenAddr = parseAddress(
    "TOKEN_ADDRESS",
    optionalEnv("TOKEN_ADDRESS", deployment.contracts.MockUSDC)!
  );
  if (!tokenAddr) {
    throw new Error("Set TOKEN_ADDRESS or deploy MockUSDC first.");
  }

  const mintTo = parseAddress(
    "MINT_TO",
    optionalEnv("MINT_TO", deployer.address)!
  );
  const human = optionalEnv("MINT_AMOUNT", "1000000")!;

  const usdc = await hre.ethers.getContractAt("MockUSDC", tokenAddr);
  const decimals = Number(await usdc.decimals());
  const symbol = await usdc.symbol();
  const amount = hre.ethers.parseUnits(human, decimals);

  console.log(`Network:  ${network}`);
  console.log(`Token:    ${tokenAddr} (${symbol})`);
  console.log(`Mint:     ${human} → ${mintTo}`);

  const tx = await usdc.mint(mintTo, amount);
  console.log(`mint tx:  ${tx.hash}`);
  await tx.wait();

  const bal = await usdc.balanceOf(mintTo);
  console.log(`Balance:  ${hre.ethers.formatUnits(bal, decimals)} ${symbol}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
