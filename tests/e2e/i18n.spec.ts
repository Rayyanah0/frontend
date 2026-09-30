import { expect, test } from "@playwright/test";

// #116: smoke-run each locale.
const LOCALES = [
  { locale: "en", prefix: "", heading: "How Zenith works", nav: "Portfolio" },
  { locale: "es", prefix: "/es", heading: "Cómo funciona Zenith", nav: "Cartera" },
  { locale: "pt", prefix: "/pt", heading: "Como o Zenith funciona", nav: "Carteira" },
];

for (const { locale, prefix, heading, nav } of LOCALES) {
  test(`${locale}: home renders translated, lang and hreflang set`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /hydrat|MISSING_MESSAGE/i.test(m.text())) errors.push(m.text());
    });
    const res = await page.goto(`${prefix}/`);
    expect(res!.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByRole("link", { name: nav }).first()).toBeVisible();
    expect(res!.headers()["link"]).toMatch(/hreflang="es"/);
    expect(await page.locator('link[rel="alternate"][hreflang="pt"]').count()).toBe(1);
    expect(errors).toEqual([]); // no hydration mismatch or missing keys
  });

  test(`${locale}: dense terminal pages render`, async ({ page }) => {
    for (const path of ["/options", "/portfolio", "/settings"]) {
      const res = await page.goto(`${prefix}${path}`);
      expect(res!.status(), path).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    }
  });
}

test("Accept-Language redirects to the matching locale", async ({ browser }) => {
  const context = await browser.newContext({ locale: "es-ES" });
  const page = await context.newPage();
  await page.goto("/");
  expect(new URL(page.url()).pathname).toMatch(/^\/es\/?$/);
  await context.close();
});

test("switcher choice persists via NEXT_LOCALE", async ({ page, context }) => {
  await page.goto("/settings");
  await page.getByRole("combobox", { name: "Language" }).first().selectOption("pt");
  await page.waitForURL(/\/pt\/settings/);
  const cookie = (await context.cookies()).find((c) => c.name === "NEXT_LOCALE");
  expect(cookie?.value).toBe("pt");
  await page.goto("/options");
  await page.waitForURL(/\/pt\/options/);
});
