// Review inbox: the one place a reviewer discovers work across every agent and document.
// Assembling a row is kept separate from serving it so the ordering and counting rules
// can be tested without a server, a browser, or a document on disk.
import type { ReviewItem } from "./doc.ts";
import type { ReviewLifecycleState, ReviewRecord } from "./review-tracker.ts";

// Reviews the reviewer has finished with, or that were replaced under them, would bury the
// work that is still live. They stay reachable through an explicit `status` filter.
const DEFAULT_STATUSES: ReviewLifecycleState[] = ["active", "completed"];
const ORDER: Record<ReviewLifecycleState, number> = { active: 0, completed: 1, superseded: 2, archived: 3 };

export type UnresolvedCounts = { comments: number; suggestions: number };

export type InboxRow = {
  id: string;
  number: number;
  title: string;
  status: ReviewLifecycleState;
  agent: string | null;
  session: string | null;
  project: string | null;
  priority: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  revision: number | null;
  unresolved: UnresolvedCounts | null; // null when the document could not be read
  readable: boolean;
};

/** What still wants the reviewer's attention: roots only, since a reply rides on its parent. */
export function unresolvedCounts(items: readonly ReviewItem[]): UnresolvedCounts {
  const counts = { comments: 0, suggestions: 0 };
  for (const item of items) {
    if (item.kind === "reply" || item.status === "resolved") continue;
    if (item.kind === "suggestion") counts.suggestions++;
    else if (item.kind === "comment") counts.comments++;
  }
  return counts;
}

export type DocumentFacts = { revision: number | null; items: readonly ReviewItem[] } | null;

/** `facts` is null when the document is gone or unreadable — the review still belongs in the
 *  inbox, because a reviewer needs to see that it went stale rather than silently lose it. */
export function inboxRow(record: ReviewRecord, facts: DocumentFacts): InboxRow {
  return {
    id: record.id,
    number: record.number,
    title: record.title,
    status: record.status,
    agent: record.context.agent ?? null,
    session: record.context.session ?? null,
    project: record.context.project ?? null,
    priority: typeof record.context.priority === "number" ? record.context.priority : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    revision: facts?.revision ?? null,
    unresolved: facts ? unresolvedCounts(facts.items) : null,
    readable: !!facts,
  };
}

export function isDefaultVisible(status: ReviewLifecycleState): boolean {
  return DEFAULT_STATUSES.includes(status);
}

/** Live work first, then finished work; within a group the most recently touched first, so a
 *  reviewer's next action is always at the top. `number` breaks ties for a stable order. */
export function sortInbox(rows: readonly InboxRow[]): InboxRow[] {
  return [...rows].sort((left, right) =>
    ORDER[left.status] - ORDER[right.status] ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.number - left.number);
}
