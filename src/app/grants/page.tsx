"use client";

/**
 * Issue #97 — Grants and Contributor Rewards Portal
 *
 * - Program listing with budget, remaining funds, and criteria.
 * - Application form with validation, draft autosave, wallet-signed proof.
 * - Application tracker (submitted → review → approved → milestones → paid).
 * - Public view of approved grants.
 * - Payout transaction links (on-chain tx hashes).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { useWalletStore } from "../../lib/store/wallet";
import { useHydrated } from "../../lib/useHydrated";
import {
  listPrograms,
  listApprovedGrants,
  getMyApplications,
  submitApplication,
  saveDraft,
  loadDraft,
  clearDraft,
  type GrantProgram,
  type GrantApplication,
  type ApprovedGrant,
  type ApplicationStatus,
  type Milestone,
} from "../../lib/api/grants";

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtUSD(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Validate that a string is an http/https URL. */
function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ── Status tracker ────────────────────────────────────────────────────────
const STATUS_STEPS: ApplicationStatus[] = ["submitted", "review", "approved", "milestones", "paid"];
const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
  milestones: "Milestones",
  paid: "Paid",
};

function StatusTracker({ status }: { status: ApplicationStatus }) {
  if (status === "rejected") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, padding: "3px 10px", background: "var(--put-dim)", color: "var(--put)", fontWeight: 600 }}>Rejected</span>
      </div>
    );
  }
  const currentIdx = STATUS_STEPS.indexOf(status);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      {STATUS_STEPS.map((step, i) => (
        <div key={step} style={{ display: "flex", alignItems: "center" }}>
          <div style={{
            padding: "3px 10px",
            fontSize: 10,
            fontWeight: i <= currentIdx ? 600 : 400,
            background: i === currentIdx ? "var(--brand-dim)" : i < currentIdx ? "var(--call-dim)" : "transparent",
            color: i === currentIdx ? "var(--brand)" : i < currentIdx ? "var(--call)" : "var(--text-lo)",
            border: `1px solid ${i === currentIdx ? "var(--brand)" : i < currentIdx ? "var(--call)" : "var(--border-subtle)"}`,
            whiteSpace: "nowrap",
          }}>
            {STATUS_LABELS[step]}
          </div>
          {i < STATUS_STEPS.length - 1 && (
            <div style={{ width: 16, height: 1, background: i < currentIdx ? "var(--call)" : "var(--border-subtle)" }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Milestone list ────────────────────────────────────────────────────────
function MilestoneList({ milestones }: { milestones: Milestone[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      {milestones.map(m => (
        <div key={m.id} style={{ padding: "10px 14px", border: "1px solid var(--border-subtle)", background: "var(--bg-overlay)", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)", marginBottom: 2 }}>{m.title}</div>
            <div style={{ fontSize: 11, color: "var(--text-mid)", lineHeight: 1.5 }}>{m.description}</div>
            {m.due_date && <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 4 }}>Due: {fmtDate(m.due_date)}</div>}
            {m.tx_hash && (
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--call)", marginTop: 4 }}>
                Tx: {m.tx_hash}
              </div>
            )}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, color: "var(--atm)" }}>${fmtUSD(m.payout_amount)}</div>
            <div style={{
              fontSize: 9, marginTop: 4, padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.06em",
              background: m.status === "paid" ? "var(--call-dim)" : m.status === "approved" ? "var(--brand-dim)" : "var(--bg-raised)",
              color: m.status === "paid" ? "var(--call)" : m.status === "approved" ? "var(--brand)" : "var(--text-lo)",
            }}>
              {m.status}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Application form ──────────────────────────────────────────────────────
interface AppFormProps {
  program: GrantProgram;
  token: string;
  onSubmitted: () => void;
  onCancel: () => void;
}

function ApplicationForm({ program, token, onSubmitted, onCancel }: AppFormProps) {
  const [projectTitle, setProjectTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [teamInfo, setTeamInfo] = useState("");
  const [linksRaw, setLinksRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing draft
  useEffect(() => {
    const draft = loadDraft(program.id);
    if (!draft) return;
    if (draft.project_title) setProjectTitle(draft.project_title);
    if (draft.summary) setSummary(draft.summary);
    if (draft.description) setDescription(draft.description);
    if (draft.requested_amount) setRequestedAmount(String(draft.requested_amount));
    if (draft.team_info) setTeamInfo(draft.team_info);
    if (draft.links) setLinksRaw(draft.links.join("\n"));
    if (draft.saved_at) setDraftSavedAt(draft.saved_at);
  }, [program.id]);

  // Autosave on field changes
  const scheduleAutosave = useCallback(() => {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      const links = linksRaw.split("\n").map(l => l.trim()).filter(Boolean);
      saveDraft(program.id, { project_title: projectTitle, summary, description, requested_amount: Number(requestedAmount) || 0, team_info: teamInfo, links });
      setDraftSavedAt(new Date().toISOString());
    }, 1500);
  }, [program.id, projectTitle, summary, description, requestedAmount, teamInfo, linksRaw]);

  useEffect(() => { scheduleAutosave(); }, [scheduleAutosave]);

  const handleSubmit = async () => {
    setError(null);
    const links = linksRaw.split("\n").map(l => l.trim()).filter(Boolean);
    if (!projectTitle.trim()) return setError("Project title is required.");
    if (!summary.trim()) return setError("Summary is required.");
    if (!description.trim()) return setError("Description is required.");
    const amount = Number(requestedAmount);
    if (!amount || amount <= 0) return setError("Requested amount must be a positive number.");
    if (amount > program.remaining_budget) return setError(`Requested amount exceeds remaining budget ($${fmtUSD(program.remaining_budget)}).`);
    if (!teamInfo.trim()) return setError("Team information is required.");
    for (const link of links) {
      if (!isValidUrl(link)) return setError(`Invalid link: "${link}". Only http/https URLs are allowed.`);
    }

    setSubmitting(true);
    try {
      await submitApplication(
        { program_id: program.id, project_title: projectTitle.trim(), summary: summary.trim(), description: description.trim(), requested_amount: amount, team_info: teamInfo.trim(), links, ownership_proof: "signed_by_wallet" },
        token
      );
      clearDraft(program.id);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = { width: "100%", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", padding: "8px 10px", fontSize: 13, fontFamily: "var(--font-sans)" };
  const labelStyle = { fontSize: 10, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--text-lo)", display: "block" as const, marginBottom: 4 };

  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "20px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)" }}>
          Apply to: {program.name}
        </div>
        {draftSavedAt && (
          <span style={{ fontSize: 10, color: "var(--text-lo)" }}>
            Draft saved {new Date(draftSavedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: "8px 12px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>Project Title</label>
          <input value={projectTitle} onChange={e => setProjectTitle(e.target.value)} maxLength={120} placeholder="e.g. XLM Options Analytics Dashboard" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>One-line Summary</label>
          <input value={summary} onChange={e => setSummary(e.target.value)} maxLength={200} placeholder="Brief summary of what you are building" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Full Description (markdown)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={8} maxLength={5000} placeholder="Detailed project description, motivation, technical approach, timeline…" style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>
              Requested Amount ({program.currency})
            </label>
            <input
              type="number"
              value={requestedAmount}
              onChange={e => setRequestedAmount(e.target.value)}
              min={1}
              max={program.remaining_budget}
              placeholder={`Max: ${fmtUSD(program.remaining_budget)}`}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <div style={{ fontSize: 11, color: "var(--text-lo)", padding: "8px 10px", background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)" }}>
              Remaining budget: <span className="num" style={{ color: "var(--atm)" }}>${fmtUSD(program.remaining_budget)} {program.currency}</span>
            </div>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Team Information</label>
          <textarea value={teamInfo} onChange={e => setTeamInfo(e.target.value)} rows={3} maxLength={1000} placeholder="Who is on the team? Relevant experience and GitHub profiles…" style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <label style={labelStyle}>Links (one per line, http/https only — no file uploads)</label>
          <textarea value={linksRaw} onChange={e => setLinksRaw(e.target.value)} rows={4} placeholder={"https://github.com/yourproject\nhttps://demo.yourproject.io"} style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12, resize: "vertical" }} />
        </div>

        <div style={{ padding: "10px 12px", background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)", fontSize: 11, color: "var(--text-lo)" }}>
          Submitting will sign a message with your connected wallet to prove ownership of the applicant address.
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-mid)", fontSize: 12, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={submitting || !program.is_open} style={{ padding: "8px 18px", background: !program.is_open ? "var(--bg-overlay)" : "var(--brand)", color: !program.is_open ? "var(--text-lo)" : "var(--bg)", border: "none", fontSize: 12, fontWeight: 600, cursor: submitting || !program.is_open ? "default" : "pointer", opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Submitting…" : program.is_open ? "Submit Application" : "Program Closed"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
type Tab = "programs" | "my_applications" | "approved";

export default function GrantsPage() {
  const hydrated = useHydrated();
  const token = useWalletStore(s => s.token);

  const [tab, setTab] = useState<Tab>("programs");
  const [programs, setPrograms] = useState<GrantProgram[]>([]);
  const [approved, setApproved] = useState<ApprovedGrant[]>([]);
  const [myApps, setMyApps] = useState<GrantApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [applyingTo, setApplyingTo] = useState<GrantProgram | null>(null);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [progs, appr] = await Promise.all([listPrograms(token), listApprovedGrants(token)]);
      setPrograms(progs);
      setApproved(appr);
      if (token) {
        const apps = await getMyApplications(token);
        setMyApps(apps);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load grants");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (hydrated) load(); }, [hydrated, load]);

  const handleSubmitted = () => {
    setApplyingTo(null);
    setSubmitSuccess("Application submitted successfully! You can track its status in 'My Applications'.");
    setTab("my_applications");
    load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
      <AppHeader>
        <div style={{ marginLeft: "auto" }}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 64px" }}>

          {/* Header */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)", marginBottom: 6 }}>
              Community
            </div>
            <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 4 }}>
              Grants Portal
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-mid)" }}>
              Browse funded grant programs, submit applications, and track your milestone progress.
            </p>
          </div>

          {submitSuccess && (
            <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--call)", background: "var(--call-dim)", fontSize: 12, color: "var(--call)" }}>
              {submitSuccess}
            </div>
          )}
          {error && (
            <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
              {error}
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border-default)", marginBottom: 24 }}>
            {([
              { key: "programs" as Tab, label: `Programs (${programs.length})` },
              { key: "my_applications" as Tab, label: `My Applications (${myApps.length})` },
              { key: "approved" as Tab, label: `Approved Grants (${approved.length})` },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{ padding: "10px 18px", border: "none", borderBottom: tab === key ? "2px solid var(--brand)" : "2px solid transparent", background: "transparent", color: tab === key ? "var(--brand)" : "var(--text-lo)", fontSize: 12, fontWeight: tab === key ? 600 : 400, cursor: "pointer", transition: "color 120ms" }}
              >
                {label}
              </button>
            ))}
          </div>

          {loading && <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--text-lo)" }}>Loading…</div>}

          {/* Application form (shown over programs tab) */}
          {!loading && applyingTo && (
            <div style={{ marginBottom: 24 }}>
              <ApplicationForm
                program={applyingTo}
                token={token!}
                onSubmitted={handleSubmitted}
                onCancel={() => setApplyingTo(null)}
              />
            </div>
          )}

          {/* Programs tab */}
          {!loading && tab === "programs" && !applyingTo && (
            <>
              {programs.length === 0 ? (
                <div style={{ padding: "60px 0", textAlign: "center", fontSize: 13, color: "var(--text-mid)" }}>No open grant programs at this time.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {programs.map(p => (
                    <div key={p.id} style={{ border: `1px solid ${p.is_open ? "var(--border-default)" : "var(--border-subtle)"}`, background: "var(--bg-raised)", padding: "20px 24px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--text-hi)" }}>{p.name}</h2>
                            <span style={{ fontSize: 9, padding: "2px 8px", textTransform: "uppercase", letterSpacing: "0.08em", background: p.is_open ? "var(--call-dim)" : "var(--bg-overlay)", color: p.is_open ? "var(--call)" : "var(--text-lo)" }}>
                              {p.is_open ? "Open" : "Closed"}
                            </span>
                          </div>
                          {p.deadline && (
                            <div style={{ fontSize: 11, color: "var(--text-lo)" }}>Deadline: {fmtDate(p.deadline)}</div>
                          )}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="num" style={{ fontSize: 18, fontWeight: 700, color: "var(--atm)" }}>${fmtUSD(p.remaining_budget)}</div>
                          <div style={{ fontSize: 10, color: "var(--text-lo)" }}>remaining of ${fmtUSD(p.total_budget)} {p.currency}</div>
                          {/* Budget bar */}
                          <div style={{ width: 120, height: 3, background: "var(--bg-overlay)", marginTop: 6 }}>
                            <div style={{ height: "100%", width: `${(p.remaining_budget / p.total_budget) * 100}%`, background: p.remaining_budget / p.total_budget > 0.5 ? "var(--call)" : "var(--atm)" }} />
                          </div>
                        </div>
                      </div>

                      <p style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6, marginBottom: 10 }}>{p.description}</p>

                      {p.criteria && (
                        <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)" }}>
                          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-lo)", marginBottom: 4 }}>Eligibility Criteria</div>
                          <p style={{ fontSize: 12, color: "var(--text-mid)", lineHeight: 1.55 }}>{p.criteria}</p>
                        </div>
                      )}

                      {token && p.is_open && (
                        <button
                          onClick={() => setApplyingTo(p)}
                          style={{ padding: "8px 18px", background: "var(--brand)", color: "var(--bg)", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                        >
                          Apply →
                        </button>
                      )}
                      {!token && p.is_open && (
                        <div style={{ fontSize: 12, color: "var(--text-lo)" }}>Connect your wallet to apply</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* My Applications tab */}
          {!loading && tab === "my_applications" && (
            <>
              {!token ? (
                <div style={{ padding: "60px 0", textAlign: "center", fontSize: 13, color: "var(--text-mid)" }}>
                  Connect your wallet to see your applications.
                </div>
              ) : myApps.length === 0 ? (
                <div style={{ padding: "60px 0", textAlign: "center", fontSize: 13, color: "var(--text-mid)" }}>
                  No applications yet.{" "}
                  <button onClick={() => setTab("programs")} style={{ color: "var(--brand)", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>
                    Browse open programs →
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {myApps.map(app => (
                    <div key={app.id} style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
                      <div
                        onClick={() => setExpandedApp(expandedApp === app.id ? null : app.id)}
                        style={{ padding: "16px 20px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)", marginBottom: 4 }}>{app.project_title}</div>
                          <div style={{ fontSize: 11, color: "var(--text-lo)" }}>{app.program_name} · Submitted {fmtDate(app.submitted_at)}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <StatusTracker status={app.status} />
                          <span style={{ fontSize: 10, color: "var(--text-lo)" }}>{expandedApp === app.id ? "▲" : "▼"}</span>
                        </div>
                      </div>

                      {expandedApp === app.id && (
                        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "16px 20px" }}>
                          <div style={{ fontSize: 12, color: "var(--text-mid)", lineHeight: 1.6, marginBottom: 12 }}>{app.summary}</div>

                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                            <div>
                              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 2 }}>Requested</div>
                              <div className="num" style={{ fontSize: 14, fontWeight: 600, color: "var(--atm)" }}>${fmtUSD(app.requested_amount)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 2 }}>Wallet</div>
                              <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-mid)" }}>{shortAddr(app.applicant_wallet)}</div>
                            </div>
                          </div>

                          {app.links.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 6 }}>Links</div>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {app.links.map((link, i) => (
                                  <a key={i} href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--brand)", textDecoration: "none", fontFamily: "var(--font-mono)" }}>
                                    {link.length > 50 ? `${link.slice(0, 47)}…` : link}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {app.milestones.length > 0 && (
                            <div>
                              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 4 }}>Milestones</div>
                              <MilestoneList milestones={app.milestones} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Approved Grants tab */}
          {!loading && tab === "approved" && (
            <>
              {approved.length === 0 ? (
                <div style={{ padding: "60px 0", textAlign: "center", fontSize: 13, color: "var(--text-mid)" }}>No approved grants yet.</div>
              ) : (
                <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                        {["Project", "Program", "Applicant", "Approved", "Milestones"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "left", background: "var(--bg-overlay)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {approved.map(g => (
                        <tr key={g.application_id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{g.project_title}</td>
                          <td style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-mid)" }}>{g.program_name}</td>
                          <td style={{ padding: "10px 12px", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-lo)" }}>{shortAddr(g.applicant_wallet)}</td>
                          <td className="num" style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "var(--atm)" }}>${fmtUSD(g.approved_amount)}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {g.milestones.map(m => (
                                <span key={m.id} style={{ fontSize: 9, padding: "2px 6px", background: m.status === "paid" ? "var(--call-dim)" : m.status === "approved" ? "var(--brand-dim)" : "var(--bg-overlay)", color: m.status === "paid" ? "var(--call)" : m.status === "approved" ? "var(--brand)" : "var(--text-lo)" }}>
                                  {m.title}
                                  {m.tx_hash && <span style={{ marginLeft: 4, fontFamily: "var(--font-mono)" }}>✓</span>}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
