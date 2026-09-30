/**
 * Runtime configuration singleton.
 *
 * NEXT_PUBLIC_* values are baked into the JS bundle at build time, which
 * means a single image cannot serve both staging and production without a
 * rebuild.  This module solves that by fetching /api/runtime-config on
 * first call and caching the result in memory for the lifetime of the tab.
 *
 * Server components and server-side code should read process.env directly
 * (values are always available server-side); this module is for client
 * components that need dynamic runtime values.
 *
 * Usage:
 *   const { apiUrl } = await getRuntimeConfig();
 *
 * The promise is cached — concurrent callers get the same promise rather
 * than racing to /api/runtime-config.
 */

export interface RuntimeConfig {
  /** Zenith backend base URL, e.g. "https://api.zenith.finance" */
  apiUrl: string;
  /** Soroban RPC URL */
  rpcUrl: string;
  /** Stellar network name ("mainnet" | "testnet") */
  network: string;
  /** Zenith options contract ID on Soroban */
  contractId: string;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
  network: process.env.NEXT_PUBLIC_NETWORK ?? "testnet",
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? "",
};

let _promise: Promise<RuntimeConfig> | null = null;

/**
 * Fetch and cache the runtime configuration.  Safe to call from any client
 * component — the network request is made at most once per page lifetime.
 */
export function getRuntimeConfig(): Promise<RuntimeConfig> {
  // Only runs in the browser; during SSR return the build-time defaults
  // synchronously wrapped in a resolved promise.
  if (typeof window === "undefined") {
    return Promise.resolve({ ...DEFAULT_CONFIG });
  }

  if (!_promise) {
    _promise = fetch("/api/runtime-config")
      .then((res) => {
        if (!res.ok) throw new Error(`/api/runtime-config returned ${res.status}`);
        return res.json() as Promise<RuntimeConfig>;
      })
      .catch((err) => {
        // Network error or parse failure — fall back to build-time baked
        // values so the app still works in local dev without Docker.
        console.warn("[runtimeConfig] fetch failed, using build-time defaults:", err);
        _promise = null; // allow retry on next call
        return { ...DEFAULT_CONFIG };
      });
  }

  return _promise;
}

/**
 * Synchronous accessor — returns DEFAULT_CONFIG before the async fetch
 * resolves.  Useful for initializing stores where an async call is not
 * practical; call getRuntimeConfig() first if you need the live values.
 */
export function getRuntimeConfigSync(): RuntimeConfig {
  return { ...DEFAULT_CONFIG };
}
