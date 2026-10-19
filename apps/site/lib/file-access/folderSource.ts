/**
 * A file inside a folder. Its `File` is opened only when something asks for
 * it, so listing a library folder never touches the audio in it.
 */
export interface FolderFile {
  kind: 'file';
  name: string;
  file: () => Promise<File>;
}

/**
 * A folder, however it was picked. Every source can list its immediate
 * children — a directory handle by iterating it, a dropped entry through its
 * reader, a `webkitdirectory` selection by grouping paths — and that is all
 * `readChartFolder` and the library scanner need.
 *
 * `list` is called only when the folder's contents are actually needed, so a
 * library folder of hundreds of songs is never enumerated past the level that
 * shows it is not one song.
 */
export interface FolderSource {
  kind: 'folder';
  name: string;
  /**
   * The File System Access handle behind the folder, or null for a drop or a
   * file input. Only a handle can be written into or kept for a later visit.
   */
  handle: FileSystemDirectoryHandle | null;
  list: () => Promise<{files: FolderFile[]; subfolders: FolderSource[]}>;
}

/** A File System Access directory handle as a folder source (Chromium). */
export function folderSourceFromHandle(
  handle: FileSystemDirectoryHandle,
): FolderSource {
  return {
    kind: 'folder',
    name: handle.name,
    handle,
    list: async () => {
      const files: FolderFile[] = [];
      const subfolders: FolderSource[] = [];
      for await (const [name, child] of handle.entries()) {
        if (child.kind === 'file') {
          const fileHandle = child as FileSystemFileHandle;
          files.push({kind: 'file', name, file: () => fileHandle.getFile()});
        } else {
          subfolders.push(
            folderSourceFromHandle(child as FileSystemDirectoryHandle),
          );
        }
      }
      return {files, subfolders};
    },
  };
}

/** One folder of a `webkitdirectory` selection, grouped from the paths. */
interface PathNode {
  files: FolderFile[];
  folders: Map<string, PathNode>;
}

function pathNodeSource(name: string, node: PathNode): FolderSource {
  return {
    kind: 'folder',
    name,
    handle: null,
    list: async () => ({
      files: node.files,
      subfolders: Array.from(node.folders, ([childName, child]) =>
        pathNodeSource(childName, child),
      ),
    }),
  };
}

/**
 * A `webkitdirectory` selection as a folder source. That input hands back
 * every file in the tree at once, each carrying its path below the chosen
 * folder in `webkitRelativePath`, so the tree is regrouped from those paths in
 * one pass. A whole Songs folder can be 184,000 files, so nothing here may
 * walk the list once per folder.
 *
 * Null when no file came with a folder path: the browser returned files, not
 * a folder, and what that means is the caller's to say.
 */
export function folderSourceFromFileList(
  selection: File[],
): FolderSource | null {
  const root: PathNode = {files: [], folders: new Map()};
  let rootName: string | null = null;

  for (const file of selection) {
    const segments = (file.webkitRelativePath ?? '').split('/');
    // A path of one segment is a file the browser reported no folder for.
    if (segments.length < 2) continue;
    rootName ??= segments[0];

    let node = root;
    for (const segment of segments.slice(1, -1)) {
      let child = node.folders.get(segment);
      if (!child) {
        child = {files: [], folders: new Map()};
        node.folders.set(segment, child);
      }
      node = child;
    }
    node.files.push({
      kind: 'file',
      name: segments[segments.length - 1],
      file: async () => file,
    });
  }

  return rootName == null ? null : pathNodeSource(rootName, root);
}
