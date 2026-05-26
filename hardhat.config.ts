import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

// Valid private key = 0x prefix + 64 hex chars (32 bytes)
const VALID_PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY);
if (!VALID_PRIVATE_KEY) {
  console.warn("Warning: PRIVATE_KEY missing or invalid — Sepolia deploy will fail. Set a valid 32-byte hex key in .env");
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: VALID_PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  // Single string key → hardhat-verify uses Etherscan V2 API with chainId param automatically.
  // Object form { sepolia: KEY } → V1 per-network endpoint (deprecated, breaks verification).
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
