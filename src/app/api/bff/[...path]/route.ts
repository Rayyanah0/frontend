// Backend-for-frontend proxy (#118). Every authed backend call from the
// browser comes through here. The bearer token is attached server-side from
// the encrypted httpOnly session cookie. Only allowlisted paths and methods
// are proxied (src/lib/bff/allowlist.ts), and request and response bodies
// are streamed through.
import { proxy } from "../../../../lib/bff/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> | { path: string[] } };

async function handle(req: Request, { params }: Ctx): Promise<Response> {
  const { path } = await params;
  return proxy(req, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
