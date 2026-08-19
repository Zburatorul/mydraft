// Public review origin: how a reviewer on another device reaches this server.
// The server itself always binds localhost; a reverse proxy or tunnel in front of it
// supplies the public origin, which myd only ever uses to *print* review URLs.

export class InvalidPublicOrigin extends Error {}

/**
 * Normalize a configured public origin to `scheme://host[:port]`.
 *
 * Returns null when nothing is configured (local-only mode, the default), so an
 * empty MYD_PUBLIC_URL is a deliberate way to force one call back to local.
 * Throws InvalidPublicOrigin for anything myd cannot honestly hand to a reviewer —
 * including a path prefix, because the viewer loads `/web` and `/api` root-relative
 * and would 404 under a proxy subpath.
 */
export function normalizePublicOrigin(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new InvalidPublicOrigin(`public URL is not a URL: ${trimmed}`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidPublicOrigin(`public URL must be http:// or https://, got ${parsed.protocol}//`);
  }
  if (parsed.search || parsed.hash) {
    throw new InvalidPublicOrigin(`public URL must not carry a query or fragment: ${trimmed}`);
  }
  if (parsed.pathname.replace(/\/+$/, "")) {
    throw new InvalidPublicOrigin(`public URL must be an origin without a path prefix (the viewer loads /web and /api from the root), got ${parsed.pathname}`);
  }
  return parsed.origin;
}

/**
 * The shareable URL for one review under a public origin. Same `/review/<id>` route
 * the local viewer already uses, so a remote reviewer's tab is the ordinary viewer.
 */
export function reviewUrl(origin: string, reviewId: string): string {
  return `${origin}/review/${encodeURIComponent(reviewId)}`;
}
