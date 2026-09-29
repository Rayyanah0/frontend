import { useWalletStore } from "../store/wallet";
import { broadcast, onTabMessage } from "./channel";

/**
 * Propagates sign-in / sign-out / token refresh between tabs. Local store
 * changes to address/token/network are broadcast; incoming messages are
 * applied with setState (which doesn't trigger a Freighter prompt), and
 * the equality check below stops the two directions echoing forever.
 */
export function startSessionSync(): () => void {
  let last = snapshot();

  const unsubStore = useWalletStore.subscribe((s) => {
    const next = { address: s.address, token: s.token, network: s.network };
    if (next.address === last.address && next.token === last.token && next.network === last.network) return;
    last = next;
    broadcast({ type: "session", ...next });
  });

  const unsubMsg = onTabMessage((msg) => {
    if (msg.type !== "session") return;
    const cur = useWalletStore.getState();
    if (cur.address === msg.address && cur.token === msg.token && cur.network === msg.network) return;
    last = { address: msg.address, token: msg.token, network: msg.network };
    useWalletStore.setState(
      msg.address
        ? { status: "connected", address: msg.address, token: msg.token, network: msg.network, error: null }
        : { status: "idle", address: null, token: null, network: null, error: null }
    );
  });

  return () => {
    unsubStore();
    unsubMsg();
  };
}

function snapshot() {
  const s = useWalletStore.getState();
  return { address: s.address, token: s.token, network: s.network };
}
