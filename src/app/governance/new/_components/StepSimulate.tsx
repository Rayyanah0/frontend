"use client";

/**
 * Step 3 — simulation preview.
 *
 * Reads the current on-chain value of every parameter the proposal touches and
 * renders it beside the proposed value, so voters see the concrete before/after
 * rather than raw arguments.  Reads are injected so this component works
 * without a live network and can be tested deterministically.
 */

import { useEffect, useState } from "react";
import type { ProposalAction } from "../../../../lib/governance/actions";
import {
  simulateActions,
  type ActionSimulation,
  type ParamDiff,
  type SimulationResult,
  type ValueReader,
} from "../../../../lib/governance/simulation";
import { Banner, EYEBROW, Panel, SectionLabel } from "./ui";

const DIRECTION_COLOR: Record<ParamDiff["direction"], string> = {
  up: "var(--atm)",
  down: "var(--put)",
  same: "var(--text-lo)",
  unknown: "var(--text-lo)",
};

function DiffRow({ diff }: { diff: ParamDiff }) {
  return (
    <tr>
      <td style={{ padding: "7px 0", fontSize: 12, color: "var(--text-lo)", width: "34%" }}>
        {diff.label}
      </td>
      <td
        className="num"
        style={{ padding: "7px 0", fontSize: 12, color: "var(--text-lo)", textAlign: "right" }}
      >
        {diff.current ?? "unavailable"}
      </td>
      <td style={{ padding: "7px 12px", textAlign: "center", color: "var(--text-lo)" }}>→</td>
      <td
        className="num"
        style={{
          padding: "7px 0",
          fontSize: 12,
          color: "var(--text-hi)",
          fontWeight: 600,
          textAlign: "right",
        }}
      >
        {diff.proposed}
        {diff.unit && <span style={{ color: "var(--text-lo)" }}> {diff.unit}</span>}
      </td>
      <td
        className="num"
        style={{
          padding: "7px 0 7px 12px",
          fontSize: 11,
          textAlign: "right",
          color: DIRECTION_COLOR[diff.direction],
        }}
      >
        {diff.direction === "unknown"
          ? "—"
          : diff.percentChange !== null
            ? `${diff.percentChange > 0 ? "+" : ""}${diff.percentChange.toFixed(1)}%`
            : "no change"}
      </td>
    </tr>
  );
}

function SimulationCard({ sim }: { sim: ActionSimulation }) {
  return (
    <Panel style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)" }}>{sim.summary}</div>
          <div style={{ ...EYEBROW, marginTop: 3 }}>
            {sim.contractLabel} · {sim.functionLabel}
          </div>
        </div>
        {sim.dangerous && (
          <span style={{ fontSize: 10, color: "var(--atm)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            High impact
          </span>
        )}
      </div>

      {sim.errors.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <Banner tone="danger" title="Fix before submitting">
            {sim.errors.map((e) => (
              <div key={e.paramName}>{e.message}</div>
            ))}
          </Banner>
        </div>
      )}

      {sim.diffs.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-lo)" }}>
          No on-chain state changes — this call records intent only.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: "left" }}>Parameter</th>
              <th style={{ ...TH, textAlign: "right" }}>Current</th>
              <th style={{ ...TH, width: 16 }} />
              <th style={{ ...TH, textAlign: "right" }}>Proposed</th>
              <th style={{ ...TH, textAlign: "right" }}>Change</th>
            </tr>
          </thead>
          <tbody>
            {sim.diffs.map((diff) => (
              <DiffRow key={diff.paramName} diff={diff} />
            ))}
          </tbody>
        </table>
      )}

      {sim.partial && (
        <div style={{ marginTop: 10 }}>
          <Banner tone="warn">
            Some current values could not be read from the network, so this preview is incomplete.
            Values will still be submitted exactly as entered.
          </Banner>
        </div>
      )}
    </Panel>
  );
}

const TH = {
  fontSize: 10,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "var(--text-lo)",
  fontWeight: 600 as const,
  padding: "0 0 6px",
  borderBottom: "1px solid var(--border-subtle)",
};

export function StepSimulate({
  actions,
  contractIds,
  reader,
  maxActions,
  result,
  onResult,
}: {
  actions: ProposalAction[];
  contractIds?: Record<string, string | undefined>;
  reader?: ValueReader;
  maxActions?: number;
  result: SimulationResult | null;
  onResult: (result: SimulationResult | null) => void;
}) {
  const [loading, setLoading] = useState(false);

  // Re-simulate whenever the action set changes.
  useEffect(() => {
    let cancelled = false;

    if (actions.length === 0) {
      onResult(null);
      return;
    }

    setLoading(true);
    simulateActions(actions, { contractIds, reader, maxActions })
      .then((next) => {
        if (!cancelled) onResult(next);
      })
      .catch(() => {
        // simulateActions never rejects; this is belt-and-braces.
        if (!cancelled) onResult(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(actions), contractIds, maxActions]);

  if (actions.length === 0) {
    return (
      <Panel>
        <div style={EYEBROW}>Nothing to simulate</div>
        <p style={{ fontSize: 13, color: "var(--text-mid)", margin: "6px 0 0" }}>
          Add at least one action in the previous step to preview its effect on protocol state.
        </p>
      </Panel>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <SectionLabel>Projected effect</SectionLabel>
        {loading && (
          <span style={{ fontSize: 11, color: "var(--text-lo)" }}>Reading current state…</span>
        )}
      </div>

      {!result && !loading && (
        <Panel>
          <div style={{ fontSize: 12, color: "var(--text-lo)" }}>Preview unavailable.</div>
        </Panel>
      )}

      {result && !result.withinActionLimit && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="danger" title="Too many actions">
            The governor accepts a limited number of actions per proposal. Remove{" "}
            {result.simulations.length - (maxActions ?? 8)} to continue.
          </Banner>
        </div>
      )}

      {result?.hasErrors && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="danger" title="Some actions are not valid yet">
            Go back to the actions step and correct the highlighted fields.
          </Banner>
        </div>
      )}

      {result?.hasDangerous && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warn" title="This proposal changes critical protocol parameters">
            Upgrades, admin rights, oracle feeds and collateral ratios are flagged as high impact. You
            will be asked to confirm this explicitly on the review step.
          </Banner>
        </div>
      )}

      {result?.simulations.map((sim) => (
        <SimulationCard key={sim.actionId} sim={sim} />
      ))}
    </div>
  );
}
