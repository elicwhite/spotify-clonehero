import {strToU8, zipSync} from 'fflate';
import {
  EMPTY_FOLDER_MESSAGE,
  ONE_CHART_AT_A_TIME_MESSAGE,
  SELECT_SONG_FOLDER_MESSAGE,
  readChartDirectory,
  readDroppedChart,
} from '../chart-package';

// ---------------------------------------------------------------------------
// Drag-and-drop fakes: the FileSystemEntry side of DataTransfer, which jsdom
// does not implement at all.
// ---------------------------------------------------------------------------

function fileEntry(name: string, contents = 'x'): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (onSuccess: (file: File) => void) =>
      setTimeout(() => onSuccess(new File([contents], name)), 0),
  } as unknown as FileSystemFileEntry;
}

function folderEntry(
  name: string,
  children: FileSystemEntry[],
): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      // The real readEntries hands back at most 100 entries per call and
      // signals the end with an empty batch, which is the only reason the
      // reader loops. Two at a time here so that loop is actually exercised,
      // and asynchronously, as the browser calls back.
      let next = 0;
      return {
        readEntries: (onSuccess: (entries: FileSystemEntry[]) => void) => {
          const batch = children.slice(next, next + 2);
          next += batch.length;
          setTimeout(() => onSuccess(batch), 0);
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

/**
 * A drop. A real DataTransfer exposes an item per dropped thing — files
 * included, each with a FileSystemFileEntry — alongside the plain file list,
 * so files are given both here rather than only a `files` entry.
 */
function drop(entries: FileSystemEntry[], files: File[] = []): DataTransfer {
  return {
    items: [
      ...entries.map(entry => ({kind: 'file', webkitGetAsEntry: () => entry})),
      ...files.map(file => ({
        kind: 'file',
        webkitGetAsEntry: () => fileEntry(file.name),
      })),
    ],
    files,
  } as unknown as DataTransfer;
}

// ---------------------------------------------------------------------------
// Directory handle fakes, for the File System Access path.
// ---------------------------------------------------------------------------

function fileHandle(name: string, contents = 'x') {
  return {
    kind: 'file' as const,
    name,
    getFile: async () => new File([contents], name),
  };
}

function directoryHandle(
  name: string,
  children: Array<ReturnType<typeof fileHandle> | {kind: 'directory'}>,
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    entries: async function* () {
      for (const child of children) {
        yield [(child as {name: string}).name, child];
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('readDroppedChart', () => {
  it('reads a dropped chart folder', async () => {
    const result = await readDroppedChart(
      drop([
        folderEntry('Song Name', [
          fileEntry('notes.chart', '[Song]'),
          fileEntry('song.ogg'),
        ]),
      ]),
    );

    expect(result.kind).toBe('chart');
    if (result.kind !== 'chart') throw new Error('expected a chart');
    expect(result.loaded.sourceFormat).toBe('folder');
    expect(result.loaded.originalName).toBe('Song Name');
    expect(result.loaded.files.map(f => f.fileName).sort()).toEqual([
      'notes.chart',
      'song.ogg',
    ]);
  });

  it('descends into a lone song folder, and names the chart after it', async () => {
    const result = await readDroppedChart(
      drop([
        folderEntry('Charts', [
          folderEntry('Song Name', [fileEntry('notes.chart')]),
        ]),
      ]),
    );

    if (result.kind !== 'chart') throw new Error('expected a chart');
    expect(result.loaded.files.map(f => f.fileName)).toEqual(['notes.chart']);
    expect(result.loaded.originalName).toBe('Song Name');
  });

  it('asks for the song folder when a folder holds several', async () => {
    await expect(
      readDroppedChart(
        drop([
          folderEntry('Charts', [
            folderEntry('Song One', [fileEntry('notes.chart')]),
            folderEntry('Song Two', [fileEntry('notes.chart')]),
          ]),
        ]),
      ),
    ).rejects.toThrow(SELECT_SONG_FOLDER_MESSAGE);
  });

  it('does not recurse past the song folder', async () => {
    const result = await readDroppedChart(
      drop([
        folderEntry('Song Name', [
          fileEntry('notes.chart'),
          folderEntry('stems', [fileEntry('drums.ogg')]),
        ]),
      ]),
    );

    if (result.kind !== 'chart') throw new Error('expected a chart');
    expect(result.loaded.files.map(f => f.fileName)).toEqual(['notes.chart']);
  });

  it('descends past a .DS_Store sitting in the parent folder', async () => {
    // The dotfile is not a file the folder "has": every Mac folder that has
    // been opened in Finder holds one, and it must not stop the descent.
    const result = await readDroppedChart(
      drop([
        folderEntry('Charts', [
          fileEntry('.DS_Store'),
          folderEntry('Song Name', [fileEntry('notes.chart')]),
        ]),
      ]),
    );

    if (result.kind !== 'chart') throw new Error('expected a chart');
    expect(result.loaded.originalName).toBe('Song Name');
    expect(result.loaded.files.map(f => f.fileName)).toEqual(['notes.chart']);
  });

  it('refuses several folders at once rather than reading one of them', async () => {
    await expect(
      readDroppedChart(
        drop([
          folderEntry('Song One', [fileEntry('notes.chart')]),
          folderEntry('Song Two', [fileEntry('notes.chart')]),
        ]),
      ),
    ).rejects.toThrow(ONE_CHART_AT_A_TIME_MESSAGE);
  });

  it('hands back a file that is not a chart package, for the caller to route', async () => {
    const song = new File(['audio'], 'song.mp3');
    const result = await readDroppedChart(drop([], [song]));

    expect(result).toEqual({kind: 'file', file: song});
  });

  it('reports an empty drop', async () => {
    expect(await readDroppedChart(drop([], []))).toEqual({kind: 'nothing'});
  });

  it('reads a dropped .zip from the plain file list', async () => {
    // A dropped *file* need not expose a filesystem entry; the plain File is
    // always there, and the archive readers only ever needed that.
    const zip = zipSync({'Song Name/notes.chart': strToU8('[Song]')});
    const result = await readDroppedChart(
      drop([], [new File([zip.slice()], 'Song Name.zip')]),
    );

    if (result.kind !== 'chart') throw new Error('expected a chart');
    expect(result.loaded.sourceFormat).toBe('zip');
    expect(result.loaded.originalName).toBe('Song Name');
    expect(result.loaded.files.map(f => f.fileName)).toEqual(['notes.chart']);
  });
});

describe('readChartDirectory', () => {
  it('reads the files of the chosen folder', async () => {
    const loaded = await readChartDirectory(
      directoryHandle('Song Name', [
        fileHandle('notes.chart', '[Song]'),
        fileHandle('song.ogg'),
      ]),
    );

    expect(loaded.originalName).toBe('Song Name');
    expect(loaded.files.map(f => f.fileName).sort()).toEqual([
      'notes.chart',
      'song.ogg',
    ]);
  });

  it('descends into a lone song folder', async () => {
    const song = directoryHandle('Song Name', [fileHandle('notes.chart')]);
    const loaded = await readChartDirectory(directoryHandle('Charts', [song]));

    expect(loaded.files.map(f => f.fileName)).toEqual(['notes.chart']);
    expect(loaded.originalName).toBe('Song Name');
  });

  it('asks for the song folder when the choice holds several', async () => {
    await expect(
      readChartDirectory(
        directoryHandle('Charts', [
          directoryHandle('Song One', [fileHandle('notes.chart')]),
          directoryHandle('Song Two', [fileHandle('notes.chart')]),
        ]),
      ),
    ).rejects.toThrow(SELECT_SONG_FOLDER_MESSAGE);
  });

  it('descends past a .DS_Store sitting in the chosen folder', async () => {
    const song = directoryHandle('Song Name', [fileHandle('notes.chart')]);
    const loaded = await readChartDirectory(
      directoryHandle('Charts', [fileHandle('.DS_Store'), song]),
    );

    expect(loaded.originalName).toBe('Song Name');
    expect(loaded.files.map(f => f.fileName)).toEqual(['notes.chart']);
  });

  it('reports an empty folder as empty', async () => {
    await expect(
      readChartDirectory(directoryHandle('Song Name', [])),
    ).rejects.toThrow(EMPTY_FOLDER_MESSAGE);
  });

  it('asks for the song folder when the chart is deeper still', async () => {
    // Two levels down is as likely to be the wrong chart as the right one.
    await expect(
      readChartDirectory(
        directoryHandle('Library', [
          directoryHandle('Charts', [
            directoryHandle('Song Name', [fileHandle('notes.chart')]),
          ]),
        ]),
      ),
    ).rejects.toThrow(SELECT_SONG_FOLDER_MESSAGE);
  });

  it('ignores subfolders of a folder that has its own files', async () => {
    const loaded = await readChartDirectory(
      directoryHandle('Song Name', [
        fileHandle('notes.chart'),
        directoryHandle('stems', [fileHandle('drums.ogg')]),
      ]),
    );

    expect(loaded.files.map(f => f.fileName)).toEqual(['notes.chart']);
  });
});
