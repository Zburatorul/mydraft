export function isModifiedEnterShortcut(event) {
  return (event.metaKey || event.ctrlKey) && event.key === "Enter";
}

export function isEditorSubmitShortcut(event) {
  return isModifiedEnterShortcut(event) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r");
}
