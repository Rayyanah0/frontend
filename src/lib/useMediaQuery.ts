import { useMemo, useSyncExternalStore } from "react";

// Compact-terminal breakpoint: at and below this width the app switches to
// the mobile/tablet layout (single-side chain, bottom-sheet ticket, cards).
// Keep in sync with the `@media (max-width: 1023px)` blocks in globals.css.
export const COMPACT_QUERY = "(max-width: 1023px)";
export const PHONE_QUERY = "(max-width: 767px)";

function subscribeTo(query: string) {
  return (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    // Safari < 14 only has the deprecated addListener — feature-detect both so
    // the layout still reacts on older iOS WebViews.
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  };
}

const snapFalse = () => false;

/**
 * SSR-safe media query hook.
 *
 * Server *and* hydration render with `false` (React's getServerSnapshot), so
 * the first client paint matches the server HTML; the real value lands in the
 * commit right after hydration. That's what keeps the desktop markup
 * unchanged in the DOM tree while phones get the compact one.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useMemo(() => subscribeTo(query), [query]);
  const getSnapshot = useMemo(
    () => () => (typeof window !== "undefined" && !!window.matchMedia ? window.matchMedia(query).matches : false),
    [query]
  );
  return useSyncExternalStore(subscribe, getSnapshot, snapFalse);
}

/** True for phones *and* tablets in portrait — i.e. the compact terminal. */
export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}
