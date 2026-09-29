/**
 * useSoroban — Issue #67.
 *
 * React hook exposing the Soroban RPC client for the active network.
 * Also exposes typed contract clients and startup contract ID validation.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ZenithSorobanClient, createSorobanClient, type SorobanHealth } from "./rpc";
import { getActiveNetworkConfig, validateContractIds, type NetworkConfig, type ValidationResult } from "./networks";
import { createContractClients, type ZenithContractClients } from "./contracts";

export interface UseSorobanResult {
  /** The active network config */
  network: NetworkConfig;
  /** The Soroban RPC client instance */
  client: ZenithSorobanClient;
  /** Typed contract clients (null if any contract ID is missing) */
  contracts: ZenithContractClients | null;
  /** Contract ID validation result */
  validation: ValidationResult;
  /** Live health status of the RPC node */
  health: SorobanHealth | null;
  /** Whether the health check is loading */
  healthLoading: boolean;
  /** Manually refresh the health check */
  refreshHealth: () => void;
}

const HEALTH_POLL_MS = 30_000; // Re-check every 30 s

export function useSoroban(): UseSorobanResult {
  const network = useMemo(() => getActiveNetworkConfig(), []);
  const client = useMemo(() => createSorobanClient(network), [network]);
  const contracts = useMemo(() => createContractClients(network.contracts), [network]);
  const validation = useMemo(() => validateContractIds(), []);

  const [health, setHealth] = useState<SorobanHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const mountedRef = useRef(true);

  const doHealthCheck = useMemo(() => async () => {
    setHealthLoading(true);
    const h = await client.health();
    if (mountedRef.current) {
      setHealth(h);
      setHealthLoading(false);
    }
  }, [client]);

  // Initial check + periodic polling
  useEffect(() => {
    mountedRef.current = true;
    doHealthCheck();
    const interval = setInterval(doHealthCheck, HEALTH_POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [doHealthCheck]);

  return {
    network,
    client,
    contracts,
    validation,
    health,
    healthLoading,
    refreshHealth: doHealthCheck,
  };
}
