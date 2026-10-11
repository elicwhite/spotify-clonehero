import {isPickerCancel, supportsDirectoryPicker} from './capabilities';
import {chooseFiles} from './fileInput';
import {
  folderSourceFromFileList,
  folderSourceFromHandle,
  type FolderSource,
} from './folderSource';

/**
 * Ask the user for a folder to read, in any browser: the folder picker where
 * there is one, a `webkitdirectory` file input everywhere else. Resolves with
 * null when the user cancels or picks a folder with nothing in it.
 *
 * For reading only. A folder the site must write into or keep for a later
 * visit needs the picker's handle, which a file input cannot give.
 *
 * Call it straight from the click handler: both dialogs need the user's
 * gesture, and the first thing this does is open one.
 */
export async function pickFolder(options: {
  /** Lets the picker reopen where this control last left it. */
  id: string;
}): Promise<FolderSource | null> {
  if (!supportsDirectoryPicker()) {
    const files = await chooseFiles({directory: true});
    return files && folderSourceFromFileList(files);
  }
  try {
    return folderSourceFromHandle(
      await window.showDirectoryPicker({id: options.id}),
    );
  } catch (error) {
    if (isPickerCancel(error)) return null;
    throw error;
  }
}
