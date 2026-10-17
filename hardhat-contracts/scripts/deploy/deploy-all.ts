/**
 * Deploy the full UUPS Vault stack on Celo Sepolia:
 *   DepositVerifier → MerkleRootManager
 *   → Treasury/FeeManager/Vault/PaymentNFT/AdminController (impl + ERC1967Proxy)
 *   → wire roles / ownership → MockERC20 (USDC/USDT/DAI) → setSupportedToken
 *
 * Cleartext ERC-20 path (no FHE / confidential wrappers):
 *   approve → depositTo(commitment, token, amount, recipient, noteURI)
 *   → PaymentNFT minted → transfer NFT → stage ZK proof → redeem → ERC-20 payout
 *
 * Note: All sends wait for a clear mempool first (see scripts/lib/proxy.ts).
 */
import hre from "hardhat";
import {
  loadDeployment,
  saveDeployment,
  upsertToken,
  type DeploymentFile,
} from "../lib/deployments";
import {
  chainId,
  getDeployer,
  networkName,
  optionalEnv,
  parseAddress,
} from "../lib/env";
import {deployAndWait, deployUUPSProxy, waitForClearMempool} from "../lib/proxy";

/** Send a write tx only after previous in-flight txs have mined. */
async function send(label: string, sendTx: () => Promise<{wait: (n?: number) => Promise<unknown>}>) {
  const [signer] = await hre.ethers.getSigners();
  await waitForClearMempool(signer.address, `${label} (pre)`);
  const tx = await sendTx();
  await tx.wait(1);
  await waitForClearMempool(signer.address, `${label} (post)`);
}

async function main() {
  const deployer = await getDeployer();
  const network = networkName();
  const cid = await chainId();

  console.log(`Network:  ${network} (chainId ${cid})`);
  console.log(`Deployer: ${deployer.address}`);
  await waitForClearMempool(deployer.address, "startup");

  const relayerRaw = optionalEnv("RELAYER_ADDRESS", deployer.address)!;
  const relayer = parseAddress("RELAYER_ADDRESS", relayerRaw);

  console.log("\n[1/8] Deploying DepositVerifier (mock)...");
  const Verifier = await hre.ethers.getContractFactory("DepositVerifier");
  const verifier = await deployAndWait(Verifier, [], "DepositVerifier");
  const verifierAddr = await verifier.getAddress();
  console.log(`  DepositVerifier:     ${verifierAddr}`);

  console.log("\n[2/8] Deploying MerkleRootManager...");
  const RootManager = await hre.ethers.getContractFactory("MerkleRootManager");
  const rootManager = await deployAndWait(RootManager, [relayer], "MerkleRootManager");
  const rootManagerAddr = await rootManager.getAddress();
  console.log(`  MerkleRootManager:  ${rootManagerAddr}`);

  console.log("\n[3/8] Deploying Treasury proxy...");
  const Treasury = await hre.ethers.getContractFactory("Treasury");
  const treasury = await deployUUPSProxy(Treasury, [deployer.address, deployer.address], "Treasury");
  const treasuryAddr = await treasury.getAddress();
  console.log(`  Treasury proxy:     ${treasuryAddr}`);

  console.log("\n[4/8] Deploying FeeManager proxy...");
  const FeeManager = await hre.ethers.getContractFactory("FeeManager");
  const feeManager = await deployUUPSProxy(FeeManager, [deployer.address], "FeeManager");
  const feeManagerAddr = await feeManager.getAddress();
  console.log(`  FeeManager proxy:   ${feeManagerAddr}`);

  const feeRecipientRaw = optionalEnv("FEE_RECIPIENT", treasuryAddr)!;
  const feeRecipient = parseAddress("FEE_RECIPIENT", feeRecipientRaw);

  console.log("\n[5/8] Deploying Vault proxy...");
  const Vault = await hre.ethers.getContractFactory("Vault");
  const vault = await deployUUPSProxy(
    Vault,
    [deployer.address, verifierAddr, rootManagerAddr, feeRecipient],
    "Vault"
  );
  const vaultAddr = await vault.getAddress();
  await send("vault.setFeeManager", () => vault.setFeeManager(feeManagerAddr));
  console.log(`  Vault proxy:        ${vaultAddr}`);

  console.log("\n[6/8] Deploying PaymentNFT proxy...");
  const NFT = await hre.ethers.getContractFactory("PaymentNFT");
  const nft = await deployUUPSProxy(NFT, [deployer.address], "PaymentNFT");
  const nftAddr = await nft.getAddress();
  await send("nft.setVault", () => nft.setVault(vaultAddr));
  await send("vault.setNftContract", () => vault.setNftContract(nftAddr));
  console.log(`  PaymentNFT proxy:   ${nftAddr}`);

  console.log("\n[7/8] Deploying AdminController proxy + transferring authorities...");
  const Admin = await hre.ethers.getContractFactory("AdminController");
  const admin = await deployUUPSProxy(Admin, [deployer.address], "AdminController");
  const adminAddr = await admin.getAddress();

  await send("admin.setVault", () => admin.setVault(vaultAddr));
  await send("admin.setFeeManager", () => admin.setFeeManager(feeManagerAddr));
  await send("admin.setPaymentNft", () => admin.setPaymentNft(nftAddr));
  await send("admin.setTreasury", () => admin.setTreasury(treasuryAddr));
  await send("admin.setPausableContracts", () => admin.setPausableContracts([vaultAddr]));

  await send("feeManager.grant ADMIN", async () =>
    feeManager.grantRole(await feeManager.ADMIN_ROLE(), adminAddr)
  );
  await send("feeManager.grant UPGRADER", async () =>
    feeManager.grantRole(await feeManager.UPGRADER_ROLE(), adminAddr)
  );
  await send("nft.grant UPGRADER", async () =>
    nft.grantRole(await nft.UPGRADER_ROLE(), adminAddr)
  );
  await send("treasury.grant UPGRADER", async () =>
    treasury.grantRole(await treasury.UPGRADER_ROLE(), adminAddr)
  );

  await send("vault.transferOwnership", () => vault.transferOwnership(adminAddr));
  await send("admin.acceptVaultOwnership", () => admin.acceptVaultOwnership());
  console.log(`  AdminController:    ${adminAddr}`);
  console.log(`  Vault.owner:        ${await vault.owner()}`);

  const deployment: DeploymentFile = {
    network,
    chainId: cid,
    deployer: deployer.address,
    contracts: {
      DepositVerifier: verifierAddr,
      MerkleRootManager: rootManagerAddr,
      Vault: vaultAddr,
      PaymentNFT: nftAddr,
      FeeManager: feeManagerAddr,
      Treasury: treasuryAddr,
      AdminController: adminAddr,
    },
    tokens: loadDeployment(network)?.tokens ?? [],
    updatedAt: new Date().toISOString(),
  };

  if (process.env.SKIP_TOKEN === "1") {
    console.log("\n[8/8] Skipping token deploy (SKIP_TOKEN=1)");
  } else {
    console.log("\n[8/8] Deploying MockERC20 stables + setSupportedToken (any amount)...");
    const Mock = await hre.ethers.getContractFactory("MockERC20");
    const presets = [
      {name: "USD Coin", symbol: "USDC", decimals: 6},
      {name: "Tether USD", symbol: "USDT", decimals: 6},
      {name: "Dai Stablecoin", symbol: "DAI", decimals: 18},
    ] as const;

    for (const p of presets) {
      const token = await deployAndWait(
        Mock,
        [p.name, p.symbol, p.decimals, deployer.address],
        `MockERC20 ${p.symbol}`
      );
      const tokenAddr = await token.getAddress();
      console.log(`  ${p.symbol}:             ${tokenAddr} (${p.decimals} decimals)`);

      await send(`admin.setVaultSupportedToken ${p.symbol}`, () =>
        admin.setVaultSupportedToken(tokenAddr, true)
      );

      if (p.symbol === "USDC") {
        deployment.contracts.MockUSDC = tokenAddr;
      }
      upsertToken(deployment, {
        address: tokenAddr,
        symbol: p.symbol,
        decimals: p.decimals,
        enabled: true,
      });

      if (process.env.SKIP_MINT !== "1") {
        const mintTo = parseAddress(
          "MINT_TO",
          optionalEnv("MINT_TO", deployer.address)!
        );
        const human = optionalEnv("MINT_AMOUNT", "1000000")!;
        const amount = hre.ethers.parseUnits(human, p.decimals);
        await send(`${p.symbol}.mint`, () => token.mint(mintTo, amount));
        console.log(`  minted ${human} ${p.symbol} → ${mintTo}`);
      }
    }
    console.log("  supportedTokens:     USDC, USDT, DAI (depositTo any amount > 0)");
  }

  const file = saveDeployment(deployment);
  console.log(`\nWrote ${file}`);
  console.log("\nDone (UUPS proxies).");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
