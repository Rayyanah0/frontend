"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryClientDefaults } from "../lib/api/queryPolicy";

// One QueryClient per browser session, created lazily in state so it is
// never shared across SSR requests. Queries only run client-side (they're
// gated on hydration + token), so nothing is dehydrated from the server.
// Retry policy lives in the API client (src/lib/api/resilience); see
// queryPolicy.ts for why queries don't retry ApiErrors a second time.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: queryClientDefaults }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
