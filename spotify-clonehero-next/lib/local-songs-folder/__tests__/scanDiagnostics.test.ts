import {
  collectScanDiagnostics,
  describeIni,
  verdictFor,
  type ScanDiagnosticsReport,
} from '../scanDiagnostics';

const INI =
  '[Song]\nname = Secret Song\nartist = Secret Band\ncharter = Nobody\n';

function file(name: string, contents: string | Uint8Array) {
  const bytes =
    typeof contents === 'string'
      ? new TextEncoder().encode(contents)
      : contents;
  return {
    kind: 'file',
    name,
    getFile: async () => ({
      arrayBuffer: async () => bytes.buffer.slice(0),
      lastModified: 1,
    }),
  } as unknown as FileSystemFileHandle;
}

function dir(
  name: string,
  children: Array<FileSystemFileHandle | FileSystemDirectoryHandle>,
) {
  return {
    kind: 'directory',
    name,
    entries: () => ({
      async *[Symbol.asyncIterator]() {
        for (const child of children) yield [child.name, child];
      },
    }),
  } as unknown as FileSystemDirectoryHandle;
}

function utf16le(text: string) {
  const body = new Uint8Array(text.length * 2);
  const view = new DataView(body.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i), true);
  }
  return new Uint8Array([0xff, 0xfe, ...body]);
}

describe('describeIni', () => {
  it('reports shape without any value from the file', () => {
    const shape = describeIni(new TextEncoder().encode(INI));
    expect(shape).toEqual({
      byteLength: INI.length,
      encoding: 'utf-8',
      hasByteOrderMark: false,
      sectionHeaders: ['[Song]'],
      hasSongSection: true,
      hasName: true,
      hasArtist: true,
      hasCharter: true,
      badLineCount: 0,
    });
  });

  it('names the encoding of a UTF-16 file', () => {
    const shape = describeIni(utf16le(INI));
    expect(shape.encoding).toBe('utf-16le');
    expect(shape.hasByteOrderMark).toBe(true);
    expect(shape.hasSongSection).toBe(true);
  });

  // A corrupt file can hold anything between brackets, and the report is
  // pasted into a public thread.
  it('redacts a section header that is not plain letters', () => {
    const shape = describeIni(
      new TextEncoder().encode('[C:\\Users\\someone\\Music]\nname = x\n'),
    );
    expect(shape.sectionHeaders).toEqual(['[?]']);
  });
});

describe('collectScanDiagnostics', () => {
  const chart = (name: string, iniName = 'song.ini') =>
    dir(name, [
      file(iniName, INI),
      file('notes.chart', ''),
      file('song.ogg', ''),
    ]);

  it('reports a library the scan can read', async () => {
    const root = dir('Songs', [chart('Band - Track (Charter)')]);
    const report = await collectScanDiagnostics(root);

    expect(report.chartsScannable).toBe(1);
    expect(report.chartsMissed).toBe(0);
    expect(report.rootIsChart).toBe(false);
    expect(report.sample[0].songIni).toBe('exact');
    expect(report.sample[0].extensions).toEqual({ini: 1, chart: 1, ogg: 1});
  });

  it('names a song.ini the scan would skip for its spelling', async () => {
    const root = dir('Songs', [chart('Band - Track', 'Song.ini')]);
    const report = await collectScanDiagnostics(root);

    expect(report.chartsScannable).toBe(0);
    expect(report.chartsMissed).toBe(1);
    expect(report.sample[0].songIni).toBe('case-mismatch');
    expect(report.sample[0].songIniName).toBe('Song.ini');
    expect(report.verdict).toContain('spells song.ini differently');
  });

  it('says when the picked folder is itself a chart', async () => {
    const report = await collectScanDiagnostics(chart('Band - Track'));

    expect(report.rootIsChart).toBe(true);
    expect(report.verdict).toContain('is itself a chart');
  });

  it('records a directory the browser refuses to list', async () => {
    const blocked = {
      kind: 'directory',
      name: 'Blocked',
      entries: () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    } as unknown as FileSystemDirectoryHandle;
    const report = await collectScanDiagnostics(dir('Songs', [blocked]));

    expect(report.listingErrors).toEqual([
      {depth: 1, error: 'NotAllowedError: Permission denied'},
    ]);
  });

  it('counts .sng files without sampling them', async () => {
    const root = dir('Songs', [file('Band - Track.sng', '')]);
    const report = await collectScanDiagnostics(root);

    expect(report.sngFilesFound).toBe(1);
    expect(report.sample).toEqual([]);
    expect(report.verdict).toContain('no chart folders');
  });

  // The whole point of the page is that it can be pasted in public.
  it('leaks no folder name, song name, artist, or charter', async () => {
    const root = dir('Songs', [
      dir('Secret Artist', [chart('Secret Song (Secret Charter)')]),
    ]);
    const report = await collectScanDiagnostics(root);
    const json = JSON.stringify(report);

    for (const secret of [
      'Secret Song',
      'Secret Band',
      'Secret Artist',
      'Secret Charter',
      'Nobody',
      'notes.chart',
      'song.ogg',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(report.chartsScannable).toBe(1);
  });
});

describe('verdictFor', () => {
  const base: Omit<ScanDiagnosticsReport, 'verdict'> = {
    version: 1,
    userAgent: '',
    platform: '',
    rootIsChart: false,
    rootEntryCount: 5,
    directoriesVisited: 1,
    listingErrors: [],
    sngFilesFound: 0,
    chartsScannable: 0,
    chartsMissed: 0,
    maxDepthSeen: 0,
    pathsNearWindowsLimit: 0,
    sample: [],
    stoppedEarly: null,
    depthLimitHit: false,
  };

  it('leads with an empty root, which explains every other zero', () => {
    expect(verdictFor({...base, rootEntryCount: 0})).toContain('no entries');
  });

  it('points past the folder walk when the charts look readable', () => {
    expect(verdictFor({...base, chartsScannable: 3})).toContain(
      'after the folder walk',
    );
  });

  // Concluding "no charts here" from a tree that was only partly read is the
  // one answer this page must never give.
  it('refuses to conclude an absence from a walk that stopped early', () => {
    expect(
      verdictFor({...base, stoppedEarly: 'directory-limit', sngFilesFound: 9}),
    ).toContain('larger than the check reads');
    expect(
      verdictFor({...base, depthLimitHit: true, sngFilesFound: 9}),
    ).toContain('nested further down');
  });
});
