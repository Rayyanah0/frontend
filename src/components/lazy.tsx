/**
 * Lazy-loaded heavy component exports (Issue #108 — bundle optimization).
 *
 * All chart/diagram/dialog components are dynamically imported so they are
 * excluded from the initial page JS bundle and only loaded when the browser
 * actually renders them.  Each export is a drop-in replacement for the
 * direct import — the props interface is unchanged.
 *
 * Skeleton fallbacks use the same bounding-box dimensions as the real
 * component so layout does not shift when the chunk loads.
 */

import dynamic from "next/dynamic";

// ── Skeletons ────────────────────────────────────────────────────────────────

function ChartSkeleton({ width = 212, height = 90 }: { width?: number; height?: number }) {
  return (
    <div
      style={{
        width,
        height,
        background: "var(--bg-overlay)",
        animation: "pulse 1.5s ease-in-out infinite",
      }}
      aria-hidden
    />
  );
}

function DialogSkeleton() {
  return null; // dialogs are mounted conditionally — no layout reserved
}

// ── Lazy exports ─────────────────────────────────────────────────────────────

export const PayoffDiagramLazy = dynamic(
  () => import("./PayoffDiagram").then((m) => ({ default: m.PayoffDiagram })),
  {
    loading: ({ }) => <ChartSkeleton width={284} height={155} />,
    ssr: false,
  }
);

export const MultiLegPayoffDiagramLazy = dynamic(
  () => import("./MultiLegPayoffDiagram").then((m) => ({ default: m.MultiLegPayoffDiagram })),
  {
    loading: ({ }) => <ChartSkeleton width={420} height={220} />,
    ssr: false,
  }
);

export const VolSurfaceHeatmapLazy = dynamic(
  () => import("./VolSurfaceHeatmap").then((m) => ({ default: m.VolSurfaceHeatmap })),
  {
    loading: ({ }) => <ChartSkeleton width={600} height={260} />,
    ssr: false,
  }
);

export const VolSmileLazy = dynamic(
  () => import("./VolSmile").then((m) => ({ default: m.VolSmile })),
  {
    loading: ({ }) => <ChartSkeleton width={212} height={110} />,
    ssr: false,
  }
);

export const SpotPriceChartLazy = dynamic(
  () => import("./SpotPriceChart").then((m) => ({ default: m.SpotPriceChart })),
  {
    loading: ({ }) => <ChartSkeleton width={212} height={70} />,
    ssr: false,
  }
);

export const ConfirmDialogLazy = dynamic(
  () => import("./ConfirmDialog").then((m) => ({ default: m.ConfirmDialog })),
  {
    loading: () => <DialogSkeleton />,
    ssr: false,
  }
);

export const PortfolioRiskPanelLazy = dynamic(
  () => import("./PortfolioRiskPanel").then((m) => ({ default: m.PortfolioRiskPanel })),
  {
    loading: ({ }) => <ChartSkeleton width={600} height={200} />,
    ssr: false,
  }
);
