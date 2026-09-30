import { useCallback, useEffect, useState } from 'react';
import {
  listSettlements,
  claimPayout,
  reclaimCollateral,
  batchClaim,
  type SettlementEntry,
  type BatchClaimResult,
} from '../api/settlement';

export function useBackendSettlement(token: string | null) {
  const [entries, setEntries] = useState<SettlementEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!token) { setEntries([]); return; }
    setLoading(true);
    listSettlements(token)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  const claim = useCallback(
    async (positionId: string): Promise<SettlementEntry> => {
      if (!token) throw new Error('Connect and sign in with your wallet first');
      const result = await claimPayout(positionId, token);
      refresh();
      return result;
    },
    [token, refresh]
  );

  const reclaim = useCallback(
    async (positionId: string): Promise<SettlementEntry> => {
      if (!token) throw new Error('Connect and sign in with your wallet first');
      const result = await reclaimCollateral(positionId, token);
      refresh();
      return result;
    },
    [token, refresh]
  );

  const claimBatch = useCallback(
    async (positionIds: string[]): Promise<BatchClaimResult> => {
      if (!token) throw new Error('Connect and sign in with your wallet first');
      const result = await batchClaim(positionIds, token);
      refresh();
      return result;
    },
    [token, refresh]
  );

  return { entries, loading, refresh, claim, reclaim, claimBatch };
}
