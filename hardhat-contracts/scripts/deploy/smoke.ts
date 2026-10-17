/**
 * Local smoke: UUPS stack + one deposit + postRoot.
 */
import hre from "hardhat";
import {saveDeployment, upsertToken, type DeploymentFile} from "../lib/deployments";
import {chainId, getDeployer, networkName} from "../lib/env";
import {deployUUPSProxy} from "../lib/proxy";

async function main() {
  const deployer = await getDeployer();
  const network = networkName();
  const cid = await chainId();

  console.log(`Smoke on ${network} (chainId ${cid}) as ${deployer.address}\n`);

  const verifier = await (
    await hre.ethers.getContractFactory("DepositVerifier")
  ).deploy();
  await verifier.waitForDeployment();

  const rootManager = await (
    await hre.ethers.getContractFactory("MerkleRootManager")
  ).deploy(deployer.address);
  await rootManager.waitForDeployment();

  const Treasury = await hre.ethers.getContractFactory("Treasury");
  const treasury = await deployUUPSProxy(Treasury, [deployer.address, deployer.address]);

  const FeeManager = await hre.ethers.getContractFactory("FeeManager");
  const feeManager = await deployUUPSProxy(FeeManager, [deployer.address]);

  const Vault = await hre.ethers.getContractFactory("Vault");
  const vault = await deployUUPSProxy(Vault, [
    deployer.address,
    await verifier.getAddress(),
    await rootManager.getAddress(),
    await treasury.getAddress(),
  ]);
  await (await vault.setFeeManager(await feeManager.getAddress())).wait();

  const NFT = await hre.ethers.getContractFactory("PaymentNFT");
  const nft = await deployUUPSProxy(NFT, [deployer.address]);
  await (await nft.setVault(await vault.getAddress())).wait();
  await (await vault.setNftContract(await nft.getAddress())).wait();

  const usdc = await (
    await hre.ethers.getContractFactory("MockUSDC")
  ).deploy(deployer.address);
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  const decimals = Number(await usdc.decimals());
  const denomination = hre.ethers.parseUnits("10", decimals);
  await (await vault.setToken(usdcAddr, denomination)).wait();
  await (await usdc.mint(deployer.address, hre.ethers.parseUnits("1000", decimals))).wait();

  await (await usdc.approve(await vault.getAddress(), denomination)).wait();
  await (await vault.deposit(hre.ethers.id("smoke-note"))).wait();

  const root =
    "0x2222222222222222222222222222222222222222222222222222222222222222";
  await (await rootManager.postRoot(root)).wait();

  const deployment: DeploymentFile = {
    network,
    chainId: cid,
    deployer: deployer.address,
    contracts: {
      DepositVerifier: await verifier.getAddress(),
      MerkleRootManager: await rootManager.getAddress(),
      Vault: await vault.getAddress(),
      PaymentNFT: await nft.getAddress(),
      FeeManager: await feeManager.getAddress(),
      Treasury: await treasury.getAddress(),
      MockUSDC: usdcAddr,
    },
    tokens: [],
    updatedAt: new Date().toISOString(),
  };
  upsertToken(deployment, {
    address: usdcAddr,
    symbol: await usdc.symbol(),
    decimals,
    enabled: true,
  });
  const file = saveDeployment(deployment);

  console.log("OK (UUPS)");
  console.log(`  vault:    ${await vault.getAddress()}`);
  console.log(`  nft:      ${await nft.getAddress()}`);
  console.log(`  deposits: ${await vault.depositCounter()}`);
  console.log(`  wrote:    ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
