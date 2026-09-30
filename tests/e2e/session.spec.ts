import { expect, test } from "@playwright/test";
import { MOCK_TOKEN, MOCK_WALLET } from "./mock-backend.mjs";

// #118: the session token must never be readable from JavaScript.
test("sign-in sets an httpOnly session and exposes no token to JS", async ({ page, context }) => {
  // Simulate a pre-BFF build having left a token behind.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("zenith-wallet", JSON.stringify({ state: { address: "GOLD", token: "legacy-bearer" }, version: 0 }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  await page.goto("/");

  // Sign in the way the wallet store does: GET mints CSRF, POST exchanges the signature.
  const result = await page.evaluate(async (wallet) => {
    await fetch("/api/bff/session", { credentials: "same-origin" });
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("zenith_csrf="))?.split("=")[1] ?? "";
    const res = await fetch("/api/bff/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-zenith-csrf": csrf },
      body: JSON.stringify({ wallet_address: wallet, message: "m", signature: "s" }),
    });
    const account = await fetch("/api/bff/api/v1/account", { credentials: "same-origin" });
    return { status: res.status, body: await res.text(), account: account.status };
  }, MOCK_WALLET);

  expect(result.status).toBe(200);
  expect(result.body).not.toContain(MOCK_TOKEN);
  expect(result.account).toBe(200); // BFF attached the bearer server-side

  // Nothing JS-readable contains the token.
  const { cookie, storage } = await page.evaluate(() => ({
    cookie: document.cookie,
    storage: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
  }));
  expect(cookie).not.toContain(MOCK_TOKEN);
  expect(cookie).not.toContain("zenith_session");
  expect(storage).not.toContain(MOCK_TOKEN);
  expect(storage).not.toContain("legacy-bearer"); // migration cleared the old key

  // And the session cookie carries the right flags.
  const session = (await context.cookies()).find((c) => c.name.endsWith("zenith_session"));
  expect(session).toBeDefined();
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe("Strict");
  expect(session!.value).not.toContain(MOCK_TOKEN);
});

test("sign-out in one tab signs out the others", async ({ context }) => {
  const [a, b] = [await context.newPage(), await context.newPage()];
  await a.goto("/");
  await b.goto("/");
  await a.evaluate(async () => {
    await fetch("/api/bff/session");
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("zenith_csrf="))?.split("=")[1] ?? "";
    await fetch("/api/bff/session", { method: "DELETE", headers: { "x-zenith-csrf": csrf } });
  });
  const state = await b.evaluate(async () => (await fetch("/api/bff/session")).json());
  expect(state.authenticated).toBe(false);
});
