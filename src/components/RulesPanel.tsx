"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  evaluateRules,
  loadRules,
  saveRule,
  deleteRule,
  makeRuleId,
  dryRunRule,
  RULE_TEMPLATES,
  CONDITION_LABELS,
  ACTION_LABELS,
  type ManagementRule,
  type RuleAlert,
  type RuleConditionType,
  type RuleAction,
  type MarkedPosition,
} from "../lib/managementRules";
import type { Position } from "../lib/api/types";

interface Props {
  /** Live-marked positions (with P&L and current premium calculated). */
  positions: MarkedPosition[];
  walletAddress: string;
  /** Called when the user confirms execution of a triggered rule. */
  onExecuteRule: (alert: RuleAlert) => Promise<void>;
}

const CONDITION_THRESHOLD_LABELS: Record<RuleConditionType, string> = {
  pnl_pct_profit:      "Profit target (%)",
  pnl_pct_loss:        "Loss limit (% of credit)",
  dte_otm:             "Days to expiry",
  dte_any:             "Days to expiry",
  pnl_absolute_profit: "Profit target ($)",
  pnl_absolute_loss:   "Loss limit ($)",
};

function formatRule(rule: ManagementRule): string {
  return `${CONDITION_LABELS[rule.condition].replace("X", String(rule.threshold)).replace("N", String(rule.threshold))} → ${ACTION_LABELS[rule.action]}`;
}

// Simple mock price history for dry-run demo (used when real history unavailable)
function mockPriceHistory(pos: Position): Array<{ date: string; premium: number }> {
  const result: Array<{ date: string; premium: number }> = [];
  const today = new Date();
  let premium = pos.entry_premium;
  // Simulate 30 days of price history going backwards
  for (let i = 30; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    // Random walk with mean reversion toward 0 for short premium
    premium = Math.max(0.0001, premium * (0.98 + (Math.random() - 0.55) * 0.08));
    result.push({ date: d.toISOString().slice(0, 10), premium });
  }
  return result;
}

export function RulesPanel({ positions, walletAddress, onExecuteRule }: Props) {
  const [rules, setRules] = useState<ManagementRule[]>([]);
  const [alerts, setAlerts] = useState<RuleAlert[]>([]);
  const [activeTab, setActiveTab] = useState<"rules" | "queue">("rules");
  const [showEditor, setShowEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<ManagementRule | null>(null);
  const [dryRunRuleId, setDryRunRuleId] = useState<string | null>(null);
  const [dryRunPosId, setDryRunPosId] = useState<string | null>(null);
  const [executing, setExecuting] = useState<string | null>(null); // alert triggeredAt key

  // Load rules from localStorage on mount
  useEffect(() => {
    if (!walletAddress) return;
    setRules(loadRules(walletAddress));
  }, [walletAddress]);

  // Re-evaluate rules whenever positions or rules change
  useEffect(() => {
    setAlerts(evaluateRules(rules, positions));
  }, [rules, positions]);

  const refreshRules = useCallback(() => {
    setRules(loadRules(walletAddress));
  }, [walletAddress]);

  // Editor state
  const [editorName, setEditorName] = useState("");
  const [editorCondition, setEditorCondition] = useState<RuleConditionType>("pnl_pct_profit");
  const [editorThreshold, setEditorThreshold] = useState("50");
  const [editorAction, setEditorAction] = useState<RuleAction>("close");
  const [editorTarget, setEditorTarget] = useState<"all" | string>("all");

  const openEditor = (rule?: ManagementRule) => {
    if (rule) {
      setEditingRule(rule);
      setEditorName(rule.name);
      setEditorCondition(rule.condition);
      setEditorThreshold(String(rule.threshold));
      setEditorAction(rule.action);
      setEditorTarget(rule.targetPositionId ?? rule.targetStrategyId ?? "all");
    } else {
      setEditingRule(null);
      setEditorName("");
      setEditorCondition("pnl_pct_profit");
      setEditorThreshold("50");
      setEditorAction("close");
      setEditorTarget("all");
    }
    setShowEditor(true);
  };

  const applyTemplate = (tplId: string) => {
    const tpl = RULE_TEMPLATES.find(t => t.id === tplId);
    if (!tpl) return;
    setEditorName(tpl.name);
    setEditorCondition(tpl.condition);
    setEditorThreshold(String(tpl.threshold));
    setEditorAction(tpl.action);
  };

  const saveEditorRule = () => {
    const threshold = parseFloat(editorThreshold);
    if (isNaN(threshold)) return;
    const rule: ManagementRule = {
      id: editingRule?.id ?? makeRuleId(),
      name: editorName || CONDITION_LABELS[editorCondition],
      condition: editorCondition,
      threshold,
      action: editorAction,
      targetPositionId: editorTarget !== "all" && !editorTarget.startsWith("strat_") ? editorTarget : null,
      targetStrategyId: editorTarget.startsWith("strat_") ? editorTarget.replace("strat_", "") : null,
      enabled: true,
      createdAt: editingRule?.createdAt ?? new Date().toISOString(),
      walletAddress,
    };
    saveRule(rule);
    refreshRules();
    setShowEditor(false);
  };

  const toggleRule = (rule: ManagementRule) => {
    saveRule({ ...rule, enabled: !rule.enabled });
    refreshRules();
  };

  const removeRule = (id: string) => {
    deleteRule(id);
    refreshRules();
  };

  // Dry-run result
  const dryRunResult = useMemo(() => {
    if (!dryRunRuleId || !dryRunPosId) return null;
    const rule = rules.find(r => r.id === dryRunRuleId);
    const pos = positions.find(p => p.id === dryRunPosId);
    if (!rule || !pos) return null;
    const history = mockPriceHistory(pos);
    return dryRunRule(rule, pos, history);
  }, [dryRunRuleId, dryRunPosId, rules, positions]);

  const handleExecute = async (alert: RuleAlert) => {
    const key = alert.triggeredAt + alert.positionId;
    setExecuting(key);
    try {
      await onExecuteRule(alert);
      setAlerts(prev => prev.filter(a => a.triggeredAt + a.positionId !== key));
    } finally {
      setExecuting(null);
    }
  };

  const dismissAlert = (alert: RuleAlert) => {
    const key = alert.triggeredAt + alert.positionId;
    setAlerts(prev => prev.filter(a => a.triggeredAt + a.positionId !== key));
  };

  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {(["rules", "queue"] as const).map(tab => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "4px 12px", border: "none", cursor: "pointer", fontSize: 12, textTransform: "capitalize",
                background: activeTab === tab ? "var(--bg-elevated)" : "transparent",
                color: activeTab === tab ? "var(--text-hi)" : "var(--text-lo)",
                borderBottom: activeTab === tab ? "2px solid var(--brand)" : "2px solid transparent",
                marginBottom: -1, fontWeight: activeTab === tab ? 600 : 400,
              }}
            >
              {tab === "queue" ? `Action Queue${alerts.length > 0 ? ` (${alerts.length})` : ""}` : "Management Rules"}
            </button>
          ))}
        </div>
        {activeTab === "rules" && (
          <button onClick={() => openEditor()} style={{
            fontSize: 11, padding: "4px 12px", background: "var(--brand)",
            color: "var(--bg)", border: "none", cursor: "pointer", fontWeight: 600,
          }}>
            + New Rule
          </button>
        )}
      </div>

      {/* Rules tab */}
      {activeTab === "rules" && (
        <div style={{ padding: 16 }}>
          {rules.length === 0 && !showEditor && (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ fontSize: 13, color: "var(--text-lo)", marginBottom: 10 }}>
                No rules configured. Create a rule to automatically monitor your positions.
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                {RULE_TEMPLATES.slice(0, 3).map(tpl => (
                  <button key={tpl.id} onClick={() => { applyTemplate(tpl.id); setShowEditor(true); }} style={{
                    fontSize: 11, padding: "5px 12px", background: "var(--bg-elevated)",
                    border: "1px solid var(--border-default)", color: "var(--text-mid)", cursor: "pointer",
                  }}>
                    {tpl.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rule list */}
          {rules.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: showEditor ? 12 : 0 }}>
              {rules.map(rule => {
                const ruleAlerts = alerts.filter(a => a.rule.id === rule.id);
                return (
                  <div key={rule.id} style={{
                    padding: "10px 12px", border: `1px solid ${ruleAlerts.length > 0 ? "var(--atm)" : "var(--border-subtle)"}`,
                    background: ruleAlerts.length > 0 ? "var(--atm-dim)" : "var(--bg-elevated)",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                    opacity: rule.enabled ? 1 : 0.5,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{rule.name}</span>
                        {ruleAlerts.length > 0 && (
                          <span style={{
                            fontSize: 9, padding: "1px 6px", background: "var(--atm)", color: "var(--bg)",
                            textTransform: "uppercase", letterSpacing: "0.06em",
                          }}>
                            {ruleAlerts.length} triggered
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 2 }}>{formatRule(rule)}</div>
                      {(rule.targetPositionId ?? rule.targetStrategyId) && (
                        <div style={{ fontSize: 9, color: "var(--text-lo)", marginTop: 1 }}>
                          Target: {rule.targetPositionId ?? rule.targetStrategyId}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      {/* Dry-run button — shows for DTE-agnostic conditions */}
                      {positions.length > 0 && (
                        <button onClick={() => {
                          setDryRunRuleId(rule.id);
                          setDryRunPosId(positions[0].id);
                        }} style={{
                          fontSize: 9, padding: "2px 8px", background: "none",
                          border: "1px solid var(--border-default)", color: "var(--text-lo)", cursor: "pointer",
                        }}>
                          Dry run
                        </button>
                      )}
                      <button onClick={() => openEditor(rule)} style={{
                        fontSize: 9, padding: "2px 8px", background: "none",
                        border: "1px solid var(--border-default)", color: "var(--text-lo)", cursor: "pointer",
                      }}>
                        Edit
                      </button>
                      <button onClick={() => toggleRule(rule)} style={{
                        fontSize: 9, padding: "2px 8px", background: "none",
                        border: "1px solid var(--border-default)",
                        color: rule.enabled ? "var(--call)" : "var(--text-lo)", cursor: "pointer",
                      }}>
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </button>
                      <button onClick={() => removeRule(rule.id)} style={{
                        fontSize: 9, padding: "2px 8px", background: "none",
                        border: "1px solid var(--border-subtle)", color: "var(--text-lo)", cursor: "pointer",
                      }}>
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Dry-run result */}
          {dryRunResult && dryRunRuleId && (
            <div style={{ marginBottom: 12, padding: 12, border: "1px solid var(--brand)", background: "var(--brand-dim)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)" }}>Dry Run Result</span>
                <button onClick={() => { setDryRunRuleId(null); setDryRunPosId(null); }} style={{
                  fontSize: 10, background: "none", border: "none", color: "var(--text-lo)", cursor: "pointer",
                }}>✕</button>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-mid)", lineHeight: 1.6 }}>{dryRunResult.summary}</div>
              {dryRunResult.triggerDays.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                  {dryRunResult.triggerDays.slice(0, 10).map(d => (
                    <span key={d} style={{
                      fontSize: 9, padding: "1px 6px", background: "var(--bg-overlay)",
                      border: "1px solid var(--border-subtle)", color: "var(--atm)", fontFamily: "var(--font-mono)",
                    }}>{d}</span>
                  ))}
                  {dryRunResult.triggerDays.length > 10 && (
                    <span style={{ fontSize: 9, color: "var(--text-lo)" }}>+{dryRunResult.triggerDays.length - 10} more</span>
                  )}
                </div>
              )}
              {/* Position selector for dry-run */}
              {positions.length > 1 && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 9, color: "var(--text-lo)", marginRight: 6 }}>Position:</label>
                  <select value={dryRunPosId ?? ""} onChange={e => setDryRunPosId(e.target.value)}
                    style={{ fontSize: 10, background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", padding: "2px 6px" }}>
                    {positions.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.underlying} {p.option_type} K={p.strike} {p.expiry_days}D
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Rule editor */}
          {showEditor && (
            <div style={{ border: "1px solid var(--brand)", background: "var(--bg-elevated)", padding: 16, marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", marginBottom: 12 }}>
                {editingRule ? "Edit Rule" : "New Rule"}
              </div>

              {/* Template picker */}
              {!editingRule && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, color: "var(--text-lo)", display: "block", marginBottom: 4 }}>Start from template</label>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {RULE_TEMPLATES.map(tpl => (
                      <button key={tpl.id} onClick={() => applyTemplate(tpl.id)} title={tpl.description} style={{
                        fontSize: 10, padding: "3px 10px", background: "var(--bg-overlay)",
                        border: "1px solid var(--border-default)", color: "var(--text-mid)", cursor: "pointer",
                      }}>
                        {tpl.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {/* Name */}
                <div style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="rule-name" style={{ fontSize: 10, color: "var(--text-lo)", display: "block", marginBottom: 4 }}>Rule Name</label>
                  <input id="rule-name" value={editorName} onChange={e => setEditorName(e.target.value)} placeholder="My rule"
                    style={{ width: "100%", padding: "6px 8px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 12 }} />
                </div>

                {/* Condition */}
                <div>
                  <label htmlFor="rule-condition" style={{ fontSize: 10, color: "var(--text-lo)", display: "block", marginBottom: 4 }}>Condition</label>
                  <select id="rule-condition" value={editorCondition} onChange={e => setEditorCondition(e.target.value as RuleConditionType)}
                    style={{ width: "100%", padding: "6px 8px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11 }}>
                    {(Object.entries(CONDITION_LABELS) as [RuleConditionType, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                {/* Threshold */}
                <div>
                  <label htmlFor="rule-threshold" style={{ fontSize: 10, color: "var(--text-lo)", display: "block", marginBottom: 4 }}>
                    {CONDITION_THRESHOLD_LABELS[editorCondition]}
                  </label>
                  <input id="rule-threshold" type="number" value={editorThreshold} onChange={e => setEditorThreshold(e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 12, fontFamily: "var(--font-mono)" }} />
                </div>

                {/* Action */}
                <div>
                  <label htmlFor="rule-action" style={{ fontSize: 10, color: "var(--text-lo)", display: "block", marginBottom: 4 }}>Action</label>
                  <select id="rule-action" value={editorAction} onChange={e => setEditorAction(e.target.value as RuleAction)}
                    style={{ width: "100%", padding: "6px 8px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11 }}>
                    {(Object.entries(ACTION_LABELS) as [RuleAction, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                {/* Target */}
                <div>
                  <label htmlFor="rule-target" style={{ fontSize: 10, color: "var(--text-lo)", display: "block", marginBottom: 4 }}>Apply to</label>
                  <select id="rule-target" value={editorTarget} onChange={e => setEditorTarget(e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11 }}>
                    <option value="all">All positions</option>
                    {positions.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.underlying} {p.option_type} K={p.strike} {p.expiry_days}D
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button onClick={saveEditorRule} style={{
                  padding: "6px 16px", background: "var(--brand)", color: "var(--bg)",
                  border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>
                  {editingRule ? "Save Changes" : "Add Rule"}
                </button>
                <button onClick={() => setShowEditor(false)} style={{
                  padding: "6px 16px", background: "none", color: "var(--text-lo)",
                  border: "1px solid var(--border-default)", fontSize: 12, cursor: "pointer",
                }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action queue tab */}
      {activeTab === "queue" && (
        <div style={{ padding: 16 }}>
          {alerts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "28px 0", fontSize: 13, color: "var(--text-lo)" }}>
              No rules triggered. Positions are being monitored.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 4 }}>
                {alerts.length} action{alerts.length > 1 ? "s" : ""} suggested — all require explicit confirmation before execution.
              </div>
              {alerts.map(alert => {
                const key = alert.triggeredAt + alert.positionId;
                const isExecuting = executing === key;
                return (
                  <div key={key} style={{
                    padding: 12, border: "1px solid var(--atm)", background: "var(--atm-dim)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--atm)", marginBottom: 3 }}>
                          Rule triggered: {alert.rule.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 3 }}>
                          {alert.reason}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-hi)" }}>
                          Suggested: {alert.actionDescription}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => dismissAlert(alert)} style={{
                          fontSize: 10, padding: "4px 10px", background: "none",
                          border: "1px solid var(--border-default)", color: "var(--text-lo)", cursor: "pointer",
                        }}>
                          Dismiss
                        </button>
                        <button onClick={() => handleExecute(alert)} disabled={isExecuting} style={{
                          fontSize: 10, padding: "4px 12px", background: "var(--atm)",
                          color: "var(--bg)", border: "none", cursor: isExecuting ? "default" : "pointer",
                          fontWeight: 700, opacity: isExecuting ? 0.6 : 1,
                        }}>
                          {isExecuting ? "Executing…" : "Confirm & Execute"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
