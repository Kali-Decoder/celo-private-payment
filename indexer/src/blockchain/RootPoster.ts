import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PublicClient,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {config} from "../config/index.js";
import {merkleRootManagerAbi} from "./Vault.js";

function chain() {
  return {
    id: config.chainId,
    name: `chain-${config.chainId}`,
    nativeCurrency: {name: "ETH", symbol: "ETH", decimals: 18},
    rpcUrls: {default: {http: [config.rpcUrl]}},
  } as const;
}

export function createIndexerPublicClient(): PublicClient {
  return createPublicClient({
    chain: chain(),
    transport: http(config.rpcUrl),
  });
}

/**
 * Posts Merkle roots on-chain. Uses a dedicated relayer key that must own
 * MerkleRootManager. Never stores user secrets.
 */
export class RootPoster {
  private readonly publicClient: PublicClient;
  private readonly account;
  private readonly wallet;

  constructor(publicClient?: PublicClient) {
    this.publicClient = publicClient ?? createIndexerPublicClient();
    if (!config.relayerPrivateKey) {
      this.account = null;
      this.wallet = null;
      return;
    }
    this.account = privateKeyToAccount(config.relayerPrivateKey);
    this.wallet = createWalletClient({
      account: this.account,
      chain: chain(),
      transport: http(config.rpcUrl),
    });
  }

  async isKnownRoot(root: Hex): Promise<boolean> {
    return this.publicClient.readContract({
      address: config.rootManagerAddress,
      abi: merkleRootManagerAbi,
      functionName: "isKnownRoot",
      args: [root],
    });
  }

  /**
   * Post root with retries. Skips if already known on-chain.
   * @returns tx hash, or null if skipped / dry-run
   */
  async postRoot(root: Hex, maxAttempts = 5): Promise<Hex | null> {
    if (config.skipPostRoot) {
      console.log(`[poster] SKIP_POST_ROOT=1 — not posting ${root}`);
      return null;
    }
    if (!this.wallet || !this.account) {
      throw new Error("RELAYER_PRIVATE_KEY not configured");
    }

    if (await this.isKnownRoot(root)) {
      console.log(`[poster] root already known on-chain: ${root}`);
      return null;
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const hash = await this.wallet.writeContract({
          address: config.rootManagerAddress,
          abi: merkleRootManagerAbi,
          functionName: "postRoot",
          args: [root],
          account: this.account,
          chain: chain(),
        });
        await this.publicClient.waitForTransactionReceipt({hash});
        console.log(`[poster] posted ${root} tx=${hash}`);
        return hash;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        // Duplicate post between check and send
        if (/RootAlreadyKnown|already known/i.test(msg)) {
          console.log(`[poster] race: root already known ${root}`);
          return null;
        }
        console.warn(`[poster] attempt ${attempt}/${maxAttempts} failed: ${msg.slice(0, 200)}`);
        await sleep(1000 * attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
