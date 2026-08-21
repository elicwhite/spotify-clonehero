import {measureProjectStorage} from '../measureProjects';
import {installFakeOPFS} from '../../drum-transcription/storage/__tests__/fake-opfs';

const opfs = installFakeOPFS();

function put(path: string, size: number): void {
  opfs.store.set(path, new ArrayBuffer(size));
}

beforeEach(() => {
  opfs.reset();
});

describe('measureProjectStorage', () => {
  it('is empty before anything is saved', async () => {
    expect(await measureProjectStorage()).toEqual({projectCount: 0, bytes: 0});
  });

  it('counts every project namespace, current and legacy', async () => {
    // A project in a legacy namespace is still the user's work and still
    // takes the disk, so a readout that skipped it would understate what is
    // stored and leave the difference looking like cache.
    put('/chart-editor/proj-a/metadata.json', 10);
    put('/chart-editor/proj-a/audio/song.opus', 90);
    put('/drum-edit/proj-b/metadata.json', 50);
    put('/drum-transcription/proj-c/metadata.json', 5);
    put('/drum-transcription/proj-c/chart/notes.chart', 25);

    expect(await measureProjectStorage()).toEqual({
      projectCount: 3,
      bytes: 180,
    });
  });

  it('counts the local database', async () => {
    put('/spotify-clonehero-local.sqlite3', 500);

    expect(await measureProjectStorage()).toEqual({
      projectCount: 0,
      bytes: 500,
    });
  });

  it('leaves the stem cache to the stem cache', async () => {
    // The fingerprint-keyed cache also lives under the drum-transcription
    // namespace. The cache measures, prunes and frees that directory itself,
    // so counting it here as well would make the rows add up to more than the
    // origin holds.
    put('/drum-transcription/proj-a/metadata.json', 10);
    put('/drum-transcription/stem-cache/fingerprint/drums.f32.gz', 9_000);

    expect(await measureProjectStorage()).toEqual({
      projectCount: 1,
      bytes: 10,
    });
  });

  it('counts a directory with no metadata, but not as a project', async () => {
    // Creating the directory and writing its metadata are two awaits, so a
    // tab closed between them leaves a directory no project list will show.
    // Its bytes are still on the disk, and this page must not disagree with
    // the project list about what a project is.
    put('/chart-editor/half-made/audio/song.opus', 400);

    expect(await measureProjectStorage()).toEqual({
      projectCount: 0,
      bytes: 400,
    });
  });

  it('counts the drum-fills database and the SQLite sidecars', async () => {
    // A -wal can reach tens of MB, and drum-fills holds the user's scan and
    // practice history. Both are their work and neither was named before.
    put('/spotify-clonehero-local.sqlite3', 100);
    put('/spotify-clonehero-local.sqlite3-wal', 50);
    put('/spotify-clonehero-local.sqlite3-shm', 10);
    put('/drum-fills.sqlite3', 200);

    expect(await measureProjectStorage()).toEqual({
      projectCount: 0,
      bytes: 360,
    });
  });

  it('answers zero rather than throwing when there is no OPFS', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: undefined,
      configurable: true,
    });

    expect(await measureProjectStorage()).toEqual({projectCount: 0, bytes: 0});
  });
});
