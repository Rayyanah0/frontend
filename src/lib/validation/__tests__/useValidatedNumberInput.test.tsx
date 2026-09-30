import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { cleanPaste, quantitySchema, useValidatedNumberInput } from "..";

const schema = quantitySchema({ step: 0.01, min: 0.01, max: 100, locale: "en-US" });

describe("useValidatedNumberInput", () => {
  it("exposes the parsed value when valid", () => {
    const { result } = renderHook(() => useValidatedNumberInput(schema, { initial: "2.5" }));
    expect(result.current).toMatchObject({ value: 2.5, error: null, valid: true });
  });

  it("never coerces invalid input: '1O' is null + error, not 1", () => {
    const { result } = renderHook(() => useValidatedNumberInput(schema, { initial: "1" }));
    act(() => result.current.setRaw("1O"));
    expect(result.current.value).toBeNull();
    expect(result.current.valid).toBe(false);
    expect(result.current.error).toBe("Not a valid number");
    expect(result.current.inputProps["aria-invalid"]).toBe(true);
    expect(result.current.inputProps["aria-describedby"]).toBe(result.current.errorId);
  });

  it("shows 'Required' only after blur", () => {
    const { result } = renderHook(() => useValidatedNumberInput(schema));
    expect(result.current.valid).toBe(false);
    expect(result.current.error).toBeNull();
    act(() => result.current.inputProps.onBlur());
    expect(result.current.error).toBe("Required");
  });

  it("eager mode shows 'Required' immediately", () => {
    const { result } = renderHook(() => useValidatedNumberInput(schema, { eager: true }));
    expect(result.current.error).toBe("Required");
  });

  it("uses a text input with a decimal keypad (type=number accepts 1e5)", () => {
    const { result } = renderHook(() => useValidatedNumberInput(schema));
    expect(result.current.inputProps.type).toBe("text");
    expect(result.current.inputProps.inputMode).toBe("decimal");
  });

  it("cleans pasted text", () => {
    function Field() {
      const f = useValidatedNumberInput(schema);
      return (
        <>
          <input aria-label="qty" {...f.inputProps} />
          <output data-testid="value">{String(f.value)}</output>
        </>
      );
    }
    render(<Field />);
    const input = screen.getByLabelText("qty") as HTMLInputElement;
    fireEvent.paste(input, { clipboardData: { getData: () => "  12.5​\n" } });
    expect(input.value).toBe("12.5");
    expect(screen.getByTestId("value").textContent).toBe("12.5");
  });

  it("updates on typing", () => {
    function Field() {
      const f = useValidatedNumberInput(schema);
      return (
        <>
          <input aria-label="qty" {...f.inputProps} />
          {f.error && <p id={f.errorId}>{f.error}</p>}
        </>
      );
    }
    render(<Field />);
    fireEvent.change(screen.getByLabelText("qty"), { target: { value: "1e3" } });
    expect(screen.getByText("Scientific notation isn't allowed — type the full number")).toBeTruthy();
  });
});

describe("cleanPaste", () => {
  it.each([
    [" 12 ", "12"],
    ["1​2", "12"],
    ["12\r\n", "12"],
    ["﻿5", "5"],
  ])("%p → %p", (input, expected) => expect(cleanPaste(input)).toBe(expected));
});
