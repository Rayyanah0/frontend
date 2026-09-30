import { useWalletStore } from "../store/wallet";
import { broadcast, onTabMessage } from "./channel";

/**
 * Propagates sign-in / sign-out between tabs. The session itself is an
 * httpOnly cookie shared by every tab (#118), so only the non-secret
 * address / session marker / network are broadcast. When one tab signs
 * out, the others update their UI immediately instead of discovering it on
 * the next 401. Incoming messages are applied with setState (which doesn't
 * trigger a wallet prompt), and the equality check below stops the two
 * directions echoing forever.
 */
export function startSessionSync(): () => void {
  let last = snapshot();

  const unsubStore = useWalletStore.subscribe((s) => {
    const next = { address: s.address, session: s.session, network: s.network };
    if (next.address === last.address && next.session === last.session && next.network === last.network) return;
    last = next;
    broadcast({ type: "session", ...next });
  });

  const unsubMsg = onTabMessage((msg) => {
    if (msg.type !== "session") return;
    const cur = useWalletStore.getState();
    if (cur.address === msg.address && cur.session === msg.session && cur.network === msg.network) return;
    last = { address: msg.address, session: msg.session, network: msg.network };
    useWalletStore.setState(
      msg.address
        ? { status: "connected", address: msg.address, session: msg.session, network: msg.network, error: null }
        : { status: "idle", address: null, session: null, sessionExpiresAt: null, network: null, error: null }
    );
  });

  return () => {
    unsubStore();
    unsubMsg();
  };
}

function snapshot() {
  const s = useWalletStore.getState();
  return { address: s.address, session: s.session, network: s.network };
}
