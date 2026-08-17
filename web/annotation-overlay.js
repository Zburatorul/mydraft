export function clickAwayDismissal(target, editor, popover) {
  if (editor.contains(target) || popover.contains(target)) return null;
  if (!editor.hidden) return editor;
  if (!popover.hidden) return popover;
  return null;
}
