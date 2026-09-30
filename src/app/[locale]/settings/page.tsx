"use client";

import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "../../../components/LocaleSwitcher";
import { AppHeader } from "../../../components/AppHeader";
import { WalletConnect } from "../../../components/WalletConnect";
import { DataExportPanel } from "../../../components/DataExportPanel";

export default function SettingsPage() {
  const t = useTranslations("settings");
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
      <AppHeader>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 64px" }}>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 4 }}>{t("title")}</h1>
          <p style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 32 }}>
            {t("intro")}
          </p>

          {/* Data Export / Import */}
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 16, paddingBottom: 8, borderBottom: "1px solid var(--border-default)" }}>
              {t("dataPortability")}
            </h2>
            <DataExportPanel />
          </section>

          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--border-default)" }}>
              {t("language")}
            </h2>
            <LocaleSwitcher />
            <p style={{ fontSize: 12, color: "var(--text-lo)", marginTop: 8 }}>{t("languageHelp")}</p>
          </section>

          {/* Placeholder sections for future settings */}
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--border-default)" }}>
              {t("preferences")}
            </h2>
            <div style={{ color: "var(--text-lo)", fontSize: 12, padding: 16, border: "1px solid var(--border-subtle)", background: "var(--bg-raised)" }}>
              {t("preferencesSoon")}
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--border-default)" }}>
              {t("hotkeys")}
            </h2>
            <div style={{ color: "var(--text-lo)", fontSize: 12, padding: 16, border: "1px solid var(--border-subtle)", background: "var(--bg-raised)" }}>
              {t("hotkeysSoon")}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
