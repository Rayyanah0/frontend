"use client";

/**
 * ChainUpdateScenario — renders a lightweight options chain table and
 * collects profiler samples as full chain snapshots are pumped through.
 *
 * Uses the real ChainRow component (already memo'd) so the profiler
 * measures the same code path as production.
 */

import { memo } from "react";
import { ProfilerWrapper } from "../../../../lib/perf/ProfilerWrapper";
import type { ProfileSample } from "../../../../lib/perf/metrics";
import type { ChainRowData } from "../../../../lib/chainRows";
import { ChainRow } from "../../../../components/ChainRow";

interface Props {
  rows: ChainRowData[] | null;
  onSample: (s: ProfileSample) => void;
}

const NOOP_TRADE = () => {};

const ChainTableDisplay = memo(function ChainTableDisplay({
  rows,
}: {
  rows: ChainRowData[] | null;
}) {
  if (!rows || rows.length === 0) return <div data-testid="chain-empty">—</div>;
  const atmIdx = rows.findIndex((r) => !r.itmCall);
  const fmtStrike = (k: number) =>
    k.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <div data-testid="chain-update-display">
      {rows.map((row, i) => (
        <ChainRow
          key={row.strike}
          row={row}
          isAtm={i === atmIdx}
          fmtStrike={fmtStrike}
          onTrade={NOOP_TRADE}
        />
      ))}
    </div>
  );
});

export function ChainUpdateScenario({ rows, onSample }: Props) {
  return (
    <ProfilerWrapper id="chain-update" onSample={onSample}>
      <ChainTableDisplay rows={rows} />
    </ProfilerWrapper>
  );
}
