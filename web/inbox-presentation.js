const STATUS_LABELS = {
  active: "awaiting review",
  completed: "completed",
  superseded: "outdated",
  archived: "archived",
};

/** Compact relative age. The inbox is scanned, not read, so "3h" beats a timestamp. */
export function relativeAge(iso, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** What still wants attention, as one phrase. Returns "" when there is nothing to say,
 *  so a quiet review shows no badge rather than a "0 comments" that reads like a defect. */
export function pendingLabel(unresolved) {
  if (!unresolved) return "";
  const parts = [];
  if (unresolved.comments) parts.push(`${unresolved.comments} comment${unresolved.comments === 1 ? "" : "s"}`);
  if (unresolved.suggestions) parts.push(`${unresolved.suggestions} suggestion${unresolved.suggestions === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The agent that asked for the review. `session` is a fallback identity, not a duplicate:
 *  callers that supply only a session still deserve to be told apart in the list. */
export function callerLabel(row) {
  return row.agent || row.session || "";
}

export function rowPresentation(row, now = Date.now()) {
  const unreadable = row.readable === false;
  return {
    title: row.title,
    status: row.status,
    statusLabel: unreadable ? "document missing" : (STATUS_LABELS[row.status] ?? row.status),
    // A missing document is the reviewer's problem to notice, so it outranks the lifecycle state.
    tone: unreadable ? "warn" : row.status,
    caller: callerLabel(row),
    project: row.project || "",
    age: relativeAge(row.updatedAt, now),
    revisionLabel: row.revision ? `r${row.revision}` : "",
    pending: unreadable ? "" : pendingLabel(row.unresolved),
    href: `/review/${encodeURIComponent(row.id)}`,
    // Archiving is how a reviewer clears finished work; an already-archived row has nowhere left to go.
    canArchive: row.status !== "archived",
    openable: !unreadable,
  };
}

/** Empty states differ: a first run needs onboarding, a filtered view needs a way back. */
export function emptyMessage(hasHiddenReviews) {
  return hasHiddenReviews
    ? "No reviews awaiting you. Completed and archived reviews are hidden — show all to see them."
    : "No reviews yet. Run myd view <file.md> to open one.";
}
