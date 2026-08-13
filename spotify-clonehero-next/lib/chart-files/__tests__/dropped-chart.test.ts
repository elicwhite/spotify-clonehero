import {strToU8, zipSync} from 'fflate';
import {
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
      onSuccess(new File([contents], name)),
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
      // readEntries is batched: it yields its children once, then an empty
      // array to signal the end. Reproduced so the reader's loop is exercised.
      let drained = false;
      return {
        readEntries: (onSuccess: (entries: FileSystemEntry[]) => void) => {
          const batch = drained ? [] : children;
          drained = true;
          onSuccess(batch);
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

function drop(entries: FileSystemEntry[], files: File[] = []): DataTransfer {
  return {
    items: entries.map(entry => ({
      kind: 'file',
      webkitGetAsEntry: () => entry,
    })),
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
      drop([], [new File([zip], 'Song Name.zip')]),
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
