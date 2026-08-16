export type Revision = {
  number: number;
  version: string;
  createdAt: string;
};

export type RevisionSnapshot = Record<string, Revision>;

export class RevisionTracker {
  private revisions = new Map<string, Revision>();

  constructor(initial: RevisionSnapshot = {}, private persist: (snapshot: RevisionSnapshot) => void = () => {}) {
    for (const [path, revision] of Object.entries(initial)) {
      if (Number.isInteger(revision?.number) && revision.number > 0 && revision.version && revision.createdAt) {
        this.revisions.set(path, revision);
      }
    }
  }

  observe(path: string, version: string, createdAt = new Date().toISOString()): Revision {
    const current = this.revisions.get(path);
    if (current?.version === version) return current;

    const revision = {
      number: (current?.number ?? 0) + 1,
      version,
      createdAt,
    };
    this.revisions.set(path, revision);
    this.persist(this.snapshot());
    return revision;
  }

  current(path: string): Revision | null {
    return this.revisions.get(path) ?? null;
  }

  snapshot(): RevisionSnapshot {
    return Object.fromEntries(this.revisions);
  }
}
