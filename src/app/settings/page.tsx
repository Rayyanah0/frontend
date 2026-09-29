"use client";

import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { DataExportPanel } from "../../components/DataExportPanel";

export default function SettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
      <AppHeader>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 64px" }}>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Settings</h1>
          <p style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 32 }}>
            Manage your local workspace data — saved strategies, layouts, hotkeys, and preferences.
          </p>

          {/* Data Export / Import */}
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 16, paddingBottom: 8, borderBottom: "1px solid var(--border-default)" }}>
              Data Portability
            </h2>
            <DataExportPanel />
          </section>

          {/* Placeholder sections for future settings */}
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--border-default)" }}>
              Preferences
            </h2>
            <div style={{ color: "var(--text-lo)", fontSize: 12, padding: 16, border: "1px solid var(--border-subtle)", background: "var(--bg-raised)" }}>
              Theme, number format, and default chain settings coming soon.
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--border-default)" }}>
              Hotkeys
            </h2>
            <div style={{ color: "var(--text-lo)", fontSize: 12, padding: 16, border: "1px solid var(--border-subtle)", background: "var(--bg-raised)" }}>
              Custom keyboard shortcut bindings coming soon. Export/import your bindings above.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
