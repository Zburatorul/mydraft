import { shortReviewId } from "./review-id.ts";

/**
 * Short stand-ins for document paths, so a viewer URL carries no filesystem text.
 *
 * `myd view` already avoids paths by addressing a review; this covers the one case
 * that has no review — `myd shot`, which renders a document without opening one.
 * A handle escapes to nothing in a URL, whatever the file is called, which a path
 * cannot promise: spaces, unicode and `#` all survive in real filenames.
 *
 * Handles live in memory and last as long as the server. They are not secrets and
 * not durable — losing one costs a re-render, not a review.
 */
export class DocumentHandles {
  private pathByHandle = new Map<string, string>();
  private handleByPath = new Map<string, string>();

  constructor(private createId: () => string = shortReviewId) {}

  /** The handle for a path, minted once and then reused, so re-rendering is stable. */
  for(documentPath: string): string {
    const existing = this.handleByPath.get(documentPath);
    if (existing) return existing;
    let handle = this.createId();
    for (let attempt = 0; attempt < 8 && this.pathByHandle.has(handle); attempt++) handle = this.createId();
    this.pathByHandle.set(handle, documentPath);
    this.handleByPath.set(documentPath, handle);
    return handle;
  }

  pathFor(handle: string | null | undefined): string | null {
    if (!handle) return null;
    return this.pathByHandle.get(handle) ?? null;
  }
}
