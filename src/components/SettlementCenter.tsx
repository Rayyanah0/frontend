'use client';

import { useState, useMemo } from 'react';
import { useWalletStore } from '../lib/store/wallet';
import { useBackendSettlement } from '../lib/hooks/useBackendSettlement';
import { useBackendData } from '../lib/context/BackendDataContext';
import { sendNotification } from '../lib/notify';
import { ApiError } from '../lib/api/client';
import { fmtN } from '../lib/pricing';
import type { SettlementEntry } from '../lib/api/settlement';
import { EXTERNAL_LINK_REL, safeText, safeUrl } from '../lib/sanitize';

function fmtTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function truncateHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-6)}` : hash;
}

export function SettlementCenter() {
  const token = useWalletStore(s => s.session);
  const { refreshAccount } = useBackendData();
  const { entries, loading, refresh, claim, reclaim, claimBatch } = useBackendSettlement(token);

  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const claimableIds = useMemo(
    () => entries.filter(e => e.settlement_status === 'claimable').map(e => e.position_id),
    [entries]
  );

  const handleClaim = async (entry: SettlementEntry) => {
    setActionError(null);
    setSuccessMsg(null);
    setPendingId(entry.position_id);
    try {
      const result = await claim(entry.position_id);
      refreshAccount();
      setSuccessMsg(`Claimed $${fmtN(result.payout, 2)} payout${result.tx_hash ? ` · ${truncateHash(result.tx_hash)}` : ''}`);
      sendNotification('Payout Claimed', `Received $${fmtN(result.payout, 2)} for ${entry.underlying} ${entry.option_type}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Claim failed');
    } finally {
      setPendingId(null);
    }
  };

  const handleReclaim = async (entry: SettlementEntry) => {
    setActionError(null);
    setSuccessMsg(null);
    setPendingId(entry.position_id);
    try {
      const result = await reclaim(entry.position_id);
      refreshAccount();
      setSuccessMsg(`Reclaimed $${fmtN(result.collateral_released, 2)} collateral${result.tx_hash ? ` · ${truncateHash(result.tx_hash)}` : ''}`);
      sendNotification('Collateral Reclaimed', `Returned $${fmtN(result.collateral_released, 2)} for ${entry.underlying} ${entry.option_type}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Reclaim failed');
    } finally {
      setPendingId(null);
    }
  };

  const handleBatchClaim = async () => {
    if (claimableIds.length === 0) return;
    setActionError(null);
    setSuccessMsg(null);
    setBatchProgress({ current: 0, total: claimableIds.length });
    try {
      // Try batch endpoint first; if not supported fall back to sequential
      const result = await claimBatch(claimableIds);
      refreshAccount();
      setBatchProgress(null);
      const count = result.claimed.length;
      setSuccessMsg(
        `Claimed ${count} position${count === 1 ? '' : 's'}` +
        (result.failed.length > 0 ? ` · ${result.failed.length} failed` : '')
      );
      sendNotification('Batch Claim Complete', `${count} payout${count === 1 ? '' : 's'} claimed`);
    } catch {
      // Fall back to sequential if batch not supported
      let succeeded = 0;
      for (let i = 0; i < claimableIds.length; i++) {
        setBatchProgress({ current: i + 1, total: claimableIds.length });
        try {
          await claim(claimableIds[i]);
          succeeded++;
        } catch {
          // Continue to next
        }
      }
      refreshAccount();
      setBatchProgress(null);
      setSuccessMsg(`Claimed ${succeeded} of ${claimableIds.length} positions`);
    }
  };

  const copyHash = (hash: string) => {
    navigator.clipboard?.writeText(hash).catch(() => {});
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  if (!token) {
    return (
      <div style={{
        padding: '48px 0', textAlign: 'center',
        border: '1px solid var(--border-subtle)', background: 'var(--bg-raised)',
      }}>
        <div style={{ fontSize: 13, color: 'var(--text-mid)' }}>Connect your wallet to view expired positions.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ border: '1px solid var(--border-default)', background: 'var(--bg-raised)' }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 44, margin: '1px 0' }} />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div style={{
        padding: '48px 0', textAlign: 'center',
        border: '1px solid var(--border-subtle)', background: 'var(--bg-raised)',
      }}>
        <div style={{ fontSize: 14, color: 'var(--text-mid)' }}>No expired positions to settle.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text-mid)', flex: 1 }}>
          {entries.length} expired position{entries.length === 1 ? '' : 's'}
          {claimableIds.length > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--call)' }}>
              · {claimableIds.length} claimable
            </span>
          )}
        </div>
        {claimableIds.length > 1 && (
          <button
            onClick={handleBatchClaim}
            disabled={!!batchProgress}
            style={{
              fontSize: 11, fontWeight: 600,
              background: 'var(--call)', color: 'var(--bg)',
              border: 'none', padding: '6px 14px', cursor: batchProgress ? 'default' : 'pointer',
              opacity: batchProgress ? 0.7 : 1,
            }}
          >
            {batchProgress
              ? `Claiming ${batchProgress.current} of ${batchProgress.total}…`
              : `Claim All (${claimableIds.length})`}
          </button>
        )}
        <button
          onClick={refresh}
          style={{
            fontSize: 11, color: 'var(--text-lo)', background: 'none',
            border: '1px solid var(--border-default)', padding: '5px 12px', cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {/* Success / Error banners */}
      {successMsg && (
        <div style={{
          marginBottom: 12, padding: '10px 14px',
          border: '1px solid var(--call)', background: 'var(--call-dim)',
          fontSize: 12, color: 'var(--call)', display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} style={{
            background: 'none', border: 'none', color: 'var(--text-lo)', cursor: 'pointer', fontSize: 12,
          }}>×</button>
        </div>
      )}
      {actionError && (
        <div style={{
          marginBottom: 12, padding: '10px 14px',
          border: '1px solid var(--put)', background: 'var(--put-dim)',
          fontSize: 12, color: 'var(--put)', display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} style={{
            background: 'none', border: 'none', color: 'var(--text-lo)', cursor: 'pointer', fontSize: 12,
          }}>×</button>
        </div>
      )}

      {/* Table */}
      <div style={{ border: '1px solid var(--border-default)', background: 'var(--bg-raised)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-overlay)' }}>
              {['Asset', 'Type', 'Side', 'Strike', 'Qty', 'Settlement Price', 'Outcome', 'Amount', 'Action'].map(h => (
                <th key={h} style={{
                  padding: '8px 10px', fontSize: 10, fontWeight: 500,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: 'var(--text-lo)', textAlign: 'right',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => {
              const isPending = pendingId === entry.position_id;

              const outcomeColor =
                entry.settlement_status === 'claimable' ? 'var(--call)' :
                entry.settlement_status === 'claimed' ? 'var(--text-mid)' :
                entry.settlement_status === 'auto_settled' ? 'var(--atm)' :
                'var(--text-mid)';

              return (
                <tr key={entry.position_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px', fontSize: 12, fontWeight: 600, color: 'var(--text-hi)' }}>
                    {entry.underlying}
                  </td>
                  <td style={{ padding: '10px 4px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 6px',
                      background: entry.position_type === 'short' ? 'var(--put-dim)' : 'var(--call-dim)',
                      color: entry.position_type === 'short' ? 'var(--put)' : 'var(--call)',
                      textTransform: 'uppercase',
                    }}>{entry.position_type}</span>
                  </td>
                  <td style={{ padding: '10px 4px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 6px',
                      background: entry.option_type === 'call' ? 'var(--call-dim)' : 'var(--put-dim)',
                      color: entry.option_type === 'call' ? 'var(--call)' : 'var(--put)',
                      textTransform: 'uppercase',
                    }}>{entry.option_type}</span>
                  </td>
                  <td className="num" style={{ padding: '10px', fontSize: 11, textAlign: 'right', color: 'var(--text-hi)' }}>
                    {entry.strike >= 1000 ? entry.strike.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : entry.strike.toFixed(4)}
                  </td>
                  <td className="num" style={{ padding: '10px', fontSize: 11, textAlign: 'right', color: 'var(--text-hi)' }}>
                    {entry.contracts}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    <div className="num" style={{ fontSize: 11, color: 'var(--text-hi)' }}>
                      ${fmtN(entry.settlement_price, 4)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-lo)', marginTop: 2 }}>
                      {safeUrl(entry.settlement_price_source_url) ? (
                        <a
                          href={safeUrl(entry.settlement_price_source_url)!}
                          target="_blank"
                          rel={EXTERNAL_LINK_REL}
                          style={{ color: 'var(--brand)', textDecoration: 'none' }}
                        >
                          {safeText(entry.settlement_price_source, { maxLength: 60 })}
                        </a>
                      ) : (
                        <span>{safeText(entry.settlement_price_source, { maxLength: 60 })}</span>
                      )}
                      {' · '}{fmtTimestamp(entry.settlement_price_timestamp)}
                    </div>
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    <span style={{ fontSize: 11, color: outcomeColor, fontWeight: 600 }}>
                      {entry.settlement_status === 'claimable' ? 'ITM — claimable' :
                       entry.settlement_status === 'reclaimable' ? 'Collateral released' :
                       entry.settlement_status === 'auto_settled' ? 'Auto-settled' :
                       entry.settlement_status === 'claimed' ? 'Claimed' :
                       entry.settlement_status === 'reclaimed' ? 'Reclaimed' :
                       entry.settlement_status}
                    </span>
                  </td>
                  <td className="num" style={{ padding: '10px', textAlign: 'right', fontSize: 11 }}>
                    {entry.settlement_status === 'claimable' || entry.settlement_status === 'claimed' ? (
                      <span style={{ color: 'var(--call)', fontWeight: 600 }}>
                        +${fmtN(entry.payout, 2)}
                      </span>
                    ) : (entry.settlement_status === 'reclaimable' || entry.settlement_status === 'reclaimed') ? (
                      <span style={{ color: 'var(--atm)', fontWeight: 600 }}>
                        ${fmtN(entry.collateral_released, 2)}
                      </span>
                    ) : <span style={{ color: 'var(--text-lo)' }}>—</span>}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {entry.settlement_status === 'claimable' && (
                      <button
                        onClick={() => handleClaim(entry)}
                        disabled={isPending}
                        style={{
                          fontSize: 10, fontWeight: 600, color: 'var(--bg)',
                          background: 'var(--call)', border: 'none',
                          padding: '4px 10px', cursor: isPending ? 'default' : 'pointer',
                          opacity: isPending ? 0.6 : 1,
                        }}
                      >
                        {isPending ? 'Claiming…' : 'Claim Payout'}
                      </button>
                    )}
                    {entry.settlement_status === 'reclaimable' && (
                      <button
                        onClick={() => handleReclaim(entry)}
                        disabled={isPending}
                        style={{
                          fontSize: 10, fontWeight: 600, color: 'var(--bg)',
                          background: 'var(--atm)', border: 'none',
                          padding: '4px 10px', cursor: isPending ? 'default' : 'pointer',
                          opacity: isPending ? 0.6 : 1,
                        }}
                      >
                        {isPending ? 'Reclaiming…' : 'Reclaim Collateral'}
                      </button>
                    )}
                    {entry.settlement_status === 'auto_settled' && (
                      <span style={{
                        fontSize: 10, color: 'var(--atm)',
                        border: '1px solid var(--atm-dim)', padding: '3px 8px',
                      }}>Settled Automatically</span>
                    )}
                    {(entry.settlement_status === 'claimed' || entry.settlement_status === 'reclaimed') && entry.tx_hash && (
                      <button
                        onClick={() => copyHash(entry.tx_hash!)}
                        title={entry.tx_hash}
                        style={{
                          fontSize: 10, color: 'var(--text-lo)', background: 'none',
                          border: '1px solid var(--border-default)', padding: '3px 8px', cursor: 'pointer',
                        }}
                      >
                        {copiedHash === entry.tx_hash ? 'Copied!' : `Tx: ${truncateHash(entry.tx_hash)}`}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
