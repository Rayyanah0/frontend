# Cross-tab sync

- `channel.ts` – versioned BroadcastChannel protocol (`session`, `spot`, `spot-demand`, `invalidate`).
- `leader.ts` – Web Locks leader election; only the leader tab holds the spot WebSocket and relays snapshots (at most one per animation frame).
- `session.ts` – sign-in/out/token-refresh propagation via the wallet store.
- Mutations broadcast `invalidate` (see `BackendDataContext`) so other tabs refetch account/positions.

Without BroadcastChannel/Web Locks every tab behaves as before (own socket, own session).

Future option (out of scope): a SharedWorker owning the socket and session.
