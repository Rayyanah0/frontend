'use client';

import type { ParsedChallenge } from '../lib/auth/challengeValidator';

interface Props {
  challenge: ParsedChallenge;
  onProceed: () => void;
  onCancel: () => void;
  proceeding?: boolean;
}

export function SignInSummary({ challenge, onProceed, onCancel, proceeding = false }: Props) {
  const isLegacy = challenge.version === 'legacy';

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 400, background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)', padding: 24,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-hi)', marginBottom: 4 }}>
          Sign in to Zenith
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-lo)', marginBottom: 18 }}>
          Review the details below before your wallet signs.
        </div>

        {isLegacy ? (
          <div style={{
            padding: '12px', background: 'var(--atm-dim)',
            border: '1px solid var(--atm)', marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--atm)', marginBottom: 4 }}>
              Legacy sign-in format
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
              The server is using an unstructured challenge. Validation was skipped.
              Ask the Zenith backend to migrate to the structured format.
            </div>
            <pre className="num" style={{
              marginTop: 10, padding: 8, background: 'var(--bg-overlay)',
              fontSize: 10, color: 'var(--text-mid)', overflowX: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {challenge.rawMessage}
            </pre>
          </div>
        ) : (
          <div style={{
            padding: '14px', background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)', marginBottom: 16,
          }}>
            <Row label="Account" value={`${challenge.walletAddress.slice(0, 8)}…${challenge.walletAddress.slice(-8)}`} mono />
            <Row label="App domain" value={challenge.domain} />
            <Row label="Expires" value={challenge.expirationTime.toLocaleString()} />
            <Row label="Nonce" value={`${challenge.nonce.slice(0, 12)}…`} mono />
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-lo)', marginBottom: 16, lineHeight: 1.5 }}>
          Your wallet will sign this message. The signature proves ownership of your account
          and cannot be used to authorize transactions.
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '9px 0', background: 'none',
            border: '1px solid var(--border-default)',
            color: 'var(--text-mid)', fontSize: 12, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={onProceed} disabled={proceeding} style={{
            flex: 1, padding: '9px 0', background: 'var(--brand)',
            border: 'none', color: 'var(--bg)', fontSize: 12,
            fontWeight: 700, cursor: proceeding ? 'default' : 'pointer',
            opacity: proceeding ? 0.5 : 1,
          }}>{proceeding ? 'Signing…' : 'Sign & Continue'}</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-lo)' }}>{label}</span>
      <span className={mono ? 'num' : ''} style={{ fontSize: 11, color: 'var(--text-hi)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}
