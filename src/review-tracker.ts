import path from "node:path";

export type ReviewState = "active" | "superseded" | "completed" | "archived" | "unknown";

export type ReviewStatus = {
  tracked: boolean;
  state: ReviewState;
  requestedVersion: string | null;
  currentVersion: string | null;
  updatedAt: string | null;
};

export type ReviewContext = {
  project?: string;
  agent?: string;
  session?: string;
  priority?: number;
};

export type ReviewLifecycleState = "active" | "superseded" | "completed" | "archived";

export type ReviewRecord = {
  id: string;
  number: number;
  path: string;
  title: string;
  status: ReviewLifecycleState;
  currentVersion: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  context: ReviewContext;
};

export type ReviewSnapshot = Record<string, ReviewRecord>;

type ReviewTrackerOptions = {
  initial?: ReviewSnapshot;
  persist?: (snapshot: ReviewSnapshot) => void;
  createId?: () => string;
  now?: () => string;
};

export class ReviewTracker {
  private records = new Map<string, ReviewRecord>();
  private nextNumber = 1;
  private persist: (snapshot: ReviewSnapshot) => void;
  private createId: () => string;
  private now: () => string;

  constructor(options: ReviewTrackerOptions | (() => string) = {}) {
    const resolved = typeof options === "function" ? { createId: options } : options;
    this.persist = resolved.persist ?? (() => {});
    this.createId = resolved.createId ?? (() => crypto.randomUUID());
    this.now = resolved.now ?? (() => new Date().toISOString());
    for (const [id, record] of Object.entries(resolved.initial ?? {})) {
      if (record?.id === id && Number.isInteger(record.number) && record.number > 0 && record.path && record.currentVersion && ["active", "superseded", "completed", "archived"].includes(record.status)) {
        this.records.set(id, { ...record, context: { ...record.context } });
        this.nextNumber = Math.max(this.nextNumber, record.number + 1);
      }
    }
  }

  track(documentPath: string, version: string, metadata: { title?: string; context?: ReviewContext } = {}): ReviewStatus & { reviewId: string } {
    const reviewId = this.createId();
    const now = this.now();
    const session = metadata.context?.session?.trim();
    if (session) {
      for (const [id, record] of this.records) {
        if (record.path === documentPath && record.status === "active" && record.context.session === session) {
          this.records.set(id, { ...record, status: "superseded", updatedAt: now });
        }
      }
    }
    this.records.set(reviewId, {
      id: reviewId,
      number: this.nextNumber++,
      path: documentPath,
      title: metadata.title?.trim() || path.basename(documentPath),
      status: "active",
      currentVersion: version,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      archivedAt: null,
      context: { ...metadata.context, ...(session ? { session } : {}) },
    });
    this.save();
    return { ...this.status(documentPath, reviewId, version), reviewId };
  }

  list(status?: ReviewRecord["status"]): ReviewRecord[] {
    return [...this.records.values()]
      .filter((record) => !status || record.status === status)
      .sort((left, right) => left.number - right.number)
      .map((record) => ({ ...record, context: { ...record.context } }));
  }

  get(reviewId: string): ReviewRecord | null {
    const record = this.records.get(reviewId);
    return record ? { ...record, context: { ...record.context } } : null;
  }

  advance(documentPath: string, version: string): ReviewStatus {
    let latest: ReviewRecord | undefined;
    for (const [id, record] of this.records) {
      if (record.path !== documentPath || record.status !== "active") continue;
      if (record.currentVersion !== version) {
        const updated = { ...record, currentVersion: version, updatedAt: this.now() };
        this.records.set(id, updated);
        latest = updated;
      } else {
        latest = record;
      }
    }
    if (latest?.currentVersion === version) this.save();
    return this.status(documentPath, latest?.id, version);
  }

  complete(documentPath: string, reviewId?: string | null, version?: string): ReviewStatus {
    const record = reviewId
      ? this.records.get(reviewId)
      : this.list("active").findLast((candidate) => candidate.path === documentPath);
    if (record?.path === documentPath && record.status === "active") {
      const now = this.now();
      this.records.set(record.id, {
        ...record,
        currentVersion: version ?? record.currentVersion,
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
      this.save();
    }
    return this.status(documentPath, reviewId ?? record?.id, version ?? record?.currentVersion);
  }

  status(documentPath: string, reviewId?: string | null, requestedVersion?: string | null): ReviewStatus {
    const record = reviewId ? this.records.get(reviewId) : undefined;
    const requested = requestedVersion || null;
    if (!record || record.path !== documentPath) {
      return { tracked: false, state: "unknown", requestedVersion: requested, currentVersion: null, updatedAt: null };
    }
    if (record.status !== "active") {
      return { tracked: false, state: record.status, requestedVersion: requested, currentVersion: record.currentVersion, updatedAt: record.updatedAt };
    }
    if (requested && requested !== record.currentVersion) {
      return { tracked: false, state: "superseded", requestedVersion: requested, currentVersion: record.currentVersion, updatedAt: record.updatedAt };
    }
    return { tracked: true, state: "active", requestedVersion: requested, currentVersion: record.currentVersion, updatedAt: record.updatedAt };
  }

  archive(reviewId: string): ReviewRecord | null {
    const record = this.records.get(reviewId);
    if (!record) return null;
    if (record.status !== "archived") {
      const now = this.now();
      this.records.set(reviewId, { ...record, status: "archived", archivedAt: now, updatedAt: now });
      this.save();
    }
    return this.get(reviewId);
  }

  snapshot(): ReviewSnapshot {
    return Object.fromEntries([...this.records].map(([id, record]) => [id, { ...record, context: { ...record.context } }]));
  }

  private save() {
    this.persist(this.snapshot());
  }
}
