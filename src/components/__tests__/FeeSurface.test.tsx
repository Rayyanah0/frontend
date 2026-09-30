/**
 * RTL tests for the FeeSurface component.
 *
 * Covers:
 *  - Total fee rendering (XLM + USD)
 *  - Fee priority badge display
 *  - Anomaly warning (fee > 5× recent median)
 *  - Insufficient balance warning
 *  - Expandable detailed breakdown
 *  - Priority selector callback
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// Mock the tracker store — FeeSurface reads recentFeeMedianStroops from it.
// We provide a factory so individual tests can override it.
// ---------------------------------------------------------------------------

let mockMedian: number | null = null;

jest.mock("../../lib/store/tracker", () => ({
  useTrackerStore: (selector: (s: { recentFeeMedianStroops: number | null }) => unknown) =>
    selector({ recentFeeMedianStroops: mockMedian }),
}));

import { FeeSurface } from "../FeeSurface";
import type { SorobanFeeBreakdown } from "../../lib/soroban/types";

// ---------------------------------------------------------------------------
// Test fixture factory
// ---------------------------------------------------------------------------

function makeFees(overrides: Partial<SorobanFeeBreakdown> = {}): SorobanFeeBreakdown {
  return {
    inclusionFeeStroops: 100,
    cpuInstructionFeeStroops: 200_000,
    readBytesFeeStroops: 60_000,
    writeBytesFeeStroops: 30_000,
    ledgerReadFeeStroops: 40_000,
    ledgerWriteFeeStroops: 70_000,
    rentFeeStroops: 0,
    resourceFeeStroops: 400_000,
    totalFeeStroops: 400_100,
    totalFeeXlm: 0.04001,
    totalFeeUsd: 0.0048012,
    priority: "standard",
    xlmUsdPrice: 0.12,
    cpuInstructions: 500_000,
    readBytes: 1024,
    writeBytes: 512,
    ledgerReadsCount: 3,
    ledgerWritesCount: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FeeSurface", () => {
  beforeEach(() => {
    mockMedian = null; // reset to no median before each test
  });

  it("renders total XLM fee", () => {
    render(<FeeSurface fees={makeFees()} />);
    // The component renders "0.040010 XLM" — exact formatting may vary by precision
    expect(screen.getByText(/0\.04001\d* XLM/)).toBeInTheDocument();
  });

  it("renders USD equivalent when xlmUsdPrice is available", () => {
    render(<FeeSurface fees={makeFees()} />);
    // Approx $0.00480… — just check ≈ $ is present
    expect(screen.getByText(/≈ \$\d+\.\d+/)).toBeInTheDocument();
  });

  it("does not render USD when totalFeeUsd is null", () => {
    render(
      <FeeSurface fees={makeFees({ totalFeeUsd: null, xlmUsdPrice: null })} />
    );
    expect(screen.queryByText(/≈ \$/)).not.toBeInTheDocument();
  });

  it("shows 'Standard' badge for standard priority", () => {
    render(<FeeSurface fees={makeFees({ priority: "standard" })} />);
    expect(screen.getByText(/Standard/i)).toBeInTheDocument();
  });

  it("shows 'Fast' badge for fast priority", () => {
    render(<FeeSurface fees={makeFees({ priority: "fast" })} />);
    expect(screen.getByText(/Fast/i)).toBeInTheDocument();
  });

  it("shows priority buttons when onPriorityChange is provided", () => {
    render(<FeeSurface fees={makeFees()} onPriorityChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /set fee priority to standard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set fee priority to fast/i })).toBeInTheDocument();
  });

  it("hides priority buttons when no onPriorityChange is provided", () => {
    render(<FeeSurface fees={makeFees()} />);
    expect(screen.queryByRole("button", { name: /set fee priority/i })).not.toBeInTheDocument();
  });

  it("calls onPriorityChange with 'fast' when fast button is clicked", () => {
    const onChange = jest.fn();
    render(<FeeSurface fees={makeFees()} onPriorityChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /set fee priority to fast/i }));
    expect(onChange).toHaveBeenCalledWith("fast");
  });

  it("calls onPriorityChange with 'standard' when standard button is clicked", () => {
    const onChange = jest.fn();
    render(<FeeSurface fees={makeFees({ priority: "fast" })} onPriorityChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /set fee priority to standard/i }));
    expect(onChange).toHaveBeenCalledWith("standard");
  });

  // --- Anomaly warning --------------------------------------------------

  it("does not show anomaly warning when no median exists", () => {
    mockMedian = null;
    render(<FeeSurface fees={makeFees()} />);
    expect(screen.queryByText(/recent median/i)).not.toBeInTheDocument();
  });

  it("does not show anomaly warning when fee is within 5× median", () => {
    mockMedian = 400_000; // same as total — 1× → well within 5×
    render(<FeeSurface fees={makeFees()} />);
    expect(screen.queryByText(/recent median/i)).not.toBeInTheDocument();
  });

  it("shows anomaly warning when fee exceeds 5× the recent median", () => {
    mockMedian = 60_000; // 400_100 / 60_000 ≈ 6.7× → anomalous
    render(<FeeSurface fees={makeFees()} />);
    expect(screen.getByText(/recent median/i)).toBeInTheDocument();
    // Warning should include the multiplier
    expect(screen.getByText(/×/)).toBeInTheDocument();
  });

  it("anomaly warning includes the actual multiplier value", () => {
    mockMedian = 60_000; // ~6.7×
    render(<FeeSurface fees={makeFees()} />);
    // Check the warning mentions "×" as part of the ratio string
    const warning = screen.getByText(/recent median/i);
    expect(warning.textContent).toMatch(/\d+\.\d+×/);
  });

  // --- Insufficient balance warning ------------------------------------

  it("does not show balance warning when xlmBalance is not provided", () => {
    render(<FeeSurface fees={makeFees()} />);
    expect(screen.queryByText(/insufficient xlm/i)).not.toBeInTheDocument();
  });

  it("does not show balance warning when balance is sufficient", () => {
    render(<FeeSurface fees={makeFees()} xlmBalance={2.0} />);
    // fee = 0.04001 XLM + 1 XLM reserve = 1.04001 needed; balance 2.0 > 1.04001
    expect(screen.queryByText(/insufficient xlm/i)).not.toBeInTheDocument();
  });

  it("shows balance warning when XLM balance can't cover fee + reserve", () => {
    render(<FeeSurface fees={makeFees()} xlmBalance={0.5} />);
    // fee = 0.04001 + 1 reserve = 1.04001 needed; balance 0.5 < 1.04001
    expect(screen.getByText(/insufficient xlm/i)).toBeInTheDocument();
  });

  it("balance warning includes have/need amounts", () => {
    render(<FeeSurface fees={makeFees()} xlmBalance={0.5} />);
    const warning = screen.getByText(/insufficient xlm/i);
    expect(warning.textContent).toMatch(/have/i);
    expect(warning.textContent).toMatch(/need/i);
  });

  // --- Expandable breakdown --------------------------------------------

  it("hides detailed breakdown by default", () => {
    render(<FeeSurface fees={makeFees()} />);
    expect(screen.queryByText(/CPU instructions/i)).not.toBeInTheDocument();
  });

  it("shows detailed breakdown after clicking expand", () => {
    render(<FeeSurface fees={makeFees()} />);
    const toggle = screen.getByRole("button", { name: /expand fee details/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/CPU instructions/i)).toBeInTheDocument();
    expect(screen.getByText(/Read bytes/i)).toBeInTheDocument();
    expect(screen.getByText(/Write bytes/i)).toBeInTheDocument();
    expect(screen.getByText(/Ledger reads/i)).toBeInTheDocument();
    expect(screen.getByText(/Ledger writes/i)).toBeInTheDocument();
  });

  it("hides breakdown again after second click (toggle)", () => {
    render(<FeeSurface fees={makeFees()} />);
    const toggle = screen.getByRole("button", { name: /expand fee details/i });
    fireEvent.click(toggle); // open
    fireEvent.click(toggle); // close
    expect(screen.queryByText(/CPU instructions/i)).not.toBeInTheDocument();
  });

  it("shows rent row when rentFeeStroops > 0", () => {
    render(<FeeSurface fees={makeFees({ rentFeeStroops: 50_000 })} />);
    const toggle = screen.getByRole("button", { name: /expand fee details/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/Rent.*new entries/i)).toBeInTheDocument();
  });

  it("omits rent row when rentFeeStroops is 0", () => {
    render(<FeeSurface fees={makeFees({ rentFeeStroops: 0 })} />);
    const toggle = screen.getByRole("button", { name: /expand fee details/i });
    fireEvent.click(toggle);
    expect(screen.queryByText(/Rent.*new entries/i)).not.toBeInTheDocument();
  });

  it("always shows top-level inclusion fee and resource fee lines", () => {
    render(<FeeSurface fees={makeFees()} />);
    expect(screen.getByText(/Inclusion fee/i)).toBeInTheDocument();
    expect(screen.getByText(/Resource fee/i)).toBeInTheDocument();
  });

  it("shows resource count details in breakdown (cpu instructions count)", () => {
    render(<FeeSurface fees={makeFees({ cpuInstructions: 500_000 })} />);
    const toggle = screen.getByRole("button", { name: /expand fee details/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/500,000 ops/i)).toBeInTheDocument();
  });
});
