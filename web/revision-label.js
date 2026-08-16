export function revisionLabel(revision, version, formatDate = defaultDateFormat) {
  if (!revision) return version ? `v${version}` : "";
  const hash = (version || revision.version || "").slice(0, 8);
  return `r${revision.number} · ${formatDate(revision.createdAt)}${hash ? ` · ${hash}` : ""}`;
}

export function revisionTitle(revision, version) {
  if (!revision) return version ? `Content version ${version}` : "";
  return `Revision ${revision.number}\nCreated ${new Date(revision.createdAt).toLocaleString()}\nContent hash ${version || revision.version}`;
}

function defaultDateFormat(value) {
  const date = new Date(value);
  const includeYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleString([], {
    ...(includeYear ? { year: "numeric" } : {}),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
