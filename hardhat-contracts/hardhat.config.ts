import type {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "dotenv/config";

/**
 * Celo Sepolia (chainId 11142220) — sole remote network.
 * Env:
 *   CELO_SEPOLIA_PRIVATE_KEY  (falls back to PRIVATE_KEY)
 *   CELO_SEPOLIA_RPC_URL
 *   BLOCKSCOUT_API_KEY        (optional)
 */
const CELO_SEPOLIA_PRIVATE_KEY =
  process.env.CELO_SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
const CELO_SEPOLIA_RPC_URL =
  process.env.CELO_SEPOLIA_RPC_URL ||
  "https://forno.celo-sepolia.celo-testnet.org/";
const BLOCKSCOUT_API_KEY = process.env.BLOCKSCOUT_API_KEY || "no-api-key-needed";

const celoSepoliaAccounts = CELO_SEPOLIA_PRIVATE_KEY
  ? [CELO_SEPOLIA_PRIVATE_KEY]
  : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      metadata: {
        bytecodeHash: "ipfs",
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    /**
     * Celo Sepolia (chainId 11142220).
     * Currency: CELO (18 decimals). Explorer: celo-sepolia.blockscout.com
     */
    celoSepolia: {
      url: CELO_SEPOLIA_RPC_URL,
      accounts: celoSepoliaAccounts,
      chainId: 11142220,
      timeout: 120_000,
    },
  },
  sourcify: {
    enabled: false,
  },
  etherscan: {
    enabled: true,
    apiKey: {
      celoSepolia: BLOCKSCOUT_API_KEY,
    },
    customChains: [
      {
        network: "celoSepolia",
        chainId: 11142220,
        urls: {
          apiURL: "https://celo-sepolia.blockscout.com/api",
          browserURL: "https://celo-sepolia.blockscout.com",
        },
      },
    ],
  },
};

export default config;
