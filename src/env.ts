import { parseEnv } from "./env-schema.cjs";

const parsed = parseEnv({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_STELLAR_TESTNET_CONTRACT_ID: process.env.NEXT_PUBLIC_STELLAR_TESTNET_CONTRACT_ID,
  NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID: process.env.NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID,
  NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
  NEXT_PUBLIC_BUILD_SHA: process.env.NEXT_PUBLIC_BUILD_SHA,
});

export const env = {
  ...parsed,
  NEXT_PUBLIC_API_URL: parsed.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
  NEXT_PUBLIC_STELLAR_NETWORK: parsed.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet",
  NEXT_PUBLIC_APP_VERSION: parsed.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
  NEXT_PUBLIC_BUILD_SHA: parsed.NEXT_PUBLIC_BUILD_SHA ?? "local",
};

export const stellarNetworkConfig = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
    contractId: parsed.NEXT_PUBLIC_STELLAR_TESTNET_CONTRACT_ID,
  },
  mainnet: {
    rpcUrl: "https://soroban.stellar.org",
    passphrase: "Public Global Stellar Network ; September 2015",
    contractId: parsed.NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID,
  },
} as const;

export const activeStellarNetwork = stellarNetworkConfig[env.NEXT_PUBLIC_STELLAR_NETWORK];