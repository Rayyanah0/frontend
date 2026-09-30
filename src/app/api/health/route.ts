import { NextResponse } from "next/server";

/**
 * GET /api/health
 *
 * Lightweight health-check endpoint used by Docker HEALTHCHECK and load
 * balancers.  Returns 200 as long as the Next.js server is up; no
 * backend connectivity check is performed here (the container is healthy
 * if the frontend process itself is alive).
 */
export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
