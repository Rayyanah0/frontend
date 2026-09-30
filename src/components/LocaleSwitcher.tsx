"use client";

// Language switcher (#116). Switching keeps the current path and query, and
// the next-intl middleware persists the choice in the NEXT_LOCALE cookie, so
// it sticks across visits and takes precedence over Accept-Language.

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "../i18n/navigation";
import { LOCALE_LABELS, locales, type Locale } from "../i18n/routing";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("locale");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-lo)" }}>
      {!compact && <span>{t("label")}</span>}
      <select
        aria-label={t("label")}
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as Locale;
          const query = search?.toString();
          startTransition(() => {
            router.replace(query ? `${pathname}?${query}` : pathname, { locale: next });
          });
        }}
        style={{ background: "var(--bg)", color: "var(--text-mid)", border: "1px solid var(--border-default)", fontSize: 11, padding: "2px 4px" }}
      >
        {locales.map((l) => (
          <option key={l} value={l} lang={l} aria-label={t("switchTo", { language: LOCALE_LABELS[l] })}>
            {compact ? l.toUpperCase() : LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
