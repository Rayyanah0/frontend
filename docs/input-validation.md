# Input validation

Every user input (trade quantities, strikes, alert thresholds, roll
parameters, amounts, addresses, search and URL params) goes through the
shared schemas in `src/lib/validation/`. The rule is **never coerce
silently**. Input that doesn't parse gets an inline error and disables
submit. It never falls back to a default. For example, before this change
`parseFloat("1O") || 1` turned "1O" into a 1-contract trade.

## Building blocks

| Module | Purpose |
|---|---|
| `parseNumber.ts` | `parseDecimal(raw, { locale, allowNegative })` is the strict, locale-aware parser. `toBaseUnits`/`fromBaseUnits` give exact bigint conversion. `formatForInput` formats a number for editing. |
| `strkey.ts` | Dependency-free SEP-23 StrKey validation for `G…` and `C…`: base32, version byte, CRC16-XModem checksum. It detects a pasted `S…` secret seed. |
| `schemas.ts` | Zod schemas that take the **raw string**: `quantitySchema`, `priceSchema`, `percentSchema`, `integerSchema`, `amountSchema` (bigint), `accountIdSchema`, `contractIdSchema`, `dateSchema`, `searchSchema`. |
| `useValidatedNumberInput.ts` | `useValidatedNumberInput(schema)` returns `{ value, error, valid, inputProps, errorId }`. |

## Parsing rules

- Surrounding whitespace, NBSP and zero-width characters (common in pastes)
  are removed. The Unicode minus `−` counts as `-`.
- The decimal separator follows the locale: `12.5` in en-US, `12,5` in de-DE.
- Grouping is accepted only when it's correct for the locale (`1,234.5` or
  `1.234,5`). Anything else is rejected.
- If the non-locale separator can't be a grouping mark in that locale (for
  example `.` in fr-FR, where grouping is a space), it's accepted as the
  decimal point. Otherwise you get an explicit error:
  - `1,5` in en-US → *Use "." as the decimal separator*
  - `1,500` in de-DE → *Ambiguous number*
- These are always rejected: scientific notation (`1e3`),
  hex/binary/octal (`0x10`), `Infinity`/`NaN`, letters (`1O`, `l0`),
  non-ASCII digits (`１２`), multiple signs, and input longer than 64 characters.
- `-0` normalizes to `0`.
- Number schemas reject more than 15 significant digits, where a double would
  silently round. On-chain amounts use `amountSchema`, which returns a
  **bigint** in base units (7 decimals for Stellar assets) and stays exact up
  to the i128 bounds.

## UI pattern

```tsx
const qty = useValidatedNumberInput(quantitySchema({ step: 0.01, max: 1_000_000 }), { initial: "1" });

<input {...qty.inputProps} />
{qty.error && <p id={qty.errorId} role="alert">{qty.error}</p>}
<button disabled={!qty.valid}>Buy</button>
```

- Inputs are `type="text" inputMode="decimal"`. `type="number"` accepts `1e5`,
  ignores the locale, and reports an empty value for text it can't parse.
- Format errors appear while typing. *Required* appears only after the field
  loses focus.
- `aria-invalid` and `aria-describedby` are wired to the error element.

## Where it's used

- **Options trade ticket** (`useTradeTicket` / `TradeTicket`): the contracts
  field. The ± stepper only moves from a valid value, and Buy/Write and Confirm
  are disabled while it's invalid.
- **Alerts** (`AlertsPanel`): the threshold price. It warns when the alert
  would trigger immediately.
- **Portfolio roll**: the new strike is now an editable, validated field. The
  ±5% buttons nudge it.
- **URL state** (`urlState.ts`): `qty`, `strike` and `exp` go through the same
  schemas (en-US, canonical spelling only), so a crafted link can't inject
  `1e3` or `0x10`.

## Tests

- `__tests__/schemas.test.ts`: table-driven. The `parseDecimal` table alone
  has more than 50 rows, plus schema, StrKey, date and bigint cases.
- `__tests__/parseNumber.fuzz.test.ts`: fast-check properties. The parser
  never throws, output is canonical, letters are never accepted,
  locale-formatted and `Intl`-grouped numbers round-trip, scientific notation
  is always rejected, `-0` normalizes, and i128 bigint values round-trip exactly.
- `__tests__/useValidatedNumberInput.test.tsx`: hook behavior, paste
  handling and ARIA wiring.
- `__tests__/urlState.validation.test.ts`: URL params.
