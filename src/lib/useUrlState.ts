"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseTerminalUrl, serializeTerminalUrl, type TerminalUrlState } from "./urlState";

/**
 * Two-way sync between view state and the query string.
 *  - state -> URL: `router.replace` for ordinary changes, `router.push` when
 *    the tab changed (so back/forward walks through tabs).
 *  - URL -> state: on back/forward (or a pasted link) the parsed URL is applied
 *    via `apply`, only when it differs from what we last wrote (no loops).
 * `scroll: false` keeps navigation from remounting or jumping the page.
 */
export function useUrlState(state: TerminalUrlState, apply: (next: TerminalUrlState) => void) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQs = params.toString();
  const lastWritten = useRef<string | null>(null);
  const prevTab = useRef(state.tab);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // URL -> state (external navigation only).
  useEffect(() => {
    if (urlQs === lastWritten.current) return;
    lastWritten.current = urlQs;
    applyRef.current(parseTerminalUrl(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQs]);

  // state -> URL.
  const desired = serializeTerminalUrl(state);
  useEffect(() => {
    if (desired === lastWritten.current || desired === urlQs) {
      prevTab.current = state.tab;
      return;
    }
    lastWritten.current = desired;
    const href = desired ? `${pathname}?${desired}` : pathname;
    const nav = prevTab.current !== state.tab ? router.push : router.replace;
    prevTab.current = state.tab;
    nav(href, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desired]);
}
