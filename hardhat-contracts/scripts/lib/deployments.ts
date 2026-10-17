import fs from "node:fs";
import path from "node:path";

export interface TokenRecord {
  address: string;
  symbol: string;
  decimals: number;
  enabled: boolean;
}

export interface DeploymentFile {
  network: string;
  chainId: number;
  deployer: string;
  contracts: {
    DepositVerifier?: string;
    MerkleRootManager?: string;
    Vault?: string;
    PaymentNFT?: string;
    FeeManager?: string;
    Treasury?: string;
    AdminController?: string;
    MockUSDC?: string;
    USDC?: string;
    USDT?: string;
    DAI?: string;
  };
  tokens: TokenRecord[];
  updatedAt: string;
}

const ROOT = path.join(__dirname, "..", "..");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");

export function deploymentsDir(): string {
  return DEPLOYMENTS_DIR;
}

export function deploymentPath(network: string): string {
  return path.join(DEPLOYMENTS_DIR, `${network}.json`);
}

export function loadDeployment(network: string): DeploymentFile | null {
  const file = deploymentPath(network);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as DeploymentFile;
}

export function requireDeployment(network: string): DeploymentFile {
  const d = loadDeployment(network);
  if (!d) {
    throw new Error(
      `No deployment file at ${deploymentPath(network)}. Run deploy:all first.`
    );
  }
  return d;
}

export function vaultAddress(d: DeploymentFile): string | undefined {
  return d.contracts.Vault;
}

export function saveDeployment(data: DeploymentFile): string {
  if (!fs.existsSync(DEPLOYMENTS_DIR)) {
    fs.mkdirSync(DEPLOYMENTS_DIR, {recursive: true});
  }
  data.updatedAt = new Date().toISOString();
  const file = deploymentPath(data.network);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return file;
}

export function upsertToken(
  data: DeploymentFile,
  token: TokenRecord
): DeploymentFile {
  const idx = data.tokens.findIndex(
    (t) => t.address.toLowerCase() === token.address.toLowerCase()
  );
  if (idx >= 0) data.tokens[idx] = token;
  else data.tokens.push(token);
  return data;
}
