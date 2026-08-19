import { pathParam } from "./url-path.ts";

// The two local viewer URLs myd hands to a browser. They are separate because the
// viewer accepts two different identifiers, and picking the wrong one 404s.

/** The review route: what a reviewer opens, and all a review id ever discloses. */
export function reviewViewerUrl(port: number, reviewId: string): string {
  return `http://localhost:${port}/review/${encodeURIComponent(reviewId)}`;
}

/**
 * The legacy path route, for rendering a document that is not under review.
 *
 * `myd shot` uses this rather than registering a review: a screenshot is not a review,
 * and creating one would list the document in the inbox and supersede the caller's own
 * open tab for it.
 */
export function pathViewerUrl(port: number, file: string): string {
  return `http://localhost:${port}/?path=${pathParam(file)}`;
}
