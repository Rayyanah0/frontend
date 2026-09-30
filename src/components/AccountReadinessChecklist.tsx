"use client";

import { useState } from "react";
import freighterApi from "@stellar/freighter-api";
import { useAccountReadiness } from "../lib/hooks/useAccountReadiness";
import { useWalletStore } from "../lib/store/wallet";
import {
  requestFriendbot,
  submitTransactionXdr,
  explorerAccountUrl,
  COLLATERAL_ASSET_CODE,
  COLLATERAL_ASSET_ISSUER,
  RESERVE_PER_ENTRY_XLM,
} from "../lib/api/stellar";

const IS_TESTNET =
  (process.env.NEXT_PUBLIC_NETWORK_LABEL ?? "Testnet").toLowerCase() ===
  "testnet";

// Approximate fee for a Change Trust operation (100 stroops = 0.00001 XLM).
const TRUSTLINE_FEE_XLM = 0.00001;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function CheckRow({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: 13,
          lineHeight: 1,
          marginTop: 1,
          color: ok ? "var(--call)" : "var(--put)",
          flexShrink: 0,
        }}
      >
        {ok ? "✓" : "✗"}
      </span>
      <div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: ok ? "var(--text-hi)" : "var(--text-mid)",
          }}
        >
          {label}
        </span>
        {detail && (
          <div style={{ fontSize: 11, color: "var(--text-lo)", marginTop: 2 }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface AccountReadinessChecklistProps {
  /** If true, show a compact inline badge instead of the full panel. */
  compact?: boolean;
}

/**
 * Displays the four on-chain readiness checks and action buttons for
 * missing steps (friendbot funding on testnet, add-trustline).
 *
 * Also shows live XLM and collateral balances labelled distinctly from
 * the backend paper-trading balance.
 */
export function AccountReadinessChecklist({
  compact = false,
}: AccountReadinessChecklistProps) {
  const address = useWalletStore((s) => s.address);
  const { readiness, loading, error, refresh } = useAccountReadiness();
  const [friendbotLoading, setFriendbotLoading] = useState(false);
  const [friendbotError, setFriendbotError] = useState<string | null>(null);
  const [trustlineLoading, setTrustlineLoading] = useState(false);
  const [trustlineError, setTrustlineError] = useState<string | null>(null);
  const [trustlineTxHash, setTrustlineTxHash] = useState<string | null>(null);

  if (!address) return null;

  // Compact badge: just a green/amber/red dot + short label.
  if (compact) {
    const label = loading
      ? "Checking…"
      : readiness.isReady
      ? "On-chain ready"
      : "Account setup needed";
    const color = loading
      ? "var(--text-lo)"
      : readiness.isReady
      ? "var(--call)"
      : "var(--atm)";
    return (
      <span
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          color,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            display: "inline-block",
          }}
        />
        {label}
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Action: Friendbot (testnet funding)
  // ---------------------------------------------------------------------------
  async function handleFriendbot() {
    if (!address) return;
    setFriendbotLoading(true);
    setFriendbotError(null);
    try {
      await requestFriendbot(address);
      refresh();
    } catch (err) {
      setFriendbotError(
        err instanceof Error ? err.message : "Friendbot request failed"
      );
    } finally {
      setFriendbotLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Action: Add trustline for collateral asset
  // ---------------------------------------------------------------------------
  async function handleAddTrustline() {
    if (!address || !readiness.account) return;
    setTrustlineLoading(true);
    setTrustlineError(null);
    setTrustlineTxHash(null);
    try {
      // Build a minimal Change Trust XDR. We avoid pulling the full
      // stellar-sdk here (it's heavy and not in package.json) and instead
      // ask the backend to build the transaction envelope for us via a
      // dedicated helper endpoint. If that endpoint isn't deployed yet, we
      // fall back to a static base64 placeholder and surface a clear message.
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
      const buildRes = await fetch(`${apiBase}/api/v1/onchain/build-trustline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet_address: address,
          asset_code: COLLATERAL_ASSET_CODE,
          asset_issuer: COLLATERAL_ASSET_ISSUER,
        }),
      });

      if (!buildRes.ok) {
        throw new Error(
          `Backend couldn't build trustline tx (${buildRes.status}). ` +
            "Add the trustline manually in Freighter or Stellar Laboratory."
        );
      }

      const { xdr } = (await buildRes.json()) as { xdr: string };

      // Ask Freighter to sign the envelope (no network switch needed).
      const signed = await freighterApi.signTransaction(xdr, {
        accountToSign: address,
      });

      // Submit to Horizon.
      const { hash } = await submitTransactionXdr(signed);
      setTrustlineTxHash(hash);
      refresh();
    } catch (err) {
      setTrustlineError(
        err instanceof Error ? err.message : "Failed to add trustline"
      );
    } finally {
      setTrustlineLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render the full checklist panel
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-default)",
        padding: 14,
        fontSize: 12,
        minWidth: 280,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span
          style={{ fontWeight: 700, fontSize: 12, color: "var(--text-hi)" }}
        >
          On-chain Account Readiness
        </span>
        {loading ? (
          <span style={{ fontSize: 11, color: "var(--text-lo)" }}>
            Checking…
          </span>
        ) : (
          <button
            onClick={refresh}
            aria-label="Refresh readiness checks"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--text-lo)",
              padding: 0,
            }}
          >
            ↺ Refresh
          </button>
        )}
      </div>

      {/* Live on-chain balances (labelled to distinguish from paper-trading) */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-lo)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            XLM (on-chain)
          </div>
          <span className="num" style={{ fontSize: 13, color: "var(--text-hi)" }}>
            {readiness.xlmBalance.toFixed(4)}
          </span>
        </div>
        <div>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-lo)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {COLLATERAL_ASSET_CODE} (on-chain)
          </div>
          <span
            className="num"
            style={{ fontSize: 13, color: "var(--text-hi)" }}
          >
            {readiness.hasTrustline
              ? readiness.collateralBalance.toFixed(2)
              : "—"}
          </span>
        </div>
      </div>

      {error && (
        <div
          style={{
            color: "var(--put)",
            fontSize: 11,
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}

      {/* Check 1: Account exists */}
      <CheckRow
        ok={readiness.exists}
        label="Account exists & funded"
        detail={
          !readiness.exists ? (
            IS_TESTNET ? (
              <span>
                Account not found on-chain.{" "}
                <button
                  onClick={handleFriendbot}
                  disabled={friendbotLoading}
                  aria-label="Fund account with Friendbot"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: friendbotLoading ? "default" : "pointer",
                    color: "var(--brand)",
                    padding: 0,
                    fontSize: 11,
                    textDecoration: "underline",
                    opacity: friendbotLoading ? 0.5 : 1,
                  }}
                >
                  {friendbotLoading ? "Requesting…" : "Fund with Friendbot (testnet)"}
                </button>
                {friendbotError && (
                  <span style={{ color: "var(--put)", marginLeft: 4 }}>
                    {friendbotError}
                  </span>
                )}
              </span>
            ) : (
              "Account not found. Fund your Stellar account before trading."
            )
          ) : (
            <a
              href={explorerAccountUrl(address)}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--text-lo)", textDecoration: "none" }}
            >
              View on explorer ↗
            </a>
          )
        }
      />

      {/* Check 2: XLM reserve */}
      <CheckRow
        ok={readiness.meetsReserve}
        label={`XLM reserve met (need ≥ ${readiness.minXlmRequired.toFixed(2)} XLM)`}
        detail={
          !readiness.meetsReserve
            ? `Current: ${readiness.xlmBalance.toFixed(4)} XLM. Top up your account to meet the Stellar minimum reserve + fee buffer.`
            : undefined
        }
      />

      {/* Check 3: Trustline */}
      <CheckRow
        ok={readiness.hasTrustline}
        label={`${COLLATERAL_ASSET_CODE} trustline added`}
        detail={
          !readiness.hasTrustline ? (
            <span>
              No {COLLATERAL_ASSET_CODE} trustline.{" "}
              <button
                onClick={handleAddTrustline}
                disabled={
                  trustlineLoading || !readiness.exists || !readiness.meetsReserve
                }
                aria-label={`Add ${COLLATERAL_ASSET_CODE} trustline`}
                style={{
                  background: "none",
                  border: "none",
                  cursor:
                    trustlineLoading ||
                    !readiness.exists ||
                    !readiness.meetsReserve
                      ? "default"
                      : "pointer",
                  color: "var(--brand)",
                  padding: 0,
                  fontSize: 11,
                  textDecoration: "underline",
                  opacity:
                    trustlineLoading ||
                    !readiness.exists ||
                    !readiness.meetsReserve
                      ? 0.5
                      : 1,
                }}
              >
                {trustlineLoading
                  ? "Signing…"
                  : `Add trustline (fee ≈ ${TRUSTLINE_FEE_XLM} XLM + ${RESERVE_PER_ENTRY_XLM} XLM reserve)`}
              </button>
              {trustlineTxHash && (
                <span style={{ color: "var(--call)", marginLeft: 4 }}>
                  ✓ Submitted —{" "}
                  <a
                    href={`${process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://stellar.expert/explorer/testnet"}/tx/${trustlineTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--call)" }}
                  >
                    view tx ↗
                  </a>
                </span>
              )}
              {trustlineError && (
                <span style={{ color: "var(--put)", marginLeft: 4 }}>
                  {trustlineError}
                </span>
              )}
            </span>
          ) : undefined
        }
      />

      {/* Check 4: Collateral balance */}
      <CheckRow
        ok={readiness.hasSufficientCollateral}
        label={`Sufficient ${COLLATERAL_ASSET_CODE} balance for trading`}
        detail={
          !readiness.hasSufficientCollateral
            ? readiness.hasTrustline
              ? `Current: ${readiness.collateralBalance.toFixed(2)} ${COLLATERAL_ASSET_CODE}. Deposit collateral to trade.`
              : `Add the ${COLLATERAL_ASSET_CODE} trustline first, then deposit collateral.`
            : undefined
        }
      />

      {readiness.isReady && (
        <div
          style={{
            marginTop: 10,
            padding: "6px 10px",
            background: "var(--call-dim)",
            border: "1px solid var(--call)",
            fontSize: 11,
            color: "var(--call)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>✓</span>
          <span>Account ready for on-chain trading.</span>
        </div>
      )}
    </div>
  );
}
