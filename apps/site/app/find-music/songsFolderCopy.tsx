/**
 * What the Local Songs Folder card says in a browser with no folder picker:
 * why every scan asks for the folder, and why charts download instead of
 * installing.
 */
export const NO_FOLDER_PICKER_TEXT =
  'Your browser requires choosing this folder for each scan, and cannot save directly to it. Consider using Chrome.';

export function NoFolderPickerNotice() {
  return <span className="block">{NO_FOLDER_PICKER_TEXT}</span>;
}
