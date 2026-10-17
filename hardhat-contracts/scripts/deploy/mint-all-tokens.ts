/**
 * Deploy mintable MockERC20 USDC/USDT/DAI, mint to admin, enable on Vault.
 *
 * Env:
 *   MINT_TO      — recipient (default: deployer)
 *   MINT_AMOUNT  — human units per token (default: 1000000)
 *
 * Usage:
 *   pnpm mint:all
 */
import hre from "hardhat";
import {
  requireDeployment,
  saveDeployment,
  upsertToken,
} from "../lib/deployments";
import {
  getDeployer,
  networkName,
  optionalEnv,
  parseAddress,
} from "../lib/env";
import {deployAndWait, waitForClearMempool} from "../lib/proxy";

async function send(
  label: string,
  sendTx: () => Promise<{wait: (n?: number) => Promise<unknown>}>
) {
  const [signer] = await hre.ethers.getSigners();
  await waitForClearMempool(signer.address, `${label} (pre)`);
  const tx = await sendTx();
  await tx.wait(1);
  await waitForClearMempool(signer.address, `${label} (post)`);
}

const PRESETS = [
  {symbol: "USDC" as const, name: "USD Coin (mock)", decimals: 6},
  {symbol: "USDT" as const, name: "Tether USD (mock)", decimals: 6},
  {symbol: "DAI" as const, name: "Dai Stablecoin (mock)", decimals: 18},
];

async function main() {
  const deployer = await getDeployer();
  const network = networkName();
  const deployment = requireDeployment(network);

  const admin = parseAddress(
    "MINT_TO",
    optionalEnv("MINT_TO", deployer.address)!
  );
  const human = optionalEnv("MINT_AMOUNT", "1000000")!;

  const vaultAddr = deployment.contracts.Vault;
  const adminCtrlAddr = deployment.contracts.AdminController;
  if (!vaultAddr || !adminCtrlAddr) {
    throw new Error("Deployment missing Vault / AdminController");
  }

  const adminCtrl = await hre.ethers.getContractAt(
    "AdminController",
    adminCtrlAddr
  );
  const Mock = await hre.ethers.getContractFactory("MockERC20");

  console.log(`Network:  ${network}`);
  console.log(`Admin:    ${admin}`);
  console.log(`Amount:   ${human} per token`);
  console.log(`Vault:    ${vaultAddr}`);

  for (const p of PRESETS) {
    console.log(`\n── ${p.symbol} ──`);

    const oldAddr = deployment.contracts[p.symbol];

    const mock = await deployAndWait(
      Mock,
      [p.name, p.symbol, p.decimals, deployer.address],
      `MockERC20 ${p.symbol}`
    );
    const tokenAddr = await mock.getAddress();
    console.log(`  token: ${tokenAddr}`);

    const amount = hre.ethers.parseUnits(human, p.decimals);
    await send(`mint ${p.symbol}`, () => mock.mint(admin, amount));
    const bal = await mock.balanceOf(admin);
    console.log(
      `  minted: ${hre.ethers.formatUnits(bal, p.decimals)} ${p.symbol} → ${admin}`
    );

    if (oldAddr && oldAddr.toLowerCase() !== tokenAddr.toLowerCase()) {
      await send(`disable old ${p.symbol}`, () =>
        adminCtrl.setVaultSupportedToken(oldAddr, false)
      );
      console.log(`  disabled: ${oldAddr}`);
    }

    await send(`enable ${p.symbol}`, () =>
      adminCtrl.setVaultSupportedToken(tokenAddr, true)
    );
    console.log(`  enabled:  ${tokenAddr}`);

    deployment.contracts[p.symbol] = tokenAddr;
    if (p.symbol === "USDC") {
      deployment.contracts.MockUSDC = tokenAddr;
    }

    deployment.tokens = deployment.tokens.filter(
      (t) =>
        t.symbol !== p.symbol ||
        t.address.toLowerCase() === tokenAddr.toLowerCase()
    );
    if (oldAddr && oldAddr.toLowerCase() !== tokenAddr.toLowerCase()) {
      deployment.tokens = deployment.tokens.filter(
        (t) => t.address.toLowerCase() !== oldAddr.toLowerCase()
      );
    }

    upsertToken(deployment, {
      address: tokenAddr,
      symbol: p.symbol,
      decimals: p.decimals,
      enabled: true,
    });
  }

  const file = saveDeployment(deployment);
  console.log(`\nSaved ${file}`);
  console.log("\nToken addresses:");
  console.log(`  USDC=${deployment.contracts.USDC}`);
  console.log(`  USDT=${deployment.contracts.USDT}`);
  console.log(`  DAI=${deployment.contracts.DAI}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
