import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExpiryInfo, Position } from "./api/types.ts";
import {
  buildIcsFeed,
  countdownLabel,
  deriveExpiryMs,
  groupByExpiryDate,
  settlementOutcome,
} from "./expiry.ts";

function pos(partial: Partial<Position> = {}): Position {
  return {
    id: "p1",
    wallet_address: "G",
    underlying: "XLM",
    strike: 0.12,
    expiry_days: 7,
    option_type: "call",
    position_type: "long",
    contracts: 10,
    entry_premium: 0.01,
    entry_spot: 0.11,
    collateral: 0,
    status: "open",
    close_premium: null,
    close_spot: null,
    realized_pnl: null,
    opened_at: "2024-06-01T15:30:00.000Z",
    closed_at: null,
    strategy_id: null,
    ...partial,
  };
}

describe("deriveExpiryMs", () => {
  it("uses ExpiryInfo.timestamp when present (seconds)", () => {
    const info: ExpiryInfo = { days_to_expiry: 7, label: "7D", timestamp: 1_717_891_200 };
    const ms = deriveExpiryMs(pos(), info);
    assert.equal(ms, 1_717_891_200_000);
  });

  it("derives opened_at UTC date + expiry_days at 08:00 UTC", () => {
    const ms = deriveExpiryMs(pos({ opened_at: "2024-06-01T15:30:00.000Z", expiry_days: 7 }));
    assert.equal(new Date(ms).toISOString(), "2024-06-08T08:00:00.000Z");
  });
});

describe("groupByExpiryDate", () => {
  it("aggregates count, net premium, projected intrinsic", () => {
    const positions = [
      pos({ id: "a", contracts: 1, entry_premium: 2, strike: 100, option_type: "call", opened_at: "2024-01-01T00:00:00.000Z", expiry_days: 10 }),
      pos({ id: "b", contracts: 1, entry_premium: 1, strike: 90, option_type: "call", position_type: "short", opened_at: "2024-01-01T00:00:00.000Z", expiry_days: 10 }),
    ];
    const groups = groupByExpiryDate(positions, { XLM: 100 });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);
    assert.ok(Math.abs(groups[0].netPremium - 1) < 1e-6);
  });
});

describe("buildIcsFeed", () => {
  it("emits valid VCALENDAR with CRLF and VEVENT", () => {
    const ics = buildIcsFeed([pos()]);
    assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
    assert.ok(ics.includes("VERSION:2.0"));
    assert.ok(ics.includes("BEGIN:VEVENT"));
    assert.ok(ics.includes("END:VEVENT"));
    assert.ok(ics.includes("END:VCALENDAR"));
    assert.ok(ics.includes("\r\n"));
    assert.ok(/DTSTART:\d{8}T\d{6}Z/.test(ics));
  });
});

describe("settlementOutcome / countdown", () => {
  it("labels ITM/OTM", () => {
    assert.equal(settlementOutcome(pos({ option_type: "call", strike: 100 }), 110), "ITM");
    assert.equal(settlementOutcome(pos({ option_type: "call", strike: 100 }), 90), "OTM");
  });

  it("countdown for expired is Expired", () => {
    assert.equal(countdownLabel(Date.now() - 1000, Date.now()), "Expired");
  });
});
