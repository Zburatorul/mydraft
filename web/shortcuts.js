export function isEditorSubmitShortcut(event) {
  return (event.metaKey || event.ctrlKey) && (event.key === "Enter" || event.key.toLowerCase() === "r");
}
