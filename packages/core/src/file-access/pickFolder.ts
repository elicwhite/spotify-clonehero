import {isPickerCancel, supportsDirectoryPicker} from './capabilities';
import {chooseFiles} from './fileInput';
import {
  folderSourceFromFileList,
  folderSourceFromHandle,
  type FolderSource,
} from './folderSource';

export const NOT_A_FOLDER_MESSAGE =
  'Your browser is missing features required to open a folder.';

/**
 * Ask the user for a folder, in any browser: the folder picker where
 * there is one, a `webkitdirectory` file input everywhere else. Resolves with
 * null when the user cancels or picks a folder with nothing in it, and
 * rejects when the browser hands back files instead of a folder.
 *
 * A file input gives no handle, so the result can be written into only where
 * it has one (`handle` is not null). Ask for `mode: 'readwrite'` up front when
 * the caller will write, so the picker asks for both at once.
 *
 * Call it straight from the click handler: both dialogs need the user's
 * gesture, and the first thing this does is open one.
 */
export async function pickFolder(options: {
  /** Lets the picker reopen where this control last left it. */
  id: string;
  mode?: FileSystemPermissionMode;
}): Promise<FolderSource | null> {
  if (!supportsDirectoryPicker()) {
    const files = await chooseFiles({directory: true});
    if (!files) return null;
    const folder = folderSourceFromFileList(files);
    // Files with no folder path: the browser ignored `webkitdirectory`.
    if (!folder && files.length > 0) throw new Error(NOT_A_FOLDER_MESSAGE);
    return folder;
  }
  try {
    return folderSourceFromHandle(await window.showDirectoryPicker(options));
  } catch (error) {
    if (isPickerCancel(error)) return null;
    throw error;
  }
}
