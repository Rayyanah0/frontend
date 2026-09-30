"use client";

import { useEffect } from "react";
import { useWalletStore } from "../lib/store/wallet";
import { useTrackerStore } from "../lib/store/tracker";

// Both wallet and tracker use skipHydration — pull them in after mount
// so the server-rendered HTML matches the plain default state instead of
// blowing up hydration with localStorage values the server never saw.
export function StoreHydrator() {
  useEffect(() => {
    useWalletStore.persist.rehydrate();
    useTrackerStore.persist.rehydrate();
  }, []);
  return null;
}
