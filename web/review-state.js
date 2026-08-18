const LABELS = {
  completed: "review closed",
  superseded: "outdated review",
  archived: "archived review",
  unknown: "not tracked",
};

export function reviewPresentation(status, fileName, revisionNumber) {
  const revision = revisionNumber ? `r${revisionNumber} · ` : "";
  if (status?.tracked && status.state === "active") {
    return { deprecated: false, label: "", title: `${revision}${fileName} · myd` };
  }
  const label = LABELS[status?.state] ?? "not tracked";
  return { deprecated: true, label, title: `${label} · ${revision}${fileName}` };
}
