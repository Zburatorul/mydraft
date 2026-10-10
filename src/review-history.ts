import { buildReviewChangeSet, type ReviewChangeSet } from "./review-change-set.ts";
import type { Revision } from "./revision-tracker.ts";

export type ArchivedReview = {
  reviewId: string;
  path: string;
  title: string;
  version: string;
  source: string;
  completedAt: string;
  revision: Revision | null;
};

export type ReviewHistorySnapshot = {
  archives: Record<string, ArchivedReview>;
  predecessors: Record<string, string>;
};

export type ReviewComparison = {
  predecessorReviewId: string;
  before: { version: string; revision: Revision | null };
  changeSet: ReviewChangeSet;
};

type ReviewHistoryOptions = {
  initial?: ReviewHistorySnapshot;
  persist?: (snapshot: ReviewHistorySnapshot) => void;
};

const EMPTY: ReviewHistorySnapshot = { archives: {}, predecessors: {} };

export class ReviewHistory {
  private archives = new Map<string, ArchivedReview>();
  private predecessors = new Map<string, string>();
  private persist: (snapshot: ReviewHistorySnapshot) => void;

  constructor(options: ReviewHistoryOptions = {}) {
    this.persist = options.persist ?? (() => {});
    for (const [reviewId, archive] of Object.entries(options.initial?.archives ?? EMPTY.archives)) {
      if (archive?.reviewId === reviewId && archive.path && archive.version && typeof archive.source === "string") {
        this.archives.set(reviewId, { ...archive, revision: archive.revision ? { ...archive.revision } : null });
      }
    }
    for (const [reviewId, predecessorReviewId] of Object.entries(options.initial?.predecessors ?? EMPTY.predecessors)) {
      if (reviewId && predecessorReviewId) this.predecessors.set(reviewId, predecessorReviewId);
    }
  }

  complete(archive: ArchivedReview): void {
    const existing = this.archives.get(archive.reviewId);
    if (existing) {
      const sameFrozenContent = existing.path === archive.path
        && existing.title === archive.title
        && existing.version === archive.version
        && existing.source === archive.source
        && JSON.stringify(existing.revision) === JSON.stringify(archive.revision);
      if (sameFrozenContent) return;
      throw new Error(`Review ${archive.reviewId} is already frozen.`);
    }
    const frozen = { ...archive, revision: archive.revision ? { ...archive.revision } : null };
    const snapshot = this.snapshot();
    snapshot.archives[archive.reviewId] = frozen;
    this.persist(snapshot);
    this.archives.set(archive.reviewId, frozen);
  }

  link(input: { reviewId: string; predecessorReviewId: string; path: string }): void {
    const predecessor = this.archives.get(input.predecessorReviewId);
    if (!predecessor) throw new Error("Predecessor review has no completed snapshot.");
    if (predecessor.path !== input.path) throw new Error("Predecessor review belongs to a different document.");
    this.predecessors.set(input.reviewId, input.predecessorReviewId);
    this.save();
  }

  archive(reviewId: string): ArchivedReview | null {
    const archive = this.archives.get(reviewId);
    return archive ? { ...archive, revision: archive.revision ? { ...archive.revision } : null } : null;
  }

  /** The most recently completed review of a document: the predecessor a successor gets when
   *  its caller names none, so an agent need not carry a review id across turns. */
  latestFor(path: string): ArchivedReview | null {
    let latest: ArchivedReview | undefined;
    for (const archive of this.archives.values()) {
      if (archive.path === path && (!latest || archive.completedAt > latest.completedAt)) latest = archive;
    }
    return latest ? this.archive(latest.reviewId) : null;
  }

  predecessor(reviewId: string): string | null {
    return this.predecessors.get(reviewId) ?? null;
  }

  comparison(reviewId: string, afterSource: string): ReviewComparison | null {
    const predecessorReviewId = this.predecessor(reviewId);
    const before = predecessorReviewId ? this.archive(predecessorReviewId) : null;
    if (!predecessorReviewId || !before) return null;
    return {
      predecessorReviewId,
      before: { version: before.version, revision: before.revision },
      changeSet: buildReviewChangeSet({ beforeSource: before.source, afterSource }),
    };
  }

  snapshot(): ReviewHistorySnapshot {
    return {
      archives: Object.fromEntries([...this.archives].map(([reviewId, archive]) => [reviewId, {
        ...archive,
        revision: archive.revision ? { ...archive.revision } : null,
      }])),
      predecessors: Object.fromEntries(this.predecessors),
    };
  }

  private save() {
    this.persist(this.snapshot());
  }
}
