'use client';

import { useBackendData } from '../lib/context/BackendDataContext';
import { SorobanEventProvider } from '../lib/context/SorobanEventContext';

export function SorobanEventBridge({ children }: { children: React.ReactNode }) {
  const { refreshPositions, refreshAccount } = useBackendData();
  return (
    <SorobanEventProvider
      onRefreshPositions={refreshPositions}
      onRefreshAccount={refreshAccount}
    >
      {children}
    </SorobanEventProvider>
  );
}
