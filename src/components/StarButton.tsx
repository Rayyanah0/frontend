"use client";

import { useState } from "react";
import { useBackendData } from "../lib/context/BackendDataContext";
import { useWalletStore } from "../lib/store/wallet";
import { ApiError } from "../lib/api/client";

export function StarButton({ sym }: { sym: string }) {
  const token = useWalletStore(s => s.session);
  const { watchlist, addToWatchlist, removeFromWatchlist } = useBackendData();
  const [pending, setPending] = useState(false);
  const isFavorite = watchlist.some(w => w.underlying === sym);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token || pending) return;
    setPending(true);
    try {
      if (isFavorite) await removeFromWatchlist(sym);
      else await addToWatchlist(sym);
    } catch (err) {
      // A no-op click (e.g. a stale double-click racing a removal that
      // already landed) shouldn't surface as a user-facing error — the
      // watchlist state itself is the source of truth, not this button.
      if (!(err instanceof ApiError)) throw err;
    } finally {
      setPending(false);
    }
  };

  const label = !token
    ? "Connect your wallet to use the watchlist"
    : isFavorite
    ? `Remove ${sym} from watchlist`
    : `Add ${sym} to watchlist`;

  return (
    <button
      onClick={toggle}
      disabled={!token || pending}
      className="zn-tap zn-tap-w"
      title={label}
      aria-label={label}
      aria-pressed={isFavorite}
      style={{
        background: "none", border: "none", cursor: !token ? "default" : "pointer", padding: 2, lineHeight: 1,
        color: isFavorite ? "var(--atm)" : "var(--text-lo)", fontSize: 13, opacity: !token ? 0.4 : 1,
        outline: "none",
      }}
      onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
      onBlur={e => { e.currentTarget.style.outline = "none"; e.currentTarget.style.outlineOffset = "0px"; }}
    >
      {isFavorite ? "★" : "☆"}
    </button>
  );
}
