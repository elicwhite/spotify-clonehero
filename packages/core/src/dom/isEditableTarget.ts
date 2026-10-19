/**
 * True when an event target is (or sits inside) something the user types into.
 *
 * Any surface that installs a window-level keydown listener and swallows keys
 * has to bail on text entry, or typing in an unrelated input silently produces
 * no text. Small, pure and shared so the check has one definition.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const element = target.closest(
    'input, textarea, select, [contenteditable]',
  ) as HTMLElement | null;
  if (!element) return false;
  const contentEditable = element.getAttribute('contenteditable');
  if (contentEditable !== null) return contentEditable !== 'false';
  return true;
}
