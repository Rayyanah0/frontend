/**
 * Dev-only layout for the __perf benchmark harness.
 *
 * This route is excluded from production bundles via next.config.js
 * (see the `excludeRoutes` pattern). A belt-and-suspenders runtime
 * check redirects any production traffic.
 */
import { redirect } from "next/navigation";

export const metadata = {
  title: "Perf Harness | Zenith [dev]",
  robots: { index: false, follow: false },
};

export default function PerfLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") {
    redirect("/");
  }

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0d0d0f", color: "#e2e8f0", fontFamily: "monospace" }}>
        {children}
      </body>
    </html>
  );
}
