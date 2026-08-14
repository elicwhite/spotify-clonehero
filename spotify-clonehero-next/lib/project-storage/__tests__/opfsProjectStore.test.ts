import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import {createOpfsProjectStore} from '../opfsProjectStore';
import {chartTextOf} from './chartText';

describe('createOpfsProjectStore', () => {
  beforeEach(() => {
    installFakeOPFS();
  });

  it('stores the provenance and anchor the caller was already holding', async () => {
    const store = createOpfsProjectStore('test-namespace');
    const provenance = {difficulties: {stamp: 'abc', generatedAt: '2026-01-01'}};

    const meta = await store.createProject({
      name: 'Generated',
      artist: 'A',
      charter: 'C',
      sourceFormat: 'folder',
      originalName: 'generated',
      chartFile: {
        fileName: 'notes.chart',
        data: new TextEncoder().encode('[Song]\n{\n}\n'),
      },
      audioFiles: [],
      allFiles: [],
      audioAnchor: {tick: 192, ms: 500},
      assistProvenance: provenance as never,
    });

    const reread = await store.getProject(meta.id);
    expect(reread.audioAnchor).toEqual({tick: 192, ms: 500});
    expect(reread.assistProvenance).toEqual(provenance);
  });

  describe('chart file format', () => {
    /** A MIDI header plus one empty track — enough to prove the bytes are
     *  stored and read back without a text round trip. */
    const MID_BYTES = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60, 0x4d, 0x54, 0x72,
      0x6b, 0, 0, 0, 4, 0, 0xff, 0x2f, 0x00,
    ]);

    async function createMidProject() {
      const store = createOpfsProjectStore('test-namespace');
      const meta = await store.createProject({
        name: 'Midi Song',
        artist: 'A',
        charter: 'C',
        sourceFormat: 'folder',
        originalName: 'midi-song',
        chartFile: {fileName: 'notes.mid', data: MID_BYTES},
        audioFiles: [],
        allFiles: [{fileName: 'notes.mid', data: MID_BYTES}],
      });
      return {store, meta};
    }

    it('keeps a MIDI chart as .mid and returns the same bytes', async () => {
      const {store, meta} = await createMidProject();

      expect(meta.chartFileFormat).toBe('mid');
      expect(await store.chartFormatOf(meta.id)).toBe('mid');

      const chart = await store.readChartFile(meta.id);
      expect(chart.fileName).toBe('notes.mid');
      expect(Array.from(chart.data)).toEqual(Array.from(MID_BYTES));
    });

    it("writes a MIDI project's autosave to notes.edited.mid", async () => {
      const {store, meta} = await createMidProject();
      const edited = new Uint8Array([...MID_BYTES, 0x00]);

      await store.writeEditedChart(meta.id, {
        fileName: 'notes.mid',
        data: edited,
      });

      const chart = await store.readChartFile(meta.id);
      expect(chart.fileName).toBe('notes.edited.mid');
      expect(Array.from(chart.data)).toEqual(Array.from(edited));
    });

    it('reads a project written before the format was recorded as .chart', async () => {
      const store = createOpfsProjectStore('test-namespace');
      const meta = await store.createProject({
        name: 'Legacy',
        artist: 'A',
        charter: 'C',
        sourceFormat: 'folder',
        originalName: 'legacy',
        chartFile: {
          fileName: 'notes.chart',
          data: new TextEncoder().encode('[Song]\n{\n}\n'),
        },
        audioFiles: [],
        allFiles: [],
      });
      // Strip the field the way a project written before it existed has it.
      await store.updateProject(meta.id, {chartFileFormat: undefined});

      expect(await store.chartFormatOf(meta.id)).toBe('chart');
      expect(await chartTextOf(store, meta.id)).toBe('[Song]\n{\n}\n');
    });
  });

  it('creates, lists, reads, and deletes a project', async () => {
    const store = createOpfsProjectStore('test-namespace');

    const meta = await store.createProject({
      name: 'My Song',
      artist: 'My Artist',
      charter: 'My Charter',
      durationSeconds: 120,
      sourceFormat: 'sng',
      originalName: 'my-song.sng',
      chartFile: {
        fileName: 'notes.chart',
        data: new TextEncoder().encode('[Song]\n{\n}\n'),
      },
      audioFiles: [{fileName: 'guitar.ogg', data: new Uint8Array([1, 2, 3])}],
      allFiles: [
        {fileName: 'notes.chart', data: new Uint8Array([9])},
        {fileName: 'guitar.ogg', data: new Uint8Array([1, 2, 3])},
        {fileName: 'song.ini', data: new Uint8Array([5])},
      ],
    });

    expect(meta.name).toBe('My Song');

    const list = await store.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(meta.id);

    const fetched = await store.getProject(meta.id);
    expect(fetched).toEqual(meta);

    const chartText = await chartTextOf(store, meta.id);
    expect(chartText).toBe('[Song]\n{\n}\n');

    const audioFiles = await store.loadAudioFiles(meta.id);
    expect(audioFiles).toHaveLength(1);
    expect(audioFiles[0].fileName).toBe('guitar.ogg');

    await store.deleteProject(meta.id);
    expect(await store.listProjects()).toHaveLength(0);
  });

  it('prefers the edited chart over the original once written', async () => {
    const store = createOpfsProjectStore('test-namespace');
    const meta = await store.createProject({
      name: 'Song',
      artist: 'Artist',
      charter: 'Charter',
      durationSeconds: 60,
      sourceFormat: 'sng',
      originalName: 'song.sng',
      chartFile: {
        fileName: 'notes.chart',
        data: new TextEncoder().encode('original'),
      },
      audioFiles: [],
      allFiles: [{fileName: 'notes.chart', data: new Uint8Array([1])}],
    });

    expect(await chartTextOf(store, meta.id)).toBe('original');

    await store.writeEditedChart(meta.id, {
      fileName: 'notes.chart',
      data: new TextEncoder().encode('edited'),
    });
    expect(await chartTextOf(store, meta.id)).toBe('edited');

    // updatedAt bumped on save.
    const updated = await store.getProject(meta.id);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(meta.updatedAt).getTime(),
    );
  });

  it('isolates projects between namespaces', async () => {
    const drumStore = createOpfsProjectStore('drums-test');
    const guitarStore = createOpfsProjectStore('guitar-test');

    await drumStore.createProject({
      name: 'Drum Song',
      artist: 'Artist',
      charter: 'Charter',
      durationSeconds: 60,
      sourceFormat: 'sng',
      originalName: 'drum.sng',
      chartFile: {
        fileName: 'notes.chart',
        data: new TextEncoder().encode('drum-chart'),
      },
      audioFiles: [],
      allFiles: [{fileName: 'notes.chart', data: new Uint8Array([1])}],
    });

    expect(await drumStore.listProjects()).toHaveLength(1);
    expect(await guitarStore.listProjects()).toHaveLength(0);
  });

  it('adopts a legacy namespace so projects saved by a retired route stay usable', async () => {
    const legacyStore = createOpfsProjectStore('legacy-route');
    const legacy = await legacyStore.createProject({
      name: 'Old Song',
      artist: 'Artist',
      charter: 'Charter',
      durationSeconds: 60,
      sourceFormat: 'sng',
      originalName: 'old.sng',
      chartFile: {
        fileName: 'notes.chart',
        data: new TextEncoder().encode('old-chart'),
      },
      audioFiles: [],
      allFiles: [{fileName: 'notes.chart', data: new Uint8Array([1])}],
    });

    const store = createOpfsProjectStore('current-route', {
      legacyNamespaces: ['legacy-route'],
    });

    expect((await store.listProjects()).map(p => p.id)).toEqual([legacy.id]);
    expect(await store.getProject(legacy.id)).toEqual(legacy);
    expect(await chartTextOf(store, legacy.id)).toBe('old-chart');

    // Saves land on the project where it already lives, not on a copy.
    await store.writeEditedChart(legacy.id, {
      fileName: 'notes.chart',
      data: new TextEncoder().encode('edited-in-place'),
    });
    expect(await chartTextOf(legacyStore, legacy.id)).toBe('edited-in-place');

    // New projects go to the current namespace, and both are listed.
    const fresh = await store.createProject({
      name: 'New Song',
      artist: 'Artist',
      charter: 'Charter',
      durationSeconds: 60,
      sourceFormat: 'sng',
      originalName: 'new.sng',
      chartFile: {
        fileName: 'notes.chart',
        data: new TextEncoder().encode('new-chart'),
      },
      audioFiles: [],
      allFiles: [{fileName: 'notes.chart', data: new Uint8Array([1])}],
    });
    expect((await store.listProjects()).map(p => p.id).sort()).toEqual(
      [legacy.id, fresh.id].sort(),
    );
    expect((await legacyStore.listProjects()).map(p => p.id)).toEqual([
      legacy.id,
    ]);

    // Deleting a legacy project removes it where it lives.
    await store.deleteProject(legacy.id);
    expect(await legacyStore.listProjects()).toHaveLength(0);
    expect((await store.listProjects()).map(p => p.id)).toEqual([fresh.id]);
  });
  /**
   * `ProjectMetadata.audioAnchor` (plan 0064 addendum §1, plan 0076 item 18):
   * a `.chart` file has nowhere to carry the doc-level `audioAnchor` leading
   * silence sets, so the project's metadata is where it persists. Without
   * this round-trip a reload would leave a shifted chart playing against
   * unpadded audio.
   */
  describe('audioAnchor persistence', () => {
    async function makeProject(
      store: ReturnType<typeof createOpfsProjectStore>,
    ) {
      return store.createProject({
        name: 'Song',
        artist: 'Artist',
        charter: 'Charter',
        durationSeconds: 60,
        sourceFormat: 'sng',
        originalName: 'song.sng',
        chartFile: {
          fileName: 'notes.chart',
          data: new TextEncoder().encode('chart'),
        },
        audioFiles: [],
        allFiles: [{fileName: 'notes.chart', data: new Uint8Array([1])}],
      });
    }

    it('round-trips an anchor through updateProject and a re-read', async () => {
      const store = createOpfsProjectStore('anchor-test');
      const meta = await makeProject(store);

      const updated = await store.updateProject(meta.id, {
        audioAnchor: {tick: 1536, ms: 3238.9},
      });
      expect(updated.audioAnchor).toEqual({tick: 1536, ms: 3238.9});
      expect((await store.getProject(meta.id)).audioAnchor).toEqual({
        tick: 1536,
        ms: 3238.9,
      });

      const cleared = await store.updateProject(meta.id, {audioAnchor: null});
      expect(cleared.audioAnchor).toBeNull();
      expect((await store.getProject(meta.id)).audioAnchor).toBeNull();
    });

    it('reads metadata written before the field existed as no anchor', async () => {
      const store = createOpfsProjectStore('anchor-test');
      const meta = await makeProject(store);

      // createProject writes no anchor field at all — exactly the shape of
      // every project stored before it existed.
      expect(meta.audioAnchor).toBeUndefined();
      const reread = await store.getProject(meta.id);
      expect(reread.audioAnchor).toBeUndefined();
      expect(reread.audioAnchor ?? null).toBeNull();
    });

    it('leaves fields the patch does not name untouched', async () => {
      const store = createOpfsProjectStore('anchor-test');
      const meta = await makeProject(store);

      await store.updateProject(meta.id, {audioAnchor: {tick: 100, ms: 200}});
      const renamed = await store.updateProject(meta.id, {name: 'Renamed'});

      expect(renamed.name).toBe('Renamed');
      expect(renamed.audioAnchor).toEqual({tick: 100, ms: 200});
      expect(renamed.artist).toBe(meta.artist);
      expect(renamed.id).toBe(meta.id);
      expect(renamed.createdAt).toBe(meta.createdAt);
    });
  });

  describe('album art and passthrough assets', () => {
    /** A package with a cover, a video and the usual chart/audio/ini. */
    async function makePackage(
      store: ReturnType<typeof createOpfsProjectStore>,
    ) {
      return store.createProject({
        name: 'Song',
        artist: 'Artist',
        charter: 'Charter',
        durationSeconds: 60,
        sourceFormat: 'sng',
        originalName: 'song.sng',
        chartFile: {
          fileName: 'notes.chart',
          data: new TextEncoder().encode('[Song]\n{\n}\n'),
        },
        audioFiles: [{fileName: 'song.ogg', data: new Uint8Array([1])}],
        allFiles: [
          {fileName: 'notes.chart', data: new Uint8Array([9])},
          {fileName: 'song.ogg', data: new Uint8Array([1])},
          {fileName: 'song.ini', data: new Uint8Array([5])},
          {fileName: 'album.png', data: new Uint8Array([7])},
          {fileName: 'video.mp4', data: new Uint8Array([8])},
        ],
      });
    }

    it('reads the cover a package shipped with', async () => {
      const store = createOpfsProjectStore('art-test');
      const meta = await makePackage(store);

      const art = await store.readAlbumArt(meta.id);
      expect(art).toEqual({
        fileName: 'album.png',
        data: new Uint8Array([7]),
      });
    });

    it('has no cover to read on a package that shipped none', async () => {
      const store = createOpfsProjectStore('art-test');
      const meta = await store.createProject({
        name: 'Song',
        artist: 'Artist',
        charter: 'Charter',
        durationSeconds: 60,
        sourceFormat: 'sng',
        originalName: 'song.sng',
        chartFile: {
          fileName: 'notes.chart',
          data: new TextEncoder().encode('[Song]\n{\n}\n'),
        },
        audioFiles: [],
        allFiles: [{fileName: 'notes.chart', data: new Uint8Array([9])}],
      });
      expect(await store.readAlbumArt(meta.id)).toBeNull();
    });

    it('replaces a cover under a different name rather than keeping both', async () => {
      const store = createOpfsProjectStore('art-test');
      const meta = await makePackage(store);

      await store.writeAlbumArt(meta.id, {
        fileName: 'album.jpg',
        data: new Uint8Array([42]),
      });

      expect(await store.readAlbumArt(meta.id)).toEqual({
        fileName: 'album.jpg',
        data: new Uint8Array([42]),
      });
      // A package carrying album.png AND album.jpg would raise
      // scan-chart's multipleAlbumArt, so the old name must be gone.
      const assets = await store.loadPassthroughAssets(meta.id);
      expect(assets.map(a => a.fileName).sort()).toEqual([
        'album.jpg',
        'video.mp4',
      ]);
    });

    it('removes the cover and leaves everything else alone', async () => {
      const store = createOpfsProjectStore('art-test');
      const meta = await makePackage(store);

      await store.writeAlbumArt(meta.id, null);

      expect(await store.readAlbumArt(meta.id)).toBeNull();
      expect(
        (await store.loadPassthroughAssets(meta.id)).map(a => a.fileName),
      ).toEqual(['video.mp4']);
    });

    it('adds a cover to a package that had none', async () => {
      const store = createOpfsProjectStore('art-test');
      const meta = await store.createProject({
        name: 'Song',
        artist: 'Artist',
        charter: 'Charter',
        durationSeconds: 60,
        sourceFormat: 'sng',
        originalName: 'song.sng',
        chartFile: {
          fileName: 'notes.chart',
          data: new TextEncoder().encode('[Song]\n{\n}\n'),
        },
        audioFiles: [],
        allFiles: [{fileName: 'notes.chart', data: new Uint8Array([9])}],
      });

      await store.writeAlbumArt(meta.id, {
        fileName: 'album.jpg',
        data: new Uint8Array([42]),
      });
      expect(await store.readAlbumArt(meta.id)).not.toBeNull();
    });

    it('passes through art and video, but never the chart, ini or audio', async () => {
      // The chart is re-serialized from the live document and song.ini is
      // rebuilt from the metadata form, so round-tripping the stored copies
      // would ship a stale pair. Audio has its own export path.
      const store = createOpfsProjectStore('art-test');
      const meta = await makePackage(store);

      expect(
        (await store.loadPassthroughAssets(meta.id))
          .map(a => a.fileName)
          .sort(),
      ).toEqual(['album.png', 'video.mp4']);
    });
  });
});
