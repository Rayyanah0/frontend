"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// One QueryClient per browser session, created lazily in state so it is
// never shared across SSR requests. Queries only run client-side (they're
// gated on hydration + token), so nothing is dehydrated from the server.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: 1, refetchOnWindowFocus: false } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
