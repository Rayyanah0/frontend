/**
 * DataExportPanel — Issue #66.
 *
 * Settings page section for exporting / importing all client-side user data.
 *
 * Export flow:
 *   1. Select categories to include.
 *   2. Optionally set a passphrase for AES-GCM encryption.
 *   3. Download as zenith-backup-<date>.json.
 *
 * Import flow:
 *   1. Drop or pick a .json file.
 *   2. If encrypted, enter passphrase.
 *   3. Preview: schema-validated summary of what's inside.
 *   4. Per-category merge strategy (replace / merge / skip).
 *   5. Confirm → applied to localStorage.
 */
"use client";

import { useCallback, useRef, useState } from "react";
import {
  buildBundle,
  downloadBundle,
  encryptBundle,
  decryptBundle,
  validateBundle,
  applyBundle,
  CATEGORY_LABELS,
  type CategoryKey,
  type BundleFile,
  type DataBundle,
  type EncryptedBundle,
  type MergeStrategy,
  type ImportOptions,
} from "../lib/dataExport";
import { useWalletStore } from "../lib/store/wallet";

const ALL_CATEGORIES: CategoryKey[] = [
  "savedStrategies",
  "workspaceLayouts",
  "hotkeys",
  "preferences",
];

const MERGE_OPTIONS: Array<{ value: MergeStrategy; label: string; desc: string }> = [
  { value: "replace", label: "Replace", desc: "Overwrite existing data" },
  { value: "merge",   label: "Merge",   desc: "Combine, prefer imported" },
  { value: "skip",    label: "Skip",    desc: "Keep existing data" },
];

export function DataExportPanel() {
  const address = useWalletStore(s => s.address);

  // ── Export state ──
  const [exportCats, setExportCats] = useState<Set<CategoryKey>>(new Set(ALL_CATEGORIES));
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportDone, setExportDone] = useState(false);

  // ── Import state ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawFile, setRawFile] = useState<BundleFile | null>(null);
  const [decryptedBundle, setDecryptedBundle] = useState<DataBundle | null>(null);
  const [importPassphrase, setImportPassphrase] = useState("");
  const [needsDecrypt, setNeedsDecrypt] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [mergeStrategies, setMergeStrategies] = useState<Partial<Record<CategoryKey, MergeStrategy>>>({
    savedStrategies: "merge",
    workspaceLayouts: "merge",
    hotkeys: "merge",
    preferences: "merge",
  });
  const [importResult, setImportResult] = useState<{ applied: CategoryKey[]; skipped: CategoryKey[] } | null>(null);

  // ── Export ────────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setExportLoading(true);
    setExportDone(false);
    try {
      const cats = Array.from(exportCats);
      const bundle = buildBundle(cats, address ?? null);
      let file: BundleFile = bundle;
      if (exportPassphrase) {
        file = await encryptBundle(bundle, exportPassphrase);
      }
      downloadBundle(file);
      setExportDone(true);
      setTimeout(() => setExportDone(false), 3000);
    } catch (err) {
      // unlikely — just surface it
      console.error("[DataExport]", err);
    } finally {
      setExportLoading(false);
    }
  }, [exportCats, exportPassphrase, address]);

  // ── Import: file read ─────────────────────────────────────────────────────────

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setDecryptedBundle(null);
    setRawFile(null);
    setNeedsDecrypt(false);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as BundleFile;
        if ("encrypted" in parsed && parsed.encrypted) {
          setRawFile(parsed);
          setNeedsDecrypt(true);
        } else {
          const { ok, errors, bundle } = validateBundle(parsed);
          if (!ok) {
            setImportError(errors.map(e => e.message).join("; "));
          } else {
            setDecryptedBundle(bundle!);
          }
          setRawFile(parsed);
        }
      } catch {
        setImportError("Could not parse file — make sure it is a valid Zenith backup JSON.");
      }
    };
    reader.readAsText(file);
  }, []);

  const handleDecrypt = useCallback(async () => {
    if (!rawFile || !("encrypted" in rawFile)) return;
    setImportError(null);
    try {
      const bundle = await decryptBundle(rawFile as EncryptedBundle, importPassphrase);
      const { ok, errors, bundle: validated } = validateBundle(bundle);
      if (!ok) {
        setImportError(errors.map(e => e.message).join("; "));
        return;
      }
      setDecryptedBundle(validated!);
      setNeedsDecrypt(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Decryption failed");
    }
  }, [rawFile, importPassphrase]);

  const handleImport = useCallback(() => {
    if (!decryptedBundle) return;
    const opts: ImportOptions = { categories: mergeStrategies };
    const result = applyBundle(decryptedBundle, opts);
    setImportResult(result);
    setDecryptedBundle(null);
    setRawFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [decryptedBundle, mergeStrategies]);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── Export section ── */}
      <section style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>Export Data</div>
          <div style={{ fontSize: 11, color: "var(--text-lo)", marginTop: 2 }}>
            Download your saved strategies, layouts, hotkeys, and preferences as a portable JSON bundle.
            Bearer tokens and wallet credentials are never included.
          </div>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Category checkboxes */}
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-lo)", marginBottom: 8 }}>
              Include
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ALL_CATEGORIES.map(cat => (
                <label key={cat} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={exportCats.has(cat)}
                    aria-label={`Include ${CATEGORY_LABELS[cat]}`}
                    onChange={e => {
                      const next = new Set(exportCats);
                      if (e.target.checked) next.add(cat); else next.delete(cat);
                      setExportCats(next);
                    }}
                    style={{ accentColor: "var(--brand)" }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-mid)" }}>{CATEGORY_LABELS[cat]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Optional passphrase */}
          <div>
            <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-lo)", display: "block", marginBottom: 4 }}>
              Passphrase (optional — enables AES-GCM encryption)
            </label>
            <input
              type="password"
              value={exportPassphrase}
              onChange={e => setExportPassphrase(e.target.value)}
              placeholder="Leave blank for unencrypted"
              aria-label="Export passphrase"
              style={{
                width: "100%", maxWidth: 320, padding: "6px 8px",
                background: "var(--bg-elevated)", border: "1px solid var(--border-default)",
                color: "var(--text-hi)", fontSize: 12, fontFamily: "var(--font-mono)", outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={handleExport}
              disabled={exportLoading || exportCats.size === 0}
              aria-busy={exportLoading}
              style={{
                padding: "8px 20px", border: "none",
                background: "var(--brand)", color: "var(--bg)",
                fontSize: 12, fontWeight: 700, cursor: exportCats.size === 0 ? "not-allowed" : "pointer",
                opacity: exportCats.size === 0 ? 0.5 : 1,
              }}
            >
              {exportLoading ? "Preparing…" : exportPassphrase ? "Export Encrypted" : "Export JSON"}
            </button>
            {exportDone && (
              <span style={{ fontSize: 11, color: "var(--call)" }}>✓ Downloaded</span>
            )}
          </div>
        </div>
      </section>

      {/* ── Import section ── */}
      <section style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>Import Data</div>
          <div style={{ fontSize: 11, color: "var(--text-lo)", marginTop: 2 }}>
            Restore from a Zenith backup file. Choose how to handle conflicts per category.
          </div>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>

          {/* File picker */}
          <div>
            <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-lo)", display: "block", marginBottom: 4 }}>
              Backup File
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              aria-label="Select backup file"
              style={{
                fontSize: 12, color: "var(--text-mid)",
                background: "var(--bg-elevated)", padding: "6px 8px",
                border: "1px solid var(--border-default)", width: "100%", maxWidth: 400,
              }}
            />
          </div>

          {/* Encrypted: passphrase entry */}
          {needsDecrypt && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--atm)" }}>
                This file is encrypted. Enter the passphrase to preview its contents.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="password"
                  value={importPassphrase}
                  onChange={e => setImportPassphrase(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleDecrypt(); }}
                  placeholder="Passphrase"
                  aria-label="Import decryption passphrase"
                  style={{
                    padding: "6px 8px", background: "var(--bg-elevated)",
                    border: "1px solid var(--border-default)", color: "var(--text-hi)",
                    fontSize: 12, fontFamily: "var(--font-mono)", outline: "none", flex: 1, maxWidth: 280,
                  }}
                />
                <button
                  onClick={handleDecrypt}
                  style={{
                    padding: "6px 14px", border: "1px solid var(--brand)",
                    background: "transparent", color: "var(--brand)",
                    cursor: "pointer", fontSize: 11,
                  }}
                >
                  Decrypt
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {importError && (
            <div style={{ padding: "8px 10px", background: "var(--put-dim)", color: "var(--put)", fontSize: 11 }}>
              {importError}
            </div>
          )}

          {/* Preview + merge options */}
          {decryptedBundle && (
            <div style={{ border: "1px solid var(--border-default)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 11, color: "var(--text-lo)" }}>
                Exported{" "}
                <span className="num" style={{ color: "var(--text-mid)" }}>
                  {new Date(decryptedBundle.exportedAt).toLocaleString()}
                </span>
                {decryptedBundle.walletAddressHint && (
                  <span> · wallet <span className="num" style={{ color: "var(--text-mid)" }}>
                    {decryptedBundle.walletAddressHint.slice(0, 8)}…
                  </span></span>
                )}
                {" "}· v{decryptedBundle.version}
              </div>

              {/* Per-category merge strategy */}
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-lo)", marginBottom: 6 }}>
                  Merge strategy per category
                </div>
                {decryptedBundle.categories.map(cat => (
                  <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: 12, color: "var(--text-mid)", minWidth: 160 }}>
                      {CATEGORY_LABELS[cat]}
                    </span>
                    <div style={{ display: "flex", gap: 2 }}>
                      {MERGE_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setMergeStrategies(prev => ({ ...prev, [cat]: opt.value }))}
                          aria-pressed={mergeStrategies[cat] === opt.value}
                          title={opt.desc}
                          style={{
                            padding: "2px 8px", border: "1px solid",
                            borderColor: mergeStrategies[cat] === opt.value ? "var(--brand)" : "var(--border-default)",
                            background: mergeStrategies[cat] === opt.value ? "var(--brand-dim)" : "transparent",
                            color: mergeStrategies[cat] === opt.value ? "var(--brand)" : "var(--text-lo)",
                            cursor: "pointer", fontSize: 10,
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleImport}
                style={{
                  padding: "8px 20px", border: "none",
                  background: "var(--brand)", color: "var(--bg)",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  alignSelf: "flex-start",
                }}
              >
                Import
              </button>
            </div>
          )}

          {/* Success */}
          {importResult && (
            <div style={{ padding: "10px 12px", background: "var(--call-dim)", border: "1px solid var(--call)", fontSize: 11 }}>
              <div style={{ fontWeight: 600, color: "var(--call)", marginBottom: 4 }}>Import complete</div>
              <div style={{ color: "var(--text-mid)" }}>
                Applied: {importResult.applied.map(c => CATEGORY_LABELS[c]).join(", ") || "none"}
              </div>
              {importResult.skipped.length > 0 && (
                <div style={{ color: "var(--text-lo)" }}>
                  Skipped: {importResult.skipped.map(c => CATEGORY_LABELS[c]).join(", ")}
                </div>
              )}
              <button
                onClick={() => setImportResult(null)}
                style={{ marginTop: 6, background: "none", border: "none", color: "var(--call)", cursor: "pointer", fontSize: 11 }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
