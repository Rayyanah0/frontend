# Realtime protocol

Today the backend exposes one socket per feed (`/api/v1/ws/spot`); `RealtimeClient` opens one socket per (channel, params) with ref-counted subscriptions through a `ChannelAdapter`.

Desired multiplexed protocol (`/api/v1/ws`), JSON frames:
- client -> `{"op":"subscribe","channel":"chain","params":{...},"id":"..."}` / `{"op":"unsubscribe","id":"..."}`
- server -> `{"channel":"chain","id":"...","seq":N,"ts":<ms>,"data":{...}}`
- both -> `{"op":"ping"}` / `{"op":"pong"}` every 15s, so stale detection does not depend on tick cadence.
- server acks/errs subscriptions: `{"op":"subscribed"|"error","id":"..."}`; on reconnect the client resends all active subscriptions.
