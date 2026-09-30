"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "../i18n/navigation";
import { Logo } from "./Logo";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { AboutPanel } from "./AboutPanel";
import { useBackendData } from "../lib/context/BackendDataContext";
import { fmtN } from "../lib/pricing";
import { TrackerHeaderButton } from "./TransactionTracker";
import { ApiHealthBanner } from "./ApiHealthBanner";

const TABS = [
  { key: "chain", href: "/options" },
  { key: "portfolio", href: "/portfolio" },
  { key: "history", href: "/history" },
  { key: "vaults", href: "/vaults" },
  { key: "security", href: "/security" },
] as const;

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const t = useTranslations("header");
  const tNav = useTranslations("nav");
  // Locale-stripped path (e.g. "/options" on /es/options).
  const pathname = usePathname();
  // BackendDataProvider already handles the hydration-safety gating
  // (null token pre-hydration) — this just reads its shared result.
  const { account } = useBackendData();
  const balance = account?.balance ?? 0;
  const collateralLocked = account?.collateral_locked ?? 0;

  return (
    <>
    <header style={{
      height: 44, flexShrink: 0, display: "flex", alignItems: "center",
      borderBottom: "1px solid var(--border-default)", padding: "0 16px", gap: 16,
      background: "var(--bg-raised)",
    }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
        <Logo size={16} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--font-serif)" }}>Zenith</span>
      </Link>
      <div style={{ width: 1, height: 20, background: "var(--border-default)" }} />
      <div style={{ display: "flex", gap: 2 }}>
        {TABS.map(tab => (
          <Link key={tab.href} href={tab.href} style={{
            padding: "4px 10px", border: "none", cursor: "pointer",
            fontSize: 12, fontWeight: 600, textDecoration: "none",
            color: pathname?.startsWith(tab.href) ? "var(--text-hi)" : "var(--text-mid)",
            borderBottom: pathname?.startsWith(tab.href) ? "2px solid var(--brand)" : "2px solid transparent",
          }}>
            {tNav(tab.key)}
          </Link>
        ))}
      </div>
      <div style={{ width: 1, height: 20, background: "var(--border-default)" }} />

      <Link href="/portfolio" title={t("goToPortfolio")} style={{
        display: "flex", alignItems: "center", gap: 6, textDecoration: "none",
      }}>
        <span style={{ fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("balance")}</span>
        <span className="num" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>${fmtN(balance,2)}</span>
        {collateralLocked > 0 && (
          <span className="num" style={{ fontSize: 10, color: "var(--atm)" }}>{t("locked", { amount: `$${fmtN(collateralLocked,2)}` })}</span>
        )}
      </Link>
      <div style={{ width: 1, height: 20, background: "var(--border-default)" }} />

      {/* Global transaction tracker indicator */}
      <TrackerHeaderButton />

      {children}
      <LocaleSwitcher compact />
      <AboutPanel />
    </header>
    <ApiHealthBanner />
    </>
  );
}
