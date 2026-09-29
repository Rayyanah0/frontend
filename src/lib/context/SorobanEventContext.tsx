'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useWalletStore } from '../store/wallet';
import { useHydrated } from '../useHydrated';
import { startEventPoller, type EventPollerStatus } from '../soroban/eventPoller';
import { decodeZenithEvent, type ZenithEvent } from '../soroban/events';
import { sendNotification } from '../notify';
import type { RawSorobanEvent } from '../soroban/events';

const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.NEXT_PUBLIC_ZENITH_CONTRACT_ID ?? '';

interface SorobanEventContextValue {
  recentEvents: ZenithEvent[];
  pollerStatus: EventPollerStatus;
  subscribe: (handler: (event: ZenithEvent) => void) => () => void;
}

const SorobanEventContext = createContext<SorobanEventContextValue | null>(null);

/**
 * Mounts the Soroban event poller once at the root. Decodes incoming events,
 * fans them out to subscribers, and emits browser notifications for key events.
 * Only starts polling when a wallet is connected (address available).
 */
export function SorobanEventProvider({
  children,
  onRefreshPositions,
  onRefreshAccount,
}: {
  children: React.ReactNode;
  onRefreshPositions?: () => void;
  onRefreshAccount?: () => void;
}) {
  const hydrated = useHydrated();
  const address = useWalletStore(s => s.address);
  const effectiveAddress = hydrated ? address : null;

  const [recentEvents, setRecentEvents] = useState<ZenithEvent[]>([]);
  const [pollerStatus, setPollerStatus] = useState<EventPollerStatus>('idle');

  // Subscriber set — handlers registered by components to react to events
  const subscribers = useRef<Set<(e: ZenithEvent) => void>>(new Set());

  const subscribe = useCallback((handler: (event: ZenithEvent) => void) => {
    subscribers.current.add(handler);
    return () => subscribers.current.delete(handler);
  }, []);

  const handleRawEvents = useCallback(
    (rawEvents: RawSorobanEvent[]) => {
      const decoded: ZenithEvent[] = [];
      for (const raw of rawEvents) {
        const event = decodeZenithEvent(raw);
        if (!event) continue;

        // Only keep events relevant to the connected account
        const relevantAddress = effectiveAddress;
        const eventAddress = 'walletAddress' in event ? event.walletAddress : null;
        if (relevantAddress && eventAddress && eventAddress !== relevantAddress) continue;

        decoded.push(event);

        // Fan out to subscribers
        subscribers.current.forEach(h => h(event));

        // Emit notifications and trigger cache invalidation
        switch (event.type) {
          case 'position_opened':
            onRefreshPositions?.();
            sendNotification(
              'Position Opened',
              `${event.contracts}× ${event.underlying} ${event.optionType} K=${event.strike}`
            );
            break;
          case 'position_closed':
            onRefreshPositions?.();
            onRefreshAccount?.();
            sendNotification('Position Closed', `Realized P&L: ${event.realizedPnl >= 0 ? '+' : ''}${event.realizedPnl.toFixed(2)}`);
            break;
          case 'position_exercised':
            onRefreshPositions?.();
            onRefreshAccount?.();
            sendNotification('Option Exercised', `Payout: $${event.payout.toFixed(2)}`);
            break;
          case 'position_settled':
            onRefreshPositions?.();
            onRefreshAccount?.();
            sendNotification('Position Settled', `Collateral returned: $${event.collateralReleased.toFixed(2)}`);
            break;
          case 'deposit':
            onRefreshAccount?.();
            sendNotification('Deposit Confirmed', `$${event.amount.toFixed(2)} deposited`);
            break;
          case 'withdraw':
            onRefreshAccount?.();
            sendNotification('Withdrawal Confirmed', `$${event.amount.toFixed(2)} withdrawn`);
            break;
        }
      }

      if (decoded.length > 0) {
        setRecentEvents(prev => [...decoded, ...prev].slice(0, 50));
      }
    },
    [effectiveAddress, onRefreshPositions, onRefreshAccount]
  );

  useEffect(() => {
    // Only poll when a wallet is connected and a contract ID is configured
    if (!effectiveAddress || !CONTRACT_ID) {
      setPollerStatus('idle');
      return;
    }

    const stop = startEventPoller({
      rpcUrl: SOROBAN_RPC_URL,
      contractId: CONTRACT_ID,
      accountAddress: effectiveAddress,
      onEvents: handleRawEvents,
      onStatusChange: setPollerStatus,
      onError: (err) => console.error('[SorobanEventPoller]', err.message),
    });

    return stop;
  }, [effectiveAddress, handleRawEvents]);

  return (
    <SorobanEventContext.Provider value={{ recentEvents, pollerStatus, subscribe }}>
      {children}
    </SorobanEventContext.Provider>
  );
}

export function useSorobanEvents(): SorobanEventContextValue {
  const ctx = useContext(SorobanEventContext);
  if (!ctx) throw new Error('useSorobanEvents must be used within SorobanEventProvider');
  return ctx;
}
