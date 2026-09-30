"use client";
import { useState, useEffect, useCallback } from "react";
import { AppHeader } from "../../components/AppHeader";
import { isOfficialOrigin, getAllowedOrigins } from "../../lib/auth/challenge";

const PHRASE_KEY_PREFIX = "zenith.antiphishing.phrase.";

function getPhrase(address: string): string {
  if (!address) return "";
  try { return localStorage.getItem(PHRASE_KEY_PREFIX + address) ?? ""; } catch { return ""; }
}

function savePhrase(address: string, phrase: string): void {
  if (!address) return;
  try {
    if (phrase) localStorage.setItem(PHRASE_KEY_PREFIX + address, phrase);
    else localStorage.removeItem(PHRASE_KEY_PREFIX + address);
  } catch { /* storage unavailable */ }
}

function VerificationBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px",
      border: `1px solid ${ok ? "var(--call)" : "var(--put)"}`,
      background: ok ? "var(--call-dim, rgba(0,200,100,0.08))" : "var(--put-dim)",
      fontSize: 12,
    }}>
      <span style={{ fontSize: 16, color: ok ? "var(--call)" : "var(--put)" }} aria-hidden="true">
        {ok ? "✓" : "✗"}
      </span>
      <span style={{ color: ok ? "var(--call)" : "var(--put)", fontWeight: 600 }}>
        {ok ? "Verified" : "Warning"}
      </span>
      <span style={{ color: "var(--text-mid)" }}>{label}</span>
    </div>
  );
}

export default function SecurityPage() {
  const [origin, setOrigin] = useState("");
  const [official, setOfficial] = useState(true);
  const [walletAddress, setWalletAddress] = useState("");
  const [phrase, setPhrase] = useState("");
  const [phraseInput, setPhraseInput] = useState("");
  const [phraseSaved, setPhraseSaved] = useState(false);
  const [showPhraseForm, setShowPhraseForm] = useState(false);
  const allowedOrigins = getAllowedOrigins();

  useEffect(() => {
    const o = window.location.origin;
    setOrigin(o);
    setOfficial(isOfficialOrigin(o));

    // Try to read wallet address from zustand persist store
    try {
      const raw = localStorage.getItem("zenith-wallet");
      if (raw) {
        const parsed = JSON.parse(raw);
        const addr = parsed?.state?.address ?? parsed?.address ?? "";
        if (addr) {
          setWalletAddress(addr);
          const saved = getPhrase(addr);
          setPhrase(saved);
          setPhraseInput(saved);
        }
      }
    } catch { /* no wallet */ }
  }, []);

  const savePhraseFn = useCallback(() => {
    if (!walletAddress) return;
    savePhrase(walletAddress, phraseInput.trim());
    setPhrase(phraseInput.trim());
    setPhraseSaved(true);
    setShowPhraseForm(false);
    setTimeout(() => setPhraseSaved(false), 3000);
  }, [walletAddress, phraseInput]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <AppHeader />
      <main
        id="main-content"
        style={{ maxWidth: 740, margin: "0 auto", padding: "32px 20px" }}
        aria-labelledby="security-heading"
      >
        {/* Skip to content target */}
        <h1
          id="security-heading"
          style={{ fontSize: 18, fontWeight: 700, color: "var(--text-hi)", marginBottom: 4 }}
        >
          Security Center
        </h1>
        <p style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 28 }}>
          Verify you are on the official Zenith app, set up your anti-phishing phrase,
          and learn how to stay safe.
        </p>

        {/* === Origin verification === */}
        <section aria-labelledby="origin-section-heading">
          <h2
            id="origin-section-heading"
            style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Domain Verification
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            <VerificationBadge
              ok={official}
              label={official
                ? `${origin} is an official Zenith domain.`
                : `${origin} is NOT an official Zenith domain. You may be on a phishing site.`
              }
            />
          </div>
          <div
            style={{
              padding: 12,
              border: "1px solid var(--border-default)",
              background: "var(--bg-elevated)",
              fontSize: 11,
              color: "var(--text-mid)",
              lineHeight: 1.7,
              marginBottom: 8,
            }}
          >
            <strong style={{ color: "var(--text-hi)" }}>Official Zenith domains:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
              {allowedOrigins.map(o => (
                <li key={o}>
                  <a href={o} style={{ color: "var(--brand)", textDecoration: "none" }} rel="noopener noreferrer">
                    {o}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-lo)", marginBottom: 24 }}>
            Always check the browser address bar before connecting your wallet or signing any transaction.
            Bookmark the official URL and access Zenith only from that bookmark.
          </p>
        </section>

        {/* === Anti-phishing phrase === */}
        <section aria-labelledby="phrase-section-heading" style={{ marginBottom: 32 }}>
          <h2
            id="phrase-section-heading"
            style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Anti-Phishing Phrase
          </h2>
          <p style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 12, lineHeight: 1.6 }}>
            Set a secret phrase that only you know. The Zenith app will always show it at the
            top of your session. If you ever visit a page that claims to be Zenith but{" "}
            <strong style={{ color: "var(--text-hi)" }}>does not show your phrase</strong>, leave immediately.
          </p>

          {walletAddress ? (
            <>
              {phrase ? (
                <div style={{
                  padding: "12px 16px",
                  border: "1px solid var(--call)",
                  background: "var(--call-dim, rgba(0,200,100,0.06))",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                  marginBottom: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--call)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                      Your anti-phishing phrase
                    </div>
                    <div
                      style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--font-serif)", letterSpacing: "0.04em" }}
                      aria-label={`Anti-phishing phrase: ${phrase}`}
                    >
                      {phrase}
                    </div>
                  </div>
                  <button
                    onClick={() => { setPhraseInput(phrase); setShowPhraseForm(true); }}
                    style={{
                      fontSize: 11, padding: "4px 12px", background: "none",
                      border: "1px solid var(--border-default)", color: "var(--text-mid)", cursor: "pointer",
                      outline: "none", flexShrink: 0,
                    }}
                    onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
                    onBlur={e => { e.currentTarget.style.outline = "none"; }}
                    aria-label="Edit anti-phishing phrase"
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <div style={{ marginBottom: 12 }}>
                  <button
                    onClick={() => setShowPhraseForm(true)}
                    style={{
                      fontSize: 12, padding: "7px 18px",
                      background: "var(--brand)", color: "var(--bg)",
                      border: "none", cursor: "pointer", fontWeight: 700, outline: "none",
                    }}
                    onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
                    onBlur={e => { e.currentTarget.style.outline = "none"; }}
                  >
                    Set anti-phishing phrase
                  </button>
                </div>
              )}

              {showPhraseForm && (
                <div style={{
                  padding: 14, border: "1px solid var(--brand)",
                  background: "var(--bg-elevated)", marginBottom: 12,
                }}>
                  <label
                    htmlFor="antiphishing-input"
                    style={{ fontSize: 11, color: "var(--text-mid)", display: "block", marginBottom: 6 }}
                  >
                    Enter a memorable phrase (stored in your browser only):
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      id="antiphishing-input"
                      type="text"
                      value={phraseInput}
                      onChange={e => setPhraseInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") savePhraseFn(); }}
                      placeholder="e.g. golden sunrise"
                      maxLength={64}
                      style={{
                        flex: 1, padding: "6px 10px",
                        background: "var(--bg-overlay)",
                        border: "1px solid var(--border-default)",
                        color: "var(--text-hi)", fontSize: 13,
                        outline: "none",
                      }}
                      onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
                      onBlur={e => { e.currentTarget.style.outline = "none"; }}
                    />
                    <button
                      onClick={savePhraseFn}
                      style={{
                        padding: "6px 16px", background: "var(--brand)", color: "var(--bg)",
                        border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", outline: "none",
                      }}
                      onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
                      onBlur={e => { e.currentTarget.style.outline = "none"; }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setPhraseInput(phrase); setShowPhraseForm(false); }}
                      style={{
                        padding: "6px 12px", background: "none",
                        border: "1px solid var(--border-default)", color: "var(--text-lo)",
                        fontSize: 12, cursor: "pointer", outline: "none",
                      }}
                      onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
                      onBlur={e => { e.currentTarget.style.outline = "none"; }}
                    >
                      Cancel
                    </button>
                  </div>
                  {phraseSaved && (
                    <p role="status" style={{ fontSize: 11, color: "var(--call)", marginTop: 6 }}>
                      ✓ Phrase saved.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p style={{ fontSize: 12, color: "var(--text-lo)", fontStyle: "italic" }}>
              Connect your wallet to set an anti-phishing phrase.
            </p>
          )}
        </section>

        {/* === Best practices === */}
        <section aria-labelledby="practices-heading" style={{ marginBottom: 32 }}>
          <h2
            id="practices-heading"
            style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Security Best Practices
          </h2>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-mid)", lineHeight: 2, display: "flex", flexDirection: "column", gap: 2 }}>
            <li>Bookmark <strong style={{ color: "var(--brand)" }}>https://app.zenith.trade</strong> and only use that bookmark.</li>
            <li>Always verify your anti-phishing phrase is shown before connecting your wallet.</li>
            <li>Never share your seed phrase or private key with anyone or any website.</li>
            <li>Check the browser URL bar — phishing sites often use lookalike domains (zenïth.trade, zenith-app.com).</li>
            <li>Review the full transaction details in Freighter before signing any transaction.</li>
            <li>Enable the Freighter browser extension&apos;s built-in phishing detection.</li>
            <li>Verify contract addresses against the official registry before interacting.</li>
          </ol>
        </section>

        {/* === Contract registry === */}
        <section aria-labelledby="contracts-heading">
          <h2
            id="contracts-heading"
            style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Official Contract Registry
          </h2>
          <p style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 10, lineHeight: 1.6 }}>
            Always verify contract addresses from multiple sources before signing. Official sources:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "Stellar Expert (Testnet)", href: "https://stellar.expert/explorer/testnet" },
              { label: "Stellar Expert (Mainnet)", href: "https://stellar.expert/explorer/public" },
              { label: "Zenith GitHub (contract addresses)", href: "https://github.com/Zenith-options" },
              { label: "Stellar Developers Docs", href: "https://developers.stellar.org/docs" },
            ].map(({ label, href }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 12, color: "var(--brand)", textDecoration: "none",
                  padding: "6px 10px",
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-elevated)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
                onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
                onBlur={e => { e.currentTarget.style.outline = "none"; }}
              >
                {label}
                <span aria-hidden="true" style={{ color: "var(--text-lo)", fontSize: 10 }}>↗</span>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
