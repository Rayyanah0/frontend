"use client";

import { Component, type ReactNode } from "react";
import { toast } from "../../lib/toast";

interface Props {
  /** Region name shown in the fallback, e.g. "Options chain". */
  region: string;
  children: ReactNode;
}

/** Contains a render crash to one page region so the rest of the terminal keeps working. */
export class RegionErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.region}]`, error);
    toast.error(`${this.props.region} failed to render.`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ padding: 16, fontSize: 12, color: "var(--text-mid)" }}>
        {this.props.region} hit an error.{" "}
        <button
          onClick={() => this.setState({ failed: false })}
          style={{ background: "transparent", color: "var(--brand)", border: "none", cursor: "pointer", textDecoration: "underline" }}
        >
          Retry
        </button>
      </div>
    );
  }
}
