/**
 * Encode a filesystem path for a URL query without escaping its separators.
 *
 * `/` is legal in a query string, and percent-escaping it turns a readable path
 * into %2F noise for no gain. Everything that would actually break parsing —
 * `?`, `#`, `&`, `%` — is still encoded, as is a space, because a URL a person
 * cannot copy out of a terminal in one piece is not more convenient.
 */
export function pathParam(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}
