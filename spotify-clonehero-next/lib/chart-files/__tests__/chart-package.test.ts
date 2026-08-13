import {
  EMPTY_FOLDER_MESSAGE,
  NOT_A_FOLDER_MESSAGE,
  SELECT_SONG_FOLDER_MESSAGE,
  readChartFileList,
} from '../chart-package';

/**
 * A file as an `<input type="file" webkitdirectory>` hands it back: named by
 * its path relative to the selected folder. jsdom's File does not populate
 * `webkitRelativePath`, so it is defined here.
 */
function directoryFile(relativePath: string, contents = 'x'): File {
  const file = new File([contents], relativePath.split('/').pop()!);
  Object.defineProperty(file, 'webkitRelativePath', {value: relativePath});
  return file;
}

async function names(files: File[]) {
  const loaded = await readChartFileList(files);
  return loaded.files.map(f => f.fileName).sort();
}

describe('readChartFileList', () => {
  it('reads the files of the selected folder', async () => {
    const loaded = await readChartFileList([
      directoryFile('Song Name/notes.chart'),
      directoryFile('Song Name/song.ini'),
      directoryFile('Song Name/song.ogg'),
    ]);

    expect(loaded.sourceFormat).toBe('folder');
    expect(loaded.originalName).toBe('Song Name');
    expect(loaded.files.map(f => f.fileName).sort()).toEqual([
      'notes.chart',
      'song.ini',
      'song.ogg',
    ]);
  });

  it('reads file contents', async () => {
    const loaded = await readChartFileList([
      directoryFile('Song Name/notes.chart', '[Song]'),
    ]);

    expect(new TextDecoder().decode(loaded.files[0].data)).toBe('[Song]');
  });

  it('does not recurse into subfolders of a folder that has its own files', async () => {
    expect(
      await names([
        directoryFile('Song Name/notes.chart'),
        directoryFile('Song Name/stems/drums.ogg'),
      ]),
    ).toEqual(['notes.chart']);
  });

  describe('when the parent of a song folder is selected', () => {
    it('reads the one song folder inside it', async () => {
      expect(
        await names([
          directoryFile('Charts/Song Name/notes.chart'),
          directoryFile('Charts/Song Name/song.ogg'),
        ]),
      ).toEqual(['notes.chart', 'song.ogg']);
    });

    it('names the chart after the folder it was read from', async () => {
      // Not "Charts": originalName is the export's filename and the project's
      // fallback song name, so it has to follow the descent.
      const loaded = await readChartFileList([
        directoryFile('Charts/Song Name/notes.chart'),
      ]);

      expect(loaded.originalName).toBe('Song Name');
    });

    it('does not recurse inside the song folder either', async () => {
      expect(
        await names([
          directoryFile('Charts/Song Name/notes.chart'),
          directoryFile('Charts/Song Name/stems/drums.ogg'),
        ]),
      ).toEqual(['notes.chart']);
    });
  });

  describe('rejects a selection it cannot place a chart in', () => {
    it('when the folder holds more than one song', async () => {
      await expect(
        readChartFileList([
          directoryFile('Charts/Song One/notes.chart'),
          directoryFile('Charts/Song Two/notes.chart'),
        ]),
      ).rejects.toThrow(SELECT_SONG_FOLDER_MESSAGE);
    });

    it('when the song folder is deeper still', async () => {
      await expect(
        readChartFileList([
          directoryFile('Library/Charts/Song Name/notes.chart'),
        ]),
      ).rejects.toThrow(SELECT_SONG_FOLDER_MESSAGE);
    });

    it('when the browser reported no folder at all', async () => {
      // A browser that ignores `webkitdirectory` returns plain files with an
      // empty webkitRelativePath. Reading nothing out of them would surface as
      // a chart parsing error, which is not what went wrong.
      await expect(
        readChartFileList([new File(['[Song]'], 'notes.chart')]),
      ).rejects.toThrow(NOT_A_FOLDER_MESSAGE);
    });

    it('when the selection is empty', async () => {
      await expect(readChartFileList([])).rejects.toThrow(EMPTY_FOLDER_MESSAGE);
    });

    it('when the folder holds only dotfiles', async () => {
      await expect(
        readChartFileList([directoryFile('Song Name/.DS_Store')]),
      ).rejects.toThrow(NOT_A_FOLDER_MESSAGE);
    });
  });

  describe('dotfiles', () => {
    it('skips them beside the chart', async () => {
      expect(
        await names([
          directoryFile('Song Name/.DS_Store'),
          directoryFile('Song Name/notes.chart'),
        ]),
      ).toEqual(['notes.chart']);
    });

    it('skips whole dot-directories', async () => {
      expect(
        await names([
          directoryFile('Charts/.git/config'),
          directoryFile('Charts/Song Name/notes.chart'),
        ]),
      ).toEqual(['notes.chart']);
    });

    it('reads a chart out of a hidden folder the user chose', async () => {
      // The filter applies below the selected folder, not to its own name: a
      // chart kept in ~/.charts is still the chart the user asked for.
      const loaded = await readChartFileList([
        directoryFile('.charts/notes.chart'),
      ]);

      expect(loaded.files.map(f => f.fileName)).toEqual(['notes.chart']);
      expect(loaded.originalName).toBe('.charts');
    });
  });
});
