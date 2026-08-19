/**
 * Encode a filesystem path for a URL query, keeping it readable.
 *
 * `/` and a space are both legal in a query string, and escaping them turns a
 * path into %2F/%20 noise for no gain — the client percent-encodes the space on
 * the wire anyway, so the only thing the escape changes is what a person reads.
 * Everything that would actually break parsing — `?`, `#`, `&`, `%` — is encoded.
 *
 * Substituting a character (a dash, say) is not an option: this value is the path
 * the server opens, so `My-Plans` would be a different directory than `My Plans`.
 */
export function pathParam(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, "/").replace(/%20/g, " ");
}
