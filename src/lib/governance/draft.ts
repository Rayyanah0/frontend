/**
 * draft.ts — Issue #89: local draft persistence for the proposal wizard.
 *
 * A proposal can take a while to write, and losing it to a refresh is the
 * fastest way to make people give up on governance.  Drafts are kept in
 * localStorage under a single key.
 *
 * Everything is defensive: localStorage can throw (private mode, disabled
 * storage, quota), the stored JSON can be from an older shape, and `Date`/value
 * types do not round-trip.  A draft that cannot be read is treated as absent
 * rather than crashing the page.
 */

import { defaultValuesFor, findContract, findFunction, type ProposalAction } from "./actions";

export const DRAFT_STORAGE_KEY = "zenith_governance_proposal_draft";

/** Bump when the persisted shape changes incompatibly. */
export const DRAFT_VERSION = 1;

export interface ProposalDraft {
  version: number;
  title: string;
  summary: string;
  body: string;
  discussionUrl: string;
  actions: ProposalAction[];
  /** Epoch ms of the last autosave. */
  updatedAt: number;
}

export function emptyDraft(): ProposalDraft {
  return {
    version: DRAFT_VERSION,
    title: "",
    summary: "",
    body: "",
    discussionUrl: "",
    actions: [],
    updatedAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const TITLE_MIN = 8;
export const TITLE_MAX = 120;
export const SUMMARY_MAX = 280;
export const BODY_MIN = 40;

/** Fields of the metadata step that must be present to submit. */
export interface DraftValidation {
  ok: boolean;
  /** Field name → message. Empty when `ok`. */
  errors: Record<string, string>;
}

export function validateDraft(draft: ProposalDraft): DraftValidation {
  const errors: Record<string, string> = {};

  const title = draft.title.trim();
  if (title.length === 0) errors.title = "A title is required.";
  else if (title.length < TITLE_MIN) {
    errors.title = `Title must be at least ${TITLE_MIN} characters.`;
  } else if (title.length > TITLE_MAX) {
    errors.title = `Title must be at most ${TITLE_MAX} characters.`;
  }

  if (draft.summary.trim().length > SUMMARY_MAX) {
    errors.summary = `Summary must be at most ${SUMMARY_MAX} characters.`;
  }

  const body = draft.body.trim();
  if (body.length === 0) errors.body = "A description is required.";
  else if (body.length < BODY_MIN) {
    errors.body = `Description must be at least ${BODY_MIN} characters.`;
  }

  if (draft.discussionUrl.trim().length > 0) {
    const urlError = validateUrl(draft.discussionUrl);
    if (urlError) errors.discussionUrl = urlError;
  }

  if (draft.actions.length === 0) {
    errors.actions = "Add at least one action.";
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Only http/https — matches the delegate directory's link handling. */
export function validateUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Only http:// and https:// links are allowed.";
    }
    if (trimmed.length > 200) return "Link is too long (max 200 characters).";
    return null;
  } catch {
    return "Enter a valid URL.";
  }
}

// ---------------------------------------------------------------------------
// Action sanitisation
// ---------------------------------------------------------------------------

function sanitizeAction(raw: unknown, index: number): ProposalAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<ProposalAction>;

  if (typeof candidate.contractKey !== "string") return null;
  if (typeof candidate.functionName !== "string") return null;

  // Drop actions whose catalog entry no longer exists (e.g. the contract was
  // removed from the bindings since the draft was saved).
  const fn = findFunction(candidate.contractKey, candidate.functionName);
  if (!fn) return null;

  const values: Record<string, string> = {};
  if (typeof candidate.values === "object" && candidate.values !== null) {
    for (const param of fn.params) {
      const v = (candidate.values as Record<string, unknown>)[param.name];
      if (typeof v === "string") values[param.name] = v;
      else if (typeof v === "number" || typeof v === "bigint") values[param.name] = String(v);
      // Missing or wrong-typed keys fall back to the form generator default.
    }
  }

  return {
    id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : `a${index}`,
    contractKey: candidate.contractKey,
    functionName: candidate.functionName,
    values,
  };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export function serializeDraft(draft: ProposalDraft): string {
  return JSON.stringify({ ...draft, version: DRAFT_VERSION, updatedAt: Date.now() });
}

/**
 * Parse a stored draft.  Returns null for anything unreadable, malformed,
 * or written by an incompatible version.
 */
export function parseDraft(raw: string | null): ProposalDraft | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Partial<ProposalDraft>;

  if (candidate.version !== DRAFT_VERSION) return null;

  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.map(sanitizeAction).filter((a): a is ProposalAction => a !== null)
    : [];

  return {
    version: DRAFT_VERSION,
    title: typeof candidate.title === "string" ? candidate.title : "",
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    body: typeof candidate.body === "string" ? candidate.body : "",
    discussionUrl: typeof candidate.discussionUrl === "string" ? candidate.discussionUrl : "",
    actions,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
  };
}

// ---------------------------------------------------------------------------
// Storage access
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  // SSR-safe: localStorage does not exist during static rendering.
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveDraft(draft: ProposalDraft): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(DRAFT_STORAGE_KEY, serializeDraft(draft));
    return true;
  } catch {
    // Quota exceeded or storage disabled — autosave is best-effort.
    return false;
  }
}

export function loadDraft(): ProposalDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    return parseDraft(store.getItem(DRAFT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

let actionSeq = 0;

export function newActionId(): string {
  actionSeq += 1;
  return `action-${Date.now()}-${actionSeq}`;
}

export function makeAction(
  contractKey: string,
  functionName: string,
  values?: Record<string, string>
): ProposalAction {
  return {
    id: newActionId(),
    contractKey,
    functionName,
    values: values ?? defaultValuesFor(contractKey, functionName),
  };
}

/** Human summary used in the draft list, e.g. "Market · Put collateral ratio". */
export function shortActionLabel(action: ProposalAction): string {
  const contract = findContract(action.contractKey);
  const fn = findFunction(action.contractKey, action.functionName);
  if (!contract || !fn) return "Unknown action";
  return `${contract.label} · ${fn.label}`;
}
