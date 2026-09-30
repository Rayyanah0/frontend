// BFF session endpoint (#118).
//   GET    returns the current session state and mints the CSRF cookie
//   POST   takes { wallet_address, message, signature }, verifies it with
//          the backend, and sets the httpOnly session cookie
//   DELETE signs out
// The backend bearer token is never included in a response body.
import { createSession, deleteSession, getSession } from "../../../../lib/bff/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: Request) => getSession(req);
export const POST = (req: Request) => createSession(req);
export const DELETE = (req: Request) => deleteSession(req);
