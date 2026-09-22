export type Revision = {
  number: number;
  version: string;
  createdAt: string;
};

type StoredRevision = Revision & { source?: string };
type StoredHistory = { current: StoredRevision; previous: StoredRevision | null };

/** Older installs persisted one bare Revision per path. Keep accepting that shape so an
 *  upgrade starts tracking content without resetting the human-facing revision number. */
export type RevisionSnapshot = Record<string, StoredHistory | Revision>;

function isRevision(value: unknown): value is StoredRevision {
  const revision = value as Partial<StoredRevision> | null;
  return !!revision && Number.isInteger(revision.number) && revision.number! > 0 && !!revision.version && !!revision.createdAt;
}

function publicRevision(revision: StoredRevision | null): Revision | null {
  if (!revision) return null;
  return { number: revision.number, version: revision.version, createdAt: revision.createdAt };
}

export class RevisionTracker {
  private revisions = new Map<string, StoredHistory>();

  constructor(initial: RevisionSnapshot = {}, private persist: (snapshot: RevisionSnapshot) => void = () => {}) {
    for (const [path, stored] of Object.entries(initial)) {
      if (isRevision(stored)) {
        this.revisions.set(path, { current: stored, previous: null });
        continue;
      }
      if ("current" in stored && isRevision(stored.current)) {
        this.revisions.set(path, { current: stored.current, previous: isRevision(stored.previous) ? stored.previous : null });
      }
    }
  }

  observe(path: string, version: string, createdAt = new Date().toISOString(), source?: string): Revision {
    const history = this.revisions.get(path);
    const current = history?.current;
    if (current?.version === version) {
      // Legacy snapshots know the revision label but not its source. Capture it the first
      // time the document is observed so the *next* revision can be compared to this one.
      if (source !== undefined && current.source === undefined) {
        this.revisions.set(path, { current: { ...current, source }, previous: history?.previous ?? null });
        this.persist(this.snapshot());
      }
      return publicRevision(current)!;
    }

    const revision: StoredRevision = {
      number: (current?.number ?? 0) + 1,
      version,
      createdAt,
      ...(source === undefined ? {} : { source }),
    };
    this.revisions.set(path, { current: revision, previous: current ?? null });
    this.persist(this.snapshot());
    return publicRevision(revision)!;
  }

  current(path: string): Revision | null {
    return publicRevision(this.revisions.get(path)?.current ?? null);
  }

  previous(path: string): Revision | null {
    return publicRevision(this.revisions.get(path)?.previous ?? null);
  }

  comparison(path: string): { before: Revision & { source: string }; after: Revision & { source: string } } | null {
    const history = this.revisions.get(path);
    if (!history?.previous || history.previous.source === undefined || history.current.source === undefined) return null;
    return {
      before: { ...publicRevision(history.previous)!, source: history.previous.source },
      after: { ...publicRevision(history.current)!, source: history.current.source },
    };
  }

  snapshot(): RevisionSnapshot {
    return Object.fromEntries([...this.revisions].map(([path, history]) => [path, {
      current: { ...history.current },
      previous: history.previous ? { ...history.previous } : null,
    }]));
  }
}
