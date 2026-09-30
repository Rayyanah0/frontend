'use client';

import { AppHeader } from '../../../components/AppHeader';
import { WalletConnect } from '../../../components/WalletConnect';
import { SettlementCenter } from '../../../components/SettlementCenter';

export default function SettlementPage() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: 'var(--bg)', overflow: 'hidden', fontFamily: 'var(--font-sans)',
    }}>
      <AppHeader>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--atm)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-lo)' }}>Settlement Center · Stellar Testnet</span>
          <div style={{ width: 1, height: 16, background: 'var(--border-default)', margin: '0 8px' }} />
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px 64px' }}>
          <div style={{ marginBottom: 28 }}>
            <h1 style={{
              fontFamily: 'var(--font-serif)', fontSize: 26,
              fontWeight: 600, marginBottom: 4,
            }}>Settlement Center</h1>
            <p style={{ fontSize: 13, color: 'var(--text-mid)' }}>
              Claim payouts for in-the-money expired positions, or reclaim released collateral.
            </p>
          </div>
          <SettlementCenter />
        </div>
      </div>
    </div>
  );
}
