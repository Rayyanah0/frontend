"use client";

/**
 * ProfilerWrapper — thin wrapper around React's built-in <Profiler>.
 *
 * Usage:
 *   <ProfilerWrapper id="ChainTable" onSample={handleSample}>
 *     <ChainTable … />
 *   </ProfilerWrapper>
 *
 * In production builds the wrapper is a no-op passthrough so it imposes
 * zero overhead. In dev / perf builds (`react-dom/profiling`) it collects
 * timing data via the onRender callback.
 */

import { Profiler, type ProfilerOnRenderCallback } from "react";
import type { ProfileSample } from "./metrics";

interface Props {
  id: string;
  children: React.ReactNode;
  onSample?: (sample: ProfileSample) => void;
  /** Disable instrumentation for this subtree (default: false) */
  disabled?: boolean;
}

const IS_DEV =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";

export function ProfilerWrapper({ id, children, onSample, disabled = false }: Props) {
  if (!IS_DEV || disabled || !onSample) {
    return <>{children}</>;
  }

  const handleRender: ProfilerOnRenderCallback = (
    _id,
    phase,
    actualDuration,
    baseDuration,
    _startTime,
    commitTime,
  ) => {
    onSample({
      id,
      phase,
      actualDuration,
      baseDuration,
      commitTime,
    });
  };

  return (
    <Profiler id={id} onRender={handleRender}>
      {children}
    </Profiler>
  );
}
