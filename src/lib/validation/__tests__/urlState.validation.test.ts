/** @jest-environment node */
import { parseTerminalUrl, URL_DEFAULTS } from "../../urlState";

const params = (q: Record<string, string>) => new URLSearchParams(q);

describe("URL params use the shared schemas", () => {
  it.each([
    ["qty", "3", 3],
    ["qty", "1e3", URL_DEFAULTS.qty],
    ["qty", "0x10", URL_DEFAULTS.qty],
    ["qty", "1,000", URL_DEFAULTS.qty],
    ["qty", " 5", URL_DEFAULTS.qty],
    ["qty", "2.5", URL_DEFAULTS.qty],
    ["qty", "0", URL_DEFAULTS.qty],
    ["qty", "-1", URL_DEFAULTS.qty],
    ["qty", "1000001", URL_DEFAULTS.qty],
  ])("%s=%p → %p", (key, value, expected) => {
    expect(parseTerminalUrl(params({ [key]: value })).qty).toBe(expected);
  });

  it.each([
    ["0.12", 0.12],
    ["0.12345678", 0.12345678],
    ["0.123456789", null],
    ["0", null],
    ["1e2", null],
    ["Infinity", null],
    ["", null],
  ])("strike=%p → %p", (value, expected) => {
    expect(parseTerminalUrl(params({ strike: value })).strike).toBe(expected);
  });

  it("rejects non-canonical expiry", () => {
    expect(parseTerminalUrl(params({ exp: "1e1" })).exp).toBe(URL_DEFAULTS.exp);
  });
});
