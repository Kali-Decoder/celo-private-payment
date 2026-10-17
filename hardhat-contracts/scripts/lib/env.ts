import hre from "hardhat";
import type {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";

/** Active network name from Hardhat (e.g. hardhat, celoSepolia). */
export function networkName(): string {
  return hre.network.name;
}

export async function chainId(): Promise<number> {
  const net = await hre.ethers.provider.getNetwork();
  return Number(net.chainId);
}

export async function getDeployer(): Promise<HardhatEthersSigner> {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) {
    throw new Error(
      "No signer available. Set PRIVATE_KEY in .env for remote networks."
    );
  }
  return signer;
}

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function optionalEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || fallback;
}

export function parseAddress(label: string, value: string): string {
  if (!hre.ethers.isAddress(value)) {
    throw new Error(`Invalid address for ${label}: ${value}`);
  }
  return hre.ethers.getAddress(value);
}
