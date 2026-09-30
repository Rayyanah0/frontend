"use client";
import { useState, useId, useEffect } from "react";
import { detectAddressPoisoning, isValidStellarAddress } from "../lib/auth/challenge";

interface AddressInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Known/trusted addresses to check poisoning against */
  knownAddresses?: string[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Called with poisoning result when detected */
  onPoisoningDetected?: (matchedAddress: string) => void;
}

/**
 * Generates a simple deterministic color identicon for a Stellar address.
 * Uses the first 6 hex-like chars (mapped from base32) as a color seed.
 */
function addressToColor(address: string): string {
  if (!address || address.length < 6) return "#666";
  // Map base32 chars to nibbles for a deterministic color
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let h = 0;
  for (let i = 0; i < Math.min(8, address.length); i++) {
    const idx = chars.indexOf(address[i].toUpperCase());
    h = (h * 31 + (idx >= 0 ? idx : i)) & 0xffffff;
  }
  const r = (h >> 16) & 0xff;
  const g = (h >> 8) & 0xff;
  const b = h & 0xff;
  return `rgb(${r},${g},${b})`;
}

/**
 * A simple 5×5 pixel identicon SVG for a Stellar address.
 * Provides visual confirmation so users can spot address substitution.
 */
function Identicon({ address, size = 20 }: { address: string; size?: number }) {
  if (!address || address.length < 10) {
    return <div style={{ width: size, height: size, background: "var(--border-default)", flexShrink: 0 }} aria-hidden="true" />;
  }
  const color = addressToColor(address);
  const grid = 5;
  const cell = size / grid;
  // Build symmetric grid from address chars
  const cells: boolean[] = [];
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < Math.ceil(grid / 2); col++) {
      const charIdx = (row * 3 + col) % address.length;
      const charCode = address.charCodeAt(charIdx);
      const val = (charCode * (col + 1) * (row + 1)) % 2 === 0;
      cells.push(val);
    }
  }

  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true" focusable="false"
      style={{ flexShrink: 0, display: "block" }}
    >
      {Array.from({ length: grid }, (_, row) =>
        Array.from({ length: grid }, (_, col) => {
          const mirrorCol = col < Math.ceil(grid / 2) ? col : grid - 1 - col;
          const idx = row * Math.ceil(grid / 2) + mirrorCol;
          if (!cells[idx]) return null;
          return (
            <rect
              key={`${row}-${col}`}
              x={col * cell} y={row * cell}
              width={cell} height={cell}
              fill={color}
            />
          );
        })
      )}
    </svg>
  );
}

export function AddressInput({
  value, onChange, knownAddresses = [], label = "Stellar Address",
  placeholder = "G… or M… or C…", disabled, required, onPoisoningDetected,
}: AddressInputProps) {
  const inputId = useId();
  const errorId = useId();
  const [touched, setTouched] = useState(false);

  const poisoning = detectAddressPoisoning(value, knownAddresses);
  const isValid = value.length === 0 || isValidStellarAddress(value);
  const showError = touched && value.length > 0 && !isValid;
  const showPoisoning = poisoning.poisoned;

  useEffect(() => {
    if (poisoning.poisoned && poisoning.matchedAddress) {
      onPoisoningDetected?.(poisoning.matchedAddress);
    }
  }, [poisoning.poisoned, poisoning.matchedAddress, onPoisoningDetected]);

  const borderColor = showPoisoning
    ? "var(--put)"
    : showError
    ? "var(--atm)"
    : value && isValid
    ? "var(--call)"
    : "var(--border-default)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label
        htmlFor={inputId}
        style={{ fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}{required && <span aria-hidden="true" style={{ color: "var(--put)", marginLeft: 2 }}>*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
        <Identicon address={value} size={24} />
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={showError || showPoisoning ? true : undefined}
          aria-describedby={showError || showPoisoning ? errorId : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{
            flex: 1,
            padding: "6px 8px",
            background: "var(--bg-overlay)",
            border: `1px solid ${borderColor}`,
            color: "var(--text-hi)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            outline: "none",
          }}
          onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
          onBlur={e => { setTouched(true); e.currentTarget.style.outline = "none"; }}
        />
        {value && isValid && !showPoisoning && (
          <span aria-hidden="true" style={{ color: "var(--call)", fontSize: 12 }}>✓</span>
        )}
      </div>
      {showPoisoning && (
        <div
          id={errorId}
          role="alert"
          style={{ fontSize: 11, color: "var(--put)", lineHeight: 1.5, display: "flex", gap: 4, alignItems: "flex-start" }}
        >
          <span aria-hidden="true">⚠</span>
          <span>{poisoning.warning}</span>
        </div>
      )}
      {showError && !showPoisoning && (
        <div
          id={errorId}
          role="alert"
          style={{ fontSize: 11, color: "var(--atm)", lineHeight: 1.5 }}
        >
          Invalid Stellar address format. Addresses start with G, M, or C.
        </div>
      )}
    </div>
  );
}
