"use client";

/**
 * Step 2 — the action builder.
 *
 * Contract and function come from dropdowns populated by the catalog; the
 * argument form is generated from the function's declared params, so adding a
 * governable function to the catalog needs no changes here.
 */

import { useId, useState } from "react";
import {
  GOVERNABLE_CONTRACTS,
  buildFormFields,
  dangerNote,
  describeAction,
  describeParamError,
  encodeAction,
  isActionValid,
  type FormField,
  type ProposalAction,
} from "../../../../lib/governance/actions";
import { shortActionLabel, makeAction } from "../../../../lib/governance/draft";
import { Banner, EYEBROW, INPUT, Panel, SecondaryButton, SectionLabel } from "./ui";

const SELECT: React.CSSProperties = { ...INPUT, cursor: "pointer" };

/** Render one generated field. */
function ParamInput({
  field,
  error,
  onChange,
}: {
  field: FormField;
  error?: string;
  onChange: (value: string) => void;
}) {
  if (field.options) {
    return (
      <select
        id={field.id}
        name={field.name}
        value={field.value}
        onChange={(e) => onChange(e.target.value)}
        style={SELECT}
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.multiline) {
    return (
      <textarea
        id={field.id}
        name={field.name}
        rows={3}
        value={field.value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...INPUT, fontFamily: "var(--font-mono)", fontSize: 12, resize: "vertical" }}
      />
    );
  }

  return (
    <input
      id={field.id}
      name={field.name}
      value={field.value}
      placeholder={field.placeholder}
      inputMode={field.inputMode === "numeric" ? "numeric" : "text"}
      onChange={(e) => onChange(e.target.value)}
      style={field.inputMode === "numeric" ? { ...INPUT, fontFamily: "var(--font-mono)" } : INPUT}
    />
  );
}

export function StepActions({
  actions,
  draftErrors,
  onChange,
}: {
  actions: ProposalAction[];
  draftErrors: Record<string, string>;
  onChange: (next: ProposalAction[]) => void;
}) {
  const formId = useId();

  const patch = (id: string, values: Record<string, string>) => {
    onChange(actions.map((a) => (a.id === id ? { ...a, values } : a)));
  };

  const remove = (id: string) => onChange(actions.filter((a) => a.id !== id));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 320px)", gap: 24 }}>
      <div>
        {actions.length === 0 ? (
          <Panel>
            <div style={{ ...EYEBROW, marginBottom: 6 }}>No actions yet</div>
            <p style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>
              A proposal needs at least one contract call. Add one with the form on the right — every
              value is typed and validated before it can be submitted.
            </p>
          </Panel>
        ) : (
          actions.map((action, index) => {
            const encoded = encodeAction(action);
            const errorFor = (name: string) =>
              encoded?.errors.find((e) => e.paramName === name)?.error;
            const warning = dangerNote(action);

            return (
              <Panel key={action.id} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <div style={EYEBROW}>Action {index + 1}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                      {shortActionLabel(action)}
                    </div>
                  </div>
                  <SecondaryButton onClick={() => remove(action.id)} aria-label={`Remove action ${index + 1}`}>
                    Remove
                  </SecondaryButton>
                </div>

                {warning && (
                  <div style={{ marginBottom: 14 }}>
                    <Banner tone="warn" title="This action is hard to reverse">
                      {warning}
                    </Banner>
                  </div>
                )}

                <div
                  style={{
                    borderTop: "1px solid var(--border-subtle)",
                    paddingTop: 12,
                    marginBottom: 12,
                  }}
                >
                  <SectionLabel>Summary</SectionLabel>
                  <div style={{ fontSize: 13, color: "var(--text-hi)", lineHeight: 1.6 }}>
                    {describeAction(action)}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 14 }}>
                  {buildFormFields(action, `${formId}-${index}`).map((field) => {
                    const rawError = errorFor(field.name);
                    return (
                      <div key={field.id}>
                        <label htmlFor={field.id} style={{ ...EYEBROW, display: "block", marginBottom: 5 }}>
                          {field.label}
                        </label>
                        <ParamInput
                          field={field}
                          error={rawError}
                          onChange={(value) =>
                            patch(action.id, { ...action.values, [field.name]: value })
                          }
                        />
                        {rawError && (
                          <div role="alert" style={{ fontSize: 11, color: "var(--put)", marginTop: 4 }}>
                            {describeParamError(rawError)}
                          </div>
                        )}
                        {!rawError && field.help && (
                          <div style={{ fontSize: 11, color: "var(--text-lo)", marginTop: 4 }}>
                            {field.help}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            );
          })
        )}

        {draftErrors.actions && (
          <div style={{ marginTop: 8 }}>
            <Banner tone="danger">{draftErrors.actions}</Banner>
          </div>
        )}
      </div>

      <div>
        <SectionLabel>Add an action</SectionLabel>
        <ActionPicker
          onAdd={(contractKey, functionName) => {
            onChange([...actions, makeAction(contractKey, functionName)]);
          }}
        />

        <div style={{ marginTop: 20 }}>
          <SectionLabel>Summary</SectionLabel>
          <Panel>
            {actions.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-lo)" }}>Nothing to summarise yet.</div>
            ) : (
              <ol style={{ paddingLeft: 18, margin: 0 }}>
                {actions.map((action, i) => (
                  <li
                    key={action.id}
                    style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 6, lineHeight: 1.5 }}
                  >
                    {i + 1}. {describeAction(action)}
                    {!isActionValid(action) && (
                      <span style={{ color: "var(--put)" }}> — needs attention</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Contract + function dropdowns, driven entirely by the catalog. */
function ActionPicker({
  onAdd,
}: {
  onAdd: (contractKey: string, functionName: string) => void;
}) {
  const contractId = "governance-pick-contract";
  const functionId = "governance-pick-function";
  const [contractKey, setContractKey] = useState(GOVERNABLE_CONTRACTS[0].key);
  const contract = GOVERNABLE_CONTRACTS.find((c) => c.key === contractKey) ?? GOVERNABLE_CONTRACTS[0];
  const [functionName, setFunctionName] = useState(contract.functions[0].name);

  // Keep the function selection valid when the contract changes.
  const handleContract = (key: string) => {
    setContractKey(key);
    const next = GOVERNABLE_CONTRACTS.find((c) => c.key === key);
    if (next) setFunctionName(next.functions[0].name);
  };

  return (
    <Panel>
      <label htmlFor={contractId} style={{ ...EYEBROW, display: "block", marginBottom: 5 }}>
        Contract
      </label>
      <select
        id={contractId}
        value={contractKey}
        onChange={(e) => handleContract(e.target.value)}
        style={SELECT}
      >
        {GOVERNABLE_CONTRACTS.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label} — {c.name}
          </option>
        ))}
      </select>

      <div style={{ fontSize: 11, color: "var(--text-lo)", margin: "6px 0 14px", lineHeight: 1.5 }}>
        {contract.description}
      </div>

      <label htmlFor={functionId} style={{ ...EYEBROW, display: "block", marginBottom: 5 }}>
        Function
      </label>
      <select
        id={functionId}
        value={functionName}
        onChange={(e) => setFunctionName(e.target.value)}
        style={SELECT}
      >
        {contract.functions.map((f) => (
          <option key={f.name} value={f.name}>
            {f.label}
          </option>
        ))}
      </select>

      <div style={{ fontSize: 11, color: "var(--text-lo)", margin: "6px 0 14px", lineHeight: 1.5 }}>
        {contract.functions.find((f) => f.name === functionName)?.summary}
      </div>

        <SecondaryButton onClick={() => onAdd(contractKey, functionName)} style={{ width: "100%" }}>
          + Add action
        </SecondaryButton>
    </Panel>
  );
}
