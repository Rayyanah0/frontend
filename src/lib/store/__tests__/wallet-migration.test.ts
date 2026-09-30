/**
 * #118: the bearer token must be gone from localStorage after upgrading.
 */

jest.mock("@stellar/freighter-api", () => ({ __esModule: true, default: {} }));
jest.mock("../../toast", () => ({ toast: { fromError: jest.fn() } }));

import { purgeLegacyWalletToken, useWalletStore, WALLET_STORAGE_KEY } from "../wallet";

beforeEach(() => localStorage.clear());

it("strips a legacy token from the persisted wallet state", () => {
  localStorage.setItem(
    WALLET_STORAGE_KEY,
    JSON.stringify({ state: { address: "GABC", token: "secret-bearer", tokenExpiresAt: 1 }, version: 0 })
  );
  expect(purgeLegacyWalletToken()).toBe(true);
  const raw = localStorage.getItem(WALLET_STORAGE_KEY)!;
  expect(raw).not.toContain("secret-bearer");
  expect(JSON.parse(raw)).toEqual({ state: { address: "GABC" }, version: 2 });
});

it("is a no-op for already-migrated state", () => {
  localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ state: { address: "GABC" }, version: 2 }));
  expect(purgeLegacyWalletToken()).toBe(false);
});

it("removes unparseable state entirely", () => {
  localStorage.setItem(WALLET_STORAGE_KEY, "{not json");
  expect(purgeLegacyWalletToken()).toBe(true);
  expect(localStorage.getItem(WALLET_STORAGE_KEY)).toBeNull();
});

it("persist.migrate drops the token even without the purge", async () => {
  localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ state: { address: "GABC", token: "secret-bearer" }, version: 0 }));
  await useWalletStore.persist.rehydrate();
  expect(useWalletStore.getState().address).toBe("GABC");
  expect(JSON.stringify(useWalletStore.getState())).not.toContain("secret-bearer");
  expect(localStorage.getItem(WALLET_STORAGE_KEY)).not.toContain("secret-bearer");
});

it("never persists session state", () => {
  useWalletStore.setState({ address: "GXYZ", session: "bff-session", sessionExpiresAt: 5 });
  const persisted = JSON.parse(localStorage.getItem(WALLET_STORAGE_KEY)!);
  expect(persisted.state).toEqual({ address: "GXYZ" });
});
