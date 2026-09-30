"use client";

import { useEffect } from "react";
import { purgeLegacyWalletToken, useWalletStore } from "../lib/store/wallet";
import { useTrackerStore } from "../lib/store/tracker";

// Both wallet and tracker use skipHydration — pull them in after mount
// so the server-rendered HTML matches the plain default state instead of
// blowing up hydration with localStorage values the server never saw.
//
// Session state is no longer in localStorage (#118): the wallet store only
// persists the public address, and whether a session exists is asked of the
// BFF (httpOnly cookie) by checkConnection(). Any bearer token left over from
// pre-BFF builds is purged before rehydration.
export function StoreHydrator() {
  useEffect(() => {
    purgeLegacyWalletToken();
    void useWalletStore.persist.rehydrate();
    void useTrackerStore.persist.rehydrate();
    void useWalletStore.getState().checkConnection();
  }, []);
  return null;
}
