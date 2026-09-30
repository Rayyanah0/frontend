"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";
import { captureError } from "../lib/monitoring";

interface Props {
  children: ReactNode;
  /** Rendered when the boundary catches an error */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — wraps a subtree and reports uncaught render errors to
 * Sentry via the monitoring facade, including the React component stack.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureError(error, {
      context: "react-error-boundary",
      extra: { componentStack: info.componentStack ?? "" },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              padding: "24px",
              background: "var(--bg-raised)",
              border: "1px solid var(--put)",
              color: "var(--put)",
              fontSize: 13,
            }}
          >
            Something went wrong. Please refresh the page.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
