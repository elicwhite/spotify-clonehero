import {isPickerCancel} from './capabilities';
import {chooseFiles} from './fileInput';

// The File System Access API's own option type (from wicg-file-system-access),
// with `id` made required so each picker remembers its own last-used location.
type PickFilesOptions = OpenFilePickerOptions & {id: string};

/**
 * Ask the user for files to read, in any browser: the File System Access
 * picker where there is one, a file input everywhere else. Resolves with the
 * chosen files, or null when the user cancels.
 *
 * Call it straight from the click handler: both dialogs need the user's
 * gesture, and the first thing this does is open one.
 */
export async function pickFiles(
  options: PickFilesOptions,
): Promise<File[] | null> {
  if (typeof window.showOpenFilePicker !== 'function') {
    return await chooseFiles({
      multiple: options.multiple ?? false,
      accept: acceptedExtensions(options.types),
    });
  }

  let handles: FileSystemFileHandle[];
  try {
    handles = await window.showOpenFilePicker(options);
  } catch (err) {
    if (isPickerCancel(err)) return null;
    throw err;
  }
  return Promise.all(handles.map(h => h.getFile()));
}

/**
 * The extensions a picker's `types` allow, for a file input's `accept`. Only
 * the extensions: the MIME keys are there for the picker, and one such as
 * `application/octet-stream` would let a file input offer any file at all.
 */
function acceptedExtensions(
  types: FilePickerAcceptType[] | undefined,
): string[] {
  return (types ?? []).flatMap(type =>
    Object.values(type.accept ?? {}).flatMap(value =>
      Array.isArray(value) ? value : [value],
    ),
  );
}
