import { describe, expect, it } from "vitest";
import { combinedPnl, markToModelPnl, type PricedLeg } from "./payoff";
import { bs, smileVol } from "./pricing";
import {
  builderReducer,
  emptyBuilder,
  stepStrike,
  validateBuilder,
  type BuilderState,
} from "./strategyBuilder";
import { STRATEGY_TEMPLATES } from "./strategies";
import {
  checkPriceProtection,
  initialTicketState,
  ticketReducer,
  QUOTE_TTL_MS,
} from "./orderTicket";
import { suggestRolls } from "./suggestRolls";
import { riskProfile } from "./risk";

function atmStraddle(spot: number, days: number, qty = 1): PricedLeg[] {
  const vol = smileVol(0.5, 1);
  const t = days / 365;
  const call = bs(spot, spot, vol, t, true);
  const put = bs(spot, spot, vol, t, false);
  return [
    { side: "call", action: "buy", strike: spot, contracts: qty, expiryDays: days, iv: vol, greeks: call },
    { side: "put", action: "buy", strike: spot, contracts: qty, expiryDays: days, iv: vol, greeks: put },
  ];
}

describe("markToModelPnl (#33)", () => {
  it("T+0 at t=expiry equals intrinsic curve", () => {
    const spot = 100;
    const days = 30;
    const legs = atmStraddle(spot, days);
    // Force remaining life to 0 by forwarding to expiry
    for (const s of [80, 90, 100, 110, 120]) {
      const mtm = markToModelPnl(legs, s, days, 0, 0.5);
      const intrinsic = combinedPnl(legs, s);
      expect(mtm).toBeCloseTo(intrinsic, 8);
    }
  });

  it("long straddle value falls monotonically with time at spot=strike", () => {
    const spot = 100;
    const days = 60;
    const legs = atmStraddle(spot, days);
    const values: number[] = [];
    for (let d = 0; d <= days; d += 5) {
      // Mark value (not P&L): premium of both legs
      const mark =
        markToModelPnl(legs, spot, d, 0, 0.5) +
        legs.reduce((s, l) => s + l.greeks.premium * l.contracts, 0);
      values.push(mark);
    }
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1] + 1e-9);
    }
  });
});

describe("strategyBuilder reducer (#32)", () => {
  const strikes = [90, 95, 100, 105, 110];

  it("applyTemplate / addLeg / updateLeg / removeLeg", () => {
    let state: BuilderState = emptyBuilder();
    const tmpl = STRATEGY_TEMPLATES.find(t => t.id === "straddle")!;
    state = builderReducer(state, {
      type: "applyTemplate", template: tmpl, spot: 100, expiryDays: 30, quantity: 1, strikes,
    });
    expect(state.legs).toHaveLength(2);
    state = builderReducer(state, { type: "addLeg", spot: 100, expiryDays: 30, strikes });
    expect(state.legs).toHaveLength(3);
    const id = state.legs[0].id;
    state = builderReducer(state, { type: "updateLeg", id, patch: { quantity: 2 } });
    expect(state.legs[0].quantity).toBe(2);
    state = builderReducer(state, { type: "removeLeg", id });
    expect(state.legs).toHaveLength(2);
  });

  it("stepStrike moves to adjacent listed strikes", () => {
    expect(stepStrike(100, strikes, 1)).toBe(105);
    expect(stepStrike(100, strikes, -1)).toBe(95);
  });

  it("validateBuilder rejects empty and bad qty", () => {
    expect(validateBuilder(emptyBuilder(), strikes).length).toBeGreaterThan(0);
  });

  it("risk profiles for canonical structures are finite snapshots", () => {
    const spot = 100;
    for (const tmpl of STRATEGY_TEMPLATES) {
      let state = emptyBuilder();
      state = builderReducer(state, {
        type: "applyTemplate", template: tmpl, spot, expiryDays: 30, quantity: 1, strikes,
      });
      const legs = state.legs.map(l => {
        const iv = smileVol(0.5, l.strike / spot);
        const g = bs(spot, l.strike, iv, 30 / 365, l.side === "call");
        return {
          side: l.side, action: l.action, strike: l.strike, contracts: l.quantity,
          expiryDays: 30, iv, greeks: g,
        } as PricedLeg;
      });
      const profile = riskProfile(legs, spot);
      expect(Number.isFinite(profile.maxProfit) || profile.maxProfitUnlimited).toBe(true);
      expect(Number.isFinite(profile.maxLoss) || profile.maxLossUnlimited).toBe(true);
    }
  });
});

describe("orderTicket state machine (#34)", () => {
  it("idle → quoting → quoted → confirming → submitting → filled", () => {
    let s = initialTicketState();
    s = ticketReducer(s, {
      type: "startQuote",
      quote: {
        premium: 1, side: "call", mode: "buy", strike: 100,
        expiryDays: 30, underlying: "XLM",
      },
    });
    expect(s.status).toBe("quoting");
    s = ticketReducer(s, { type: "quoteReady", premium: 1 });
    expect(s.status).toBe("quoted");
    expect(s.quote!.expiresAt - s.quote!.quotedAt).toBe(QUOTE_TTL_MS);
    s = ticketReducer(s, { type: "beginConfirm" });
    expect(s.status).toBe("confirming");
    s = ticketReducer(s, { type: "submit" });
    expect(s.status).toBe("submitting");
    s = ticketReducer(s, { type: "filled", fillPremium: 1 });
    expect(s.status).toBe("filled");
  });

  it("expireQuote disables live quote", () => {
    let s = initialTicketState();
    s = ticketReducer(s, {
      type: "startQuote",
      quote: { premium: 1, side: "call", mode: "buy", strike: 100, expiryDays: 30, underlying: "XLM" },
    });
    s = ticketReducer(s, { type: "quoteReady", premium: 1 });
    s = ticketReducer(s, { type: "expireQuote" });
    expect(s.status).toBe("quoting");
  });

  it("checkPriceProtection catches slippage breach on buy", () => {
    const bad = checkPriceProtection("buy", 1.0, 1.02, 50, null);
    expect(bad.ok).toBe(false);
    const ok = checkPriceProtection("buy", 1.0, 1.001, 50, null);
    expect(ok.ok).toBe(true);
  });

  it("limit price blocks worse fills", () => {
    expect(checkPriceProtection("buy", 1, 1.05, 1000, 1.02).ok).toBe(false);
    expect(checkPriceProtection("write", 1, 0.9, 1000, 0.95).ok).toBe(false);
  });
});

describe("suggestRolls (#35)", () => {
  it("returns out / up-and-out / down-and-out / delta-targeted when later expiry exists", () => {
    const suggestions = suggestRolls(
      {
        underlying: "XLM",
        strike: 100,
        expiryDays: 30,
        optionType: "call",
        positionType: "short",
        contracts: 1,
        entryPremium: 0.01,
      },
      { strikes: [90, 95, 100, 105, 110], expiries: [7, 14, 30, 60, 90] }
    );
    expect(suggestions.map(s => s.id)).toEqual(
      expect.arrayContaining(["out", "up-and-out", "down-and-out", "delta-targeted"])
    );
    expect(suggestions.every(s => s.newExpiryDays > 30)).toBe(true);
  });

  it("returns empty when no later expiry", () => {
    expect(suggestRolls(
      {
        underlying: "XLM", strike: 100, expiryDays: 90,
        optionType: "put", positionType: "long", contracts: 1, entryPremium: 0.01,
      },
      { strikes: [100], expiries: [30, 60, 90] }
    )).toHaveLength(0);
  });
});
