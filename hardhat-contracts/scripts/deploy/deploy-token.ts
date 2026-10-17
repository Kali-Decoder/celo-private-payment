/**
 * Enable ERC-20 tokens for Vault.depositTo (any amount > 0).
 *
 * Modes:
 *   1) Deploy MockERC20 stables (default):
 *        pnpm deploy:token
 *        TOKENS=USDC,USDT,DAI pnpm deploy:token
 *   2) Register an existing custom ERC-20:
 *        TOKEN_ADDRESS=0x... TOKEN_SYMBOL=FOO pnpm deploy:token
 *
 * Flow after enable:
 *   approve(vault) → depositTo(commitment, token, amount, recipient, noteURI)
 *   → PaymentNFT minted → transfer NFT → stage proof → redeem → ERC-20 payout
 *
 * Env:
 *   TOKEN_ADDRESS      — existing ERC-20 to enable (skips Mock deploy)
 *   TOKEN_SYMBOL       — symbol label (required with TOKEN_ADDRESS; default USDC for mocks)
 *   TOKENS             — comma list for mock deploy, e.g. USDC,USDT,DAI
 *   TOKEN_NAME         — optional name for mock / record
 *   TOKEN_DECIMALS     — optional decimals override
 *   ENABLE_ON_VAULT    — call setSupportedToken (default: 1 if Vault exists)
 *   VAULT_ADDRESS / ADMIN_ADDRESS — optional overrides
 */
import hre from "hardhat";
import type {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {
  loadDeployment,
  saveDeployment,
  upsertToken,
  vaultAddress,
  type DeploymentFile,
} from "../lib/deployments";
import {
  chainId,
  getDeployer,
  networkName,
  optionalEnv,
  parseAddress,
} from "../lib/env";

type TokenPreset = {symbol: string; name: string; decimals: number};

const PRESETS: Record<string, TokenPreset> = {
  USDC: {symbol: "USDC", name: "USD Coin", decimals: 6},
  USDT: {symbol: "USDT", name: "Tether USD", decimals: 6},
  DAI: {symbol: "DAI", name: "Dai Stablecoin", decimals: 18},
};

function resolveSymbols(): string[] {
  const list = optionalEnv("TOKENS");
  if (list) {
    return list
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return [(optionalEnv("TOKEN_SYMBOL", "USDC") || "USDC").toUpperCase()];
}

async function enableSupported(
  deployer: HardhatEthersSigner,
  deployment: DeploymentFile,
  tokenAddr: string
): Promise<void> {
  const fallbackVault = vaultAddress(deployment);
  if (!fallbackVault && !process.env.VAULT_ADDRESS) {
    throw new Error("No Vault in deployment file. Set VAULT_ADDRESS.");
  }
  const vaultAddr = parseAddress(
    "VAULT_ADDRESS",
    optionalEnv("VAULT_ADDRESS", fallbackVault!)!
  );
  const vault = await hre.ethers.getContractAt("Vault", vaultAddr, deployer);
  const owner = await vault.owner();

  const adminRaw =
    optionalEnv("ADMIN_ADDRESS") ||
    deployment.contracts.AdminController ||
    "";

  if (
    adminRaw &&
    owner.toLowerCase() === parseAddress("ADMIN_ADDRESS", adminRaw).toLowerCase()
  ) {
    const admin = await hre.ethers.getContractAt(
      "AdminController",
      parseAddress("ADMIN_ADDRESS", adminRaw),
      deployer
    );
    const tx = await admin.setVaultSupportedToken(tokenAddr, true);
    await tx.wait();
    console.log(`  setVaultSupportedToken(true) via Admin`);
    return;
  }

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `Vault owner is ${owner}, not deployer. Set ADMIN_ADDRESS or transfer ownership.`
    );
  }

  const tx = await vault.setSupportedToken(tokenAddr, true);
  await tx.wait();
  console.log(`  setSupportedToken(true) on Vault ${vaultAddr}`);
}

async function registerExisting(
  deployer: HardhatEthersSigner,
  deployment: DeploymentFile,
  enable: boolean
): Promise<void> {
  const tokenAddr = parseAddress("TOKEN_ADDRESS", process.env.TOKEN_ADDRESS!);
  const symbol = (optionalEnv("TOKEN_SYMBOL", "CUSTOM") || "CUSTOM").toUpperCase();
  const token = new hre.ethers.Contract(
    tokenAddr,
    [
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function name() view returns (string)",
    ],
    deployer
  );

  let decimals = Number(optionalEnv("TOKEN_DECIMALS", "18"));
  try {
    decimals = Number(await token.decimals());
  } catch {
    /* use override / default */
  }
  let name = optionalEnv("TOKEN_NAME", symbol)!;
  try {
    name = await token.name();
  } catch {
    /* keep */
  }
  let onchainSymbol = symbol;
  try {
    onchainSymbol = await token.symbol();
  } catch {
    /* keep */
  }

  console.log(`\nRegistering custom token ${onchainSymbol} @ ${tokenAddr}`);
  console.log(`  name=${name} decimals=${decimals}`);

  if (symbol === "USDC" || onchainSymbol.toUpperCase() === "USDC") {
    deployment.contracts.MockUSDC = tokenAddr;
    deployment.contracts.USDC = tokenAddr;
  } else if (symbol === "USDT") {
    deployment.contracts.USDT = tokenAddr;
  } else if (symbol === "DAI") {
    deployment.contracts.DAI = tokenAddr;
  }

  upsertToken(deployment, {
    address: tokenAddr,
    symbol: onchainSymbol || symbol,
    decimals,
    enabled: enable,
  });

  if (enable) {
    await enableSupported(deployer, deployment, tokenAddr);
  }
}

async function deployMocks(
  deployer: HardhatEthersSigner,
  deployment: DeploymentFile,
  enable: boolean
): Promise<void> {
  const symbols = resolveSymbols();
  console.log(`Tokens:   ${symbols.join(", ")} (MockERC20)`);

  const Mock = await hre.ethers.getContractFactory("MockERC20");

  for (const sym of symbols) {
    const base = PRESETS[sym];
    if (!base) {
      throw new Error(
        `Unknown token "${sym}". Use USDC, USDT, DAI — or TOKEN_ADDRESS for a custom ERC-20.`
      );
    }
    const single = symbols.length === 1;
    const name =
      single && optionalEnv("TOKEN_NAME")
        ? optionalEnv("TOKEN_NAME")!
        : base.name;
    const decimalsRaw =
      single && optionalEnv("TOKEN_DECIMALS")
        ? Number(optionalEnv("TOKEN_DECIMALS"))
        : base.decimals;
    if (!Number.isInteger(decimalsRaw) || decimalsRaw < 0 || decimalsRaw > 18) {
      throw new Error(`Invalid TOKEN_DECIMALS: ${decimalsRaw}`);
    }

    console.log(`\nDeploying ${base.symbol} (${name}, ${decimalsRaw} decimals)...`);
    const token = await Mock.deploy(name, base.symbol, decimalsRaw, deployer.address);
    await token.waitForDeployment();
    const tokenAddr = await token.getAddress();
    console.log(`  ${base.symbol}: ${tokenAddr}`);

    if (base.symbol === "USDC") {
      deployment.contracts.MockUSDC = tokenAddr;
      deployment.contracts.USDC = tokenAddr;
    } else if (base.symbol === "USDT") {
      deployment.contracts.USDT = tokenAddr;
    } else if (base.symbol === "DAI") {
      deployment.contracts.DAI = tokenAddr;
    }

    upsertToken(deployment, {
      address: tokenAddr,
      symbol: base.symbol,
      decimals: decimalsRaw,
      enabled: enable,
    });

    if (enable) {
      await enableSupported(deployer, deployment, tokenAddr);
    }
  }
}

async function main() {
  const deployer = await getDeployer();
  const network = networkName();
  const cid = await chainId();
  const deployment = loadDeployment(network) ?? {
    network,
    chainId: cid,
    deployer: deployer.address,
    contracts: {},
    tokens: [],
    updatedAt: new Date().toISOString(),
  };

  const hasVault = Boolean(vaultAddress(deployment) || process.env.VAULT_ADDRESS);
  const enable =
    optionalEnv("ENABLE_ON_VAULT", hasVault ? "1" : "0") === "1";

  console.log(`Network:  ${network} (chainId ${cid})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Enable:   ${enable ? "yes (depositTo any amount)" : "no"}`);

  if (process.env.TOKEN_ADDRESS) {
    await registerExisting(deployer, deployment, enable);
  } else {
    await deployMocks(deployer, deployment, enable);
  }

  const file = saveDeployment(deployment);
  console.log(`\nWrote ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
