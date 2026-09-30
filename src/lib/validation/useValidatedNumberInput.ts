"use client";

import { useCallback, useId, useMemo, useState } from "react";
import type { z } from "zod";

export interface ValidatedInputOptions {
  /** Initial raw text. */
  initial?: string;
  /**
   * Show a "Required"/format error before the field has been blurred?
   * Default: format errors show while typing, "Required" only after blur.
   */
  eager?: boolean;
}

export interface ValidatedInput<T> {
  /** Parsed value, or null while the input is invalid. Never a silent fallback. */
  value: T | null;
  /** Error message to display, or null. */
  error: string | null;
  /** True only when the current raw text parses — use to enable submit. */
  valid: boolean;
  raw: string;
  setRaw: (raw: string) => void;
  /** Spread onto an <input>. */
  inputProps: {
    id: string;
    value: string;
    type: "text";
    inputMode: "decimal" | "text";
    autoComplete: "off";
    spellCheck: false;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  };
  /** id for the error element referenced by aria-describedby. */
  errorId: string;
}

/** Remove what a paste typically drags along: surrounding whitespace, zero-width chars, line breaks. */
export function cleanPaste(text: string): string {
  return text.replace(/[​-‍﻿]/g, "").replace(/[\r\n\t]+/g, " ").trim();
}

/**
 * Bind an <input> to a schema from src/lib/validation. The input is a plain
 * text field (type=number accepts "1e5", ignores locale and silently drops
 * invalid text), and `value` is null whenever the text doesn't parse — so a
 * typo like "1O" can never turn into 1 contract.
 *
 *   const qty = useValidatedNumberInput(quantitySchema({ step: 0.01 }), { initial: "1" });
 *   <input {...qty.inputProps} />
 *   {qty.error && <p id={qty.errorId}>{qty.error}</p>}
 *   <button disabled={!qty.valid}>Buy</button>
 */
export function useValidatedNumberInput<T>(
  schema: z.ZodType<T, z.ZodTypeDef, string>,
  { initial = "", eager = false }: ValidatedInputOptions = {},
): ValidatedInput<T> {
  const [raw, setRaw] = useState(initial);
  const [touched, setTouched] = useState(false);
  const errorId = `${useId()}-error`;
  const id = `${errorId}-input`;

  const result = useMemo(() => schema.safeParse(raw), [schema, raw]);
  const value = result.success ? result.data : null;
  const message = result.success ? null : result.error.issues[0]?.message ?? "Invalid value";
  const isEmpty = raw.trim() === "";
  // Don't nag about an empty field until the user has left it.
  const error = message && (!isEmpty || touched || eager) ? message : null;

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => setRaw(e.target.value), []);
  const onBlur = useCallback(() => setTouched(true), []);
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const cleaned = cleanPaste(text);
    if (cleaned === text) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setRaw(el.value.slice(0, start) + cleaned + el.value.slice(end));
  }, []);

  return {
    value,
    error,
    valid: result.success,
    raw,
    setRaw,
    errorId,
    inputProps: {
      id,
      value: raw,
      type: "text",
      inputMode: "decimal",
      autoComplete: "off",
      spellCheck: false,
      "aria-invalid": !!error,
      "aria-describedby": error ? errorId : undefined,
      onChange,
      onBlur,
      onPaste,
    },
  };
}
