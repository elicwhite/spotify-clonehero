import {downloadFallbackText} from '@/components/file-access/DownloadFallbackNotice';

/** The download notice's words on this page. */
export const SONGS_FOLDER_DOWNLOAD_COPY = {
  folder: 'your Songs folder',
  action: 'Move each chart into your Songs folder, then scan again.',
} as const;

const PICK_AGAIN =
  'Your browser cannot keep access to this folder. Pick the folder again for each scan.';

/**
 * What the Local Songs Folder card says in a browser with no folder picker:
 * why a rescan asks for the folder again, and why charts download instead of
 * installing.
 */
export function NoFolderPickerNotice() {
  return (
    <>
      <span className="block">{PICK_AGAIN}</span>
      <span className="mt-1 block">
        {downloadFallbackText({
          ...SONGS_FOLDER_DOWNLOAD_COPY,
          browserIsReason: true,
        })}
      </span>
    </>
  );
}
