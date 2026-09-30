"use client";

/**
 * Step 1 — proposal metadata: title, summary, Markdown body with a live
 * preview, and a discussion link.
 */

import type { CSSProperties } from "react";
import { MarkdownPreview } from "./MarkdownPreview";
import { Banner, EYEBROW, Field, INPUT, Panel, SectionLabel } from "./ui";
import {
  BODY_MIN,
  SUMMARY_MAX,
  TITLE_MAX,
  TITLE_MIN,
  validateUrl,
  type ProposalDraft,
} from "../../../../lib/governance/draft";

export function StepMeta({
  draft,
  errors,
  onChange,
}: {
  draft: ProposalDraft;
  errors: Record<string, string>;
  onChange: (patch: Partial<ProposalDraft>) => void;
}) {
  const bodyLength = draft.body.trim().length;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 24 }}>
        <div>
          <Field
            label="Title"
            htmlFor="proposal-title"
            help={`${draft.title.trim().length}/${TITLE_MAX} characters · minimum ${TITLE_MIN}`}
            error={errors.title}
          >
            <input
              id="proposal-title"
              value={draft.title}
              maxLength={TITLE_MAX}
              placeholder="Raise the collateral ratio to 120%"
              onChange={(e) => onChange({ title: e.target.value })}
              style={INPUT}
            />
          </Field>

          <Field
            label="Summary"
            htmlFor="proposal-summary"
            help={`One line shown in vote lists · ${draft.summary.trim().length}/${SUMMARY_MAX}`}
            error={errors.summary}
          >
            <input
              id="proposal-summary"
              value={draft.summary}
              maxLength={SUMMARY_MAX}
              placeholder="Tighten short-put risk after the volatility review"
              onChange={(e) => onChange({ summary: e.target.value })}
              style={INPUT}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="proposal-body"
            help={`Markdown supported · minimum ${BODY_MIN} characters`}
            error={errors.body}
          >
            <textarea
              id="proposal-body"
              value={draft.body}
              rows={14}
              placeholder={"## Rationale\n\nWhy this change is needed and what it affects."}
              onChange={(e) => onChange({ body: e.target.value })}
              style={{ ...INPUT, fontFamily: "var(--font-mono)", fontSize: 12, resize: "vertical", lineHeight: 1.6 }}
            />
          </Field>

          <Field
            label="Discussion link"
            htmlFor="proposal-discussion"
            help="Optional — link to the forum thread where this was debated"
            error={errors.discussionUrl}
          >
            <input
              id="proposal-discussion"
              value={draft.discussionUrl}
              placeholder="https://forum.zenith.finance/t/…"
              onChange={(e) => onChange({ discussionUrl: e.target.value })}
              style={INPUT}
            />
          </Field>
        </div>

        <div>
          <SectionLabel>Preview</SectionLabel>
          <Panel style={{ position: "sticky", top: 16, maxHeight: 520, overflowY: "auto" }}>
            {draft.title.trim() && (
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 16,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {draft.title}
              </div>
            )}
            {draft.summary.trim() && (
              <div style={{ ...EYEBROW, marginBottom: 14 }}>{draft.summary}</div>
            )}

            <div
              style={{
                borderTop: "1px solid var(--border-subtle)",
                paddingTop: 12,
                marginTop: bodyLength ? 0 : 0,
              }}
            >
              <MarkdownPreview source={draft.body} />
            </div>

            {validateUrl(draft.discussionUrl) && (
              <div style={{ marginTop: 12 }}>
                <Banner tone="warn" title="Invalid discussion link">
                  {validateUrl(draft.discussionUrl)}
                </Banner>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

export const STEP_META_LAYOUT: CSSProperties = { display: "block" };
