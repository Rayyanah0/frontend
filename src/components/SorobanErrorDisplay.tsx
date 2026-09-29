'use client';

import { useState } from 'react';
import { resolveError, type SorobanErrorEntry } from '../lib/soroban/errorCodes';

export interface SorobanErrorProps {
  /** Raw error string from the transaction result, e.g. "Error(Contract, #7)" */
  raw: string;
  /** Transaction hash (if available) */
  txHash?: string;
  /** Simulation events (if available) */
  simulationEvents?: unknown[];
  /** App version string */
  appVersion?: string;
  onDismiss?: () => void;
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

export function SorobanErrorDisplay({
  raw,
  txHash,
  simulationEvents,
  appVersion = APP_VERSION,
  onDismiss,
}: SorobanErrorProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const resolved: SorobanErrorEntry | null = resolveError(raw);

  const copyDiagnostics = () => {
    const diag = {
      version: appVersion,
      timestamp: new Date().toISOString(),
      txHash: txHash ?? null,
      rawError: raw,
      errorKey: resolved?.key ?? null,
      simulationEvents: simulationEvents ?? [],
    };
    navigator.clipboard?.writeText(JSON.stringify(diag, null, 2)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const severityColor =
    resolved?.severity === 'warning' ? 'var(--atm)' :
    resolved?.severity === 'info' ? 'var(--text-mid)' :
    'var(--put)';
  const severityBg =
    resolved?.severity === 'warning' ? 'var(--atm-dim)' :
    resolved?.severity === 'info' ? 'var(--bg-overlay)' :
    'var(--put-dim)';

  return (
    <div style={{
      border: `1px solid ${severityColor}`,
      background: severityBg,
      padding: '12px 14px',
      fontSize: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: severityColor, marginBottom: 4 }}>
            {resolved ? resolved.message : raw}
          </div>
          {resolved && (
            <div style={{ color: 'var(--text-mid)', lineHeight: 1.5 }}>
              {resolved.suggestion}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={copyDiagnostics}
            title="Copy diagnostics bundle (tx hash, error code, events, version)"
            style={{
              fontSize: 10, color: 'var(--text-lo)', background: 'none',
              border: '1px solid var(--border-default)', padding: '3px 9px', cursor: 'pointer',
            }}
          >
            {copied ? 'Copied!' : 'Copy diagnostics'}
          </button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              style={{
                fontSize: 12, color: 'var(--text-lo)', background: 'none',
                border: 'none', padding: '3px 6px', cursor: 'pointer',
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Technical details (collapsible) */}
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
        {resolved && (
          <span className="num" style={{ fontSize: 10, color: 'var(--text-lo)' }}>
            {resolved.key} (code {resolved.code})
          </span>
        )}
        {txHash && (
          <span className="num" style={{ fontSize: 10, color: 'var(--text-lo)' }}>
            tx: {txHash.length > 12 ? `${txHash.slice(0, 6)}…${txHash.slice(-6)}` : txHash}
          </span>
        )}
        {!resolved && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              fontSize: 10, color: 'var(--text-lo)', background: 'none',
              border: 'none', padding: 0, cursor: 'pointer',
            }}
          >
            {expanded ? 'Hide raw' : 'Show raw'}
          </button>
        )}
      </div>

      {/* Raw error fallback */}
      {!resolved && expanded && (
        <pre className="num" style={{
          marginTop: 8, padding: '8px', background: 'var(--bg-overlay)',
          fontSize: 10, color: 'var(--text-mid)', overflowX: 'auto', whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {raw}
        </pre>
      )}
    </div>
  );
}
