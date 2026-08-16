export type ReviewState = "active" | "superseded" | "completed" | "unknown";

export type ReviewStatus = {
  tracked: boolean;
  state: ReviewState;
  requestedVersion: string | null;
  currentVersion: string | null;
  updatedAt: string | null;
};

type ReviewRecord = {
  id: string;
  version: string;
  active: boolean;
  updatedAt: string;
};

export class ReviewTracker {
  private records = new Map<string, ReviewRecord>();

  constructor(private createId: () => string = () => crypto.randomUUID()) {}

  track(path: string, version: string): ReviewStatus & { reviewId: string } {
    const reviewId = this.createId();
    this.records.set(path, { id: reviewId, version, active: true, updatedAt: new Date().toISOString() });
    return { ...this.status(path, reviewId, version), reviewId };
  }

  advance(path: string, version: string): ReviewStatus {
    const record = this.records.get(path);
    if (record?.active && record.version !== version) {
      this.records.set(path, { ...record, version, updatedAt: new Date().toISOString() });
    }
    return this.status(path, record?.id, version);
  }

  complete(path: string, reviewId?: string | null, version?: string): ReviewStatus {
    const record = this.records.get(path);
    if (record && (!reviewId || reviewId === record.id)) {
      this.records.set(path, {
        id: record.id,
        version: version ?? record.version,
        active: false,
        updatedAt: new Date().toISOString(),
      });
    }
    return this.status(path, reviewId, version ?? record?.version);
  }

  status(path: string, reviewId?: string | null, requestedVersion?: string | null): ReviewStatus {
    const record = this.records.get(path);
    const requested = requestedVersion || null;
    if (!record) {
      return { tracked: false, state: "unknown", requestedVersion: requested, currentVersion: null, updatedAt: null };
    }
    if (!reviewId || reviewId !== record.id) {
      return { tracked: false, state: "superseded", requestedVersion: requested, currentVersion: record.version, updatedAt: record.updatedAt };
    }
    if (!record.active) {
      return { tracked: false, state: "completed", requestedVersion: requested, currentVersion: record.version, updatedAt: record.updatedAt };
    }
    if (requested && requested !== record.version) {
      return { tracked: false, state: "superseded", requestedVersion: requested, currentVersion: record.version, updatedAt: record.updatedAt };
    }
    return { tracked: true, state: "active", requestedVersion: requested, currentVersion: record.version, updatedAt: record.updatedAt };
  }
}
