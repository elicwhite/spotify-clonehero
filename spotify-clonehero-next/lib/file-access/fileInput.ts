/**
 * Open the browser's file dialog through a hidden `<input type="file">`, the
 * way to pick files or a folder in every browser. Resolves with what the user
 * picked, or null when they cancel.
 *
 * Call it straight from the click handler, before any `await`: the input's
 * `click()` needs the user's gesture, and Firefox opens nothing once that has
 * lapsed. Everything up to `click()` here is synchronous for the same reason.
 *
 * With `directory`, the dialog picks a folder and every file under it comes
 * back, each with its path below that folder in `webkitRelativePath`.
 */
export function chooseFiles(options: {
  directory?: boolean;
  multiple?: boolean;
  /** File extensions only, such as ".sng": a MIME type would let more in. */
  accept?: string[];
}): Promise<File[] | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.hidden = true;
  if (options.directory) input.webkitdirectory = true;
  if (options.multiple) input.multiple = true;
  if (options.accept) input.accept = options.accept.join(',');

  const result = new Promise<File[] | null>(resolve => {
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
  });

  // An input outside the document does not open a dialog in every browser.
  document.body.appendChild(input);
  input.click();
  return result;
}
