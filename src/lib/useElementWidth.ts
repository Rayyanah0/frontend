import { useEffect, useRef, useState } from "react";

/**
 * Measures the current width of a container so SVG charts can be responsive
 * without a charting library.
 *
 * Returns `null` until the first measurement lands, and callers fall back to
 * their declared width in that case — the server render and the first client
 * paint therefore use the exact same geometry they always did, and only a
 * *resize/mount* re-renders the chart at the container's real width.
 */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      // Very old browsers: measure once, no live updates.
      setWidth(el.getBoundingClientRect().width || null);
      return;
    }
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width ?? el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width || null);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}
