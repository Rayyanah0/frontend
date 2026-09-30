/**
 * src/lib/dataExport.ts — Issue #66.
 *
 * Export and import of all client-side user data as a versioned, optionally
 * encrypted JSON bundle.
 *
 * Covered categories:
 *   - savedStrategies: strategy builder custom leg sets stored in localStorage
 *   - workspaceLayouts: column/panel layout preferences
 *   - hotkeys: custom keyboard shortcut overrides
 *   - preferences: display preferences (theme, number format, etc.)
 *
 * Explicitly excluded:
 *   - Bearer token / wallet credentials (never exported)
 *   - Backend-persisted data (watchlist, alerts, positions — those live on the server)
 *
 * Encryption: optional passphrase → PBKDF2 → AES-GCM (WebCrypto).
 * Schema versioning: bumping BUNDLE_VERSION triggers migration on import.
 */

// ── Version & schema ─────────────────────────────────────────────────────────

export const BUNDLE_VERSION = 1;

export type CategoryKey = "savedStrategies" | "workspaceLayouts" | "hotkeys" | "preferences";

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  savedStrategies: "Saved Strategies",
  workspaceLayouts: "Workspace Layouts",
  hotkeys: "Hotkeys",
  preferences: "Preferences",
};

export interface SavedStrategy {
  id: string;
  name: string;
  legs: Array<{ side: "call" | "put"; action: "buy" | "sell"; strikeOffset: number }>;
  createdAt: string;
}

export interface WorkspaceLayout {
  id: string;
  name: string;
  columns: Record<string, boolean>;
  panelSizes: Record<string, number>;
}

export interface HotkeyBinding {
  action: string;
  key: string;
  modifiers: string[];
}

export interface Preferences {
  theme: "dark" | "light" | "system";
  numberFormat: "standard" | "compact";
  defaultExpiry: string;
  defaultUnderlying: string;
  showGreeksInChain: boolean;
}

export interface CategoryData {
  savedStrategies: SavedStrategy[];
  workspaceLayouts: WorkspaceLayout[];
  hotkeys: HotkeyBinding[];
  preferences: Partial<Preferences>;
}

export interface DataBundle {
  version: number;
  exportedAt: string;
  /** Wallet address that owns the data (for display only on import, NOT a credential) */
  walletAddressHint: string | null;
  /** Which categories are included in this bundle */
  categories: CategoryKey[];
  data: Partial<CategoryData>;
}

/** Wrapper when the bundle is encrypted */
export interface EncryptedBundle {
  encrypted: true;
  version: number;
  exportedAt: string;
  /** AES-GCM IV (base64) */
  iv: string;
  /** PBKDF2 salt (base64) */
  salt: string;
  /** AES-GCM ciphertext (base64) */
  ciphertext: string;
}

export type BundleFile = DataBundle | EncryptedBundle;

// ── Merge strategies ──────────────────────────────────────────────────────────

export type MergeStrategy = "replace" | "merge" | "skip";

export interface ImportOptions {
  categories: Partial<Record<CategoryKey, MergeStrategy>>;
  passphrase?: string;
}

// ── localStorage keys ─────────────────────────────────────────────────────────

export const STORAGE_KEYS: Record<CategoryKey, string> = {
  savedStrategies: "zenith-saved-strategies",
  workspaceLayouts: "zenith-workspace-layouts",
  hotkeys: "zenith-hotkeys",
  preferences: "zenith-preferences",
};

// ── Readers ───────────────────────────────────────────────────────────────────

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readAllCategories(): CategoryData {
  return {
    savedStrategies: readLocalJson<SavedStrategy[]>(STORAGE_KEYS.savedStrategies, []),
    workspaceLayouts: readLocalJson<WorkspaceLayout[]>(STORAGE_KEYS.workspaceLayouts, []),
    hotkeys: readLocalJson<HotkeyBinding[]>(STORAGE_KEYS.hotkeys, []),
    preferences: readLocalJson<Partial<Preferences>>(STORAGE_KEYS.preferences, {}),
  };
}

export function readCategory<K extends CategoryKey>(key: K): CategoryData[K] {
  return readLocalJson(STORAGE_KEYS[key], (key === "preferences" ? {} : []) as CategoryData[K]);
}

// ── Writers ───────────────────────────────────────────────────────────────────

function writeLocalJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Builds a DataBundle for the given categories.
 * Never includes the bearer token or wallet private key.
 */
export function buildBundle(
  categories: CategoryKey[],
  walletAddressHint: string | null = null
): DataBundle {
  const all = readAllCategories();
  const data: Partial<CategoryData> = {};
  for (const cat of categories) {
    (data as Record<string, unknown>)[cat] = all[cat];
  }
  return {
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    walletAddressHint,
    categories,
    data,
  };
}

// ── Encryption (WebCrypto AES-GCM + PBKDF2) ──────────────────────────────────

const PBKDF2_ITERATIONS = 200_000;
const PBKDF2_HASH = "SHA-256";

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

function unb64(s: string): Uint8Array {
  const decoded = atob(s);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

export async function encryptBundle(bundle: DataBundle, passphrase: string): Promise<EncryptedBundle> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, plaintext);
  return {
    encrypted: true,
    version: bundle.version,
    exportedAt: bundle.exportedAt,
    iv: b64(iv.buffer as ArrayBuffer),
    salt: b64(salt.buffer as ArrayBuffer),
    ciphertext: b64(cipherBuf),
  };
}

export async function decryptBundle(enc: EncryptedBundle, passphrase: string): Promise<DataBundle> {
  const salt = unb64(enc.salt);
  const iv   = unb64(enc.iv);
  const key  = await deriveKey(passphrase, salt);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, unb64(enc.ciphertext).buffer as ArrayBuffer);
  } catch {
    throw new Error("Decryption failed — wrong passphrase or corrupted file.");
  }
  const text = new TextDecoder().decode(plainBuf);
  return JSON.parse(text) as DataBundle;
}

// ── Download ──────────────────────────────────────────────────────────────────

export function downloadBundle(bundle: BundleFile, filename?: string): void {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename ?? `zenith-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Validation & migrations ───────────────────────────────────────────────────

export interface ValidationError { field: string; message: string; }

export function validateBundle(raw: unknown): { ok: boolean; errors: ValidationError[]; bundle?: DataBundle } {
  const errors: ValidationError[] = [];
  if (typeof raw !== "object" || raw === null) {
    errors.push({ field: "root", message: "File is not a valid JSON object" });
    return { ok: false, errors };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.version !== "number") errors.push({ field: "version", message: "Missing version number" });
  if (typeof obj.exportedAt !== "string") errors.push({ field: "exportedAt", message: "Missing exportedAt timestamp" });
  if (!Array.isArray(obj.categories)) errors.push({ field: "categories", message: "Missing categories array" });
  if (typeof obj.data !== "object" || obj.data === null) errors.push({ field: "data", message: "Missing data object" });

  if (errors.length) return { ok: false, errors };

  const bundle = migrateBundle(obj as unknown as DataBundle);
  return { ok: true, errors: [], bundle };
}

/** Apply version migrations — no-op for v1, extend as schema evolves. */
export function migrateBundle(bundle: DataBundle): DataBundle {
  let b = { ...bundle };
  // Future: if (b.version < 2) b = migrateV1toV2(b);
  b.version = BUNDLE_VERSION;
  return b;
}

// ── Import / merge ────────────────────────────────────────────────────────────

export interface ImportResult {
  applied: CategoryKey[];
  skipped: CategoryKey[];
}

/**
 * Applies an imported bundle to localStorage with the given per-category
 * merge strategy.
 *
 * replace: overwrite existing data
 * merge:   combine arrays (dedup by id) / merge preference objects
 * skip:    leave existing data untouched
 */
export function applyBundle(bundle: DataBundle, options: ImportOptions): ImportResult {
  const applied: CategoryKey[] = [];
  const skipped: CategoryKey[] = [];

  for (const cat of bundle.categories) {
    const strategy = options.categories[cat] ?? "skip";
    if (strategy === "skip") { skipped.push(cat); continue; }

    const incoming = (bundle.data as Record<string, unknown>)[cat];
    if (incoming === undefined) { skipped.push(cat); continue; }

    if (strategy === "replace") {
      writeLocalJson(STORAGE_KEYS[cat], incoming);
      applied.push(cat);
      continue;
    }

    // merge
    if (cat === "preferences") {
      const existing = readCategory("preferences");
      writeLocalJson(STORAGE_KEYS[cat], { ...existing, ...(incoming as object) });
      applied.push(cat);
    } else {
      // Array category — merge by id, prefer incoming on conflict
      const existing = readCategory(cat as Exclude<CategoryKey, "preferences">) as Array<{ id: string }>;
      const inc = incoming as Array<{ id: string }>;
      const existingIds = new Set(existing.map(x => x.id));
      const merged = [
        ...existing.filter(x => !inc.find(i => i.id === x.id)),
        ...inc,
      ];
      writeLocalJson(STORAGE_KEYS[cat], merged);
      applied.push(cat);
    }
  }

  return { applied, skipped };
}
