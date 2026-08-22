import {deleteStoredProject, measureProjectStorage} from '../storedProjects';
import {installFakeOPFS} from '../../drum-transcription/storage/__tests__/fake-opfs';

const opfs = installFakeOPFS();

/** The fake, so a test that removes `navigator.storage` can put it back. */
const fakeStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')!;

function put(path: string, size: number): void {
  opfs.store.set(path, new ArrayBuffer(size));
}

function putText(path: string, text: string): void {
  opfs.store.set(path, new TextEncoder().encode(text).buffer as ArrayBuffer);
}

/** A project with readable metadata, plus one audio file of `size`. */
function putProject(
  path: string,
  metadata: Record<string, unknown>,
  size: number,
): void {
  putText(`${path}/metadata.json`, JSON.stringify(metadata));
  put(`${path}/audio/song.opus`, size);
}

beforeEach(() => {
  opfs.reset();
  Object.defineProperty(navigator, 'storage', fakeStorage);
});

describe('measureProjectStorage', () => {
  it('is empty before anything is saved', async () => {
    expect(await measureProjectStorage()).toEqual({
      projects: [],
      databaseBytes: 0,
      bytes: 0,
    });
  });

  it('describes each project, across current and legacy namespaces', async () => {
    // A project in a legacy namespace is still the user's work and still takes
    // the disk, so a page that skipped it would understate what is stored and
    // leave the difference looking like cache.
    putProject(
      '/chart-editor/a',
      {
        name: 'Song One',
        artist: 'Band',
        updatedAt: '2026-01-02T03:04:05.000Z',
        stemFingerprint: 'fp-1',
      },
      900,
    );
    putProject('/drum-edit/b', {name: 'Song Two', artist: 'Other'}, 400);

    const {projects, bytes} = await measureProjectStorage();

    expect(projects).toEqual([
      expect.objectContaining({
        id: 'a',
        namespace: 'chart-editor',
        name: 'Song One',
        artist: 'Band',
        updatedAt: '2026-01-02T03:04:05.000Z',
        stemFingerprint: 'fp-1',
        isProject: true,
      }),
      expect.objectContaining({
        id: 'b',
        namespace: 'drum-edit',
        name: 'Song Two',
        stemFingerprint: null,
        isProject: true,
      }),
    ]);
    // Metadata bytes count too: they are on the disk.
    expect(bytes).toBe(
      projects.reduce((total, project) => total + project.sizeBytes, 0),
    );
  });

  it('lists a directory with no metadata, but not as a project', async () => {
    // Creating the directory and writing its metadata are two awaits, so a tab
    // closed between them leaves one behind. Its bytes are real and it can be
    // deleted, but no project list will show it and this page must not
    // disagree with them about what a project is.
    put('/chart-editor/half-made/audio/song.opus', 400);

    const {projects} = await measureProjectStorage();

    expect(projects).toEqual([
      expect.objectContaining({
        id: 'half-made',
        name: 'half-made',
        isProject: false,
        sizeBytes: 400,
      }),
    ]);
  });

  it('survives metadata that is not valid JSON', async () => {
    putText('/chart-editor/broken/metadata.json', '{ not json');
    put('/chart-editor/broken/audio/song.opus', 100);

    const {projects} = await measureProjectStorage();

    expect(projects[0]).toEqual(
      expect.objectContaining({name: 'broken', isProject: false}),
    );
  });

  it('leaves the stem cache to the stem cache', async () => {
    // The cache measures, prunes and frees that directory itself. Counting it
    // here as well would make the parts add up to more than the whole.
    putProject('/drum-transcription/a', {name: 'Song'}, 10);
    put('/drum-transcription/stem-cache/fingerprint/drums.f32.gz', 9_000);

    const {projects} = await measureProjectStorage();

    expect(projects.map(project => project.id)).toEqual(['a']);
  });

  it('counts both databases and the SQLite sidecars', async () => {
    // A -wal can reach tens of MB, and drum-fills holds the user's scan and
    // practice history. Both are their work.
    put('/spotify-clonehero-local.sqlite3', 100);
    put('/spotify-clonehero-local.sqlite3-wal', 50);
    put('/spotify-clonehero-local.sqlite3-shm', 10);
    put('/drum-fills.sqlite3', 200);

    expect(await measureProjectStorage()).toEqual({
      projects: [],
      databaseBytes: 360,
      bytes: 360,
    });
  });

  it('answers empty rather than throwing when there is no OPFS', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: undefined,
      configurable: true,
    });

    expect(await measureProjectStorage()).toEqual({
      projects: [],
      databaseBytes: 0,
      bytes: 0,
    });
  });
});

describe('deleteStoredProject', () => {
  it('removes exactly one project', async () => {
    putProject('/chart-editor/a', {name: 'Keep'}, 100);
    putProject('/chart-editor/b', {name: 'Drop'}, 100);

    expect(await deleteStoredProject('chart-editor', 'b')).toBe(true);

    const {projects} = await measureProjectStorage();
    expect(projects.map(project => project.id)).toEqual(['a']);
  });

  it('reports false for a project that was never there', async () => {
    expect(await deleteStoredProject('chart-editor', 'missing')).toBe(false);
  });
});
