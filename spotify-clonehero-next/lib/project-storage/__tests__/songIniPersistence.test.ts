/**
 * The `song.ini` round trip, tested as a round trip.
 *
 * Every step here is the one the editor hosts run, in their order: serialize
 * the document once (`chartDocToFolderFiles`), write the ini and the chart,
 * read both back, merge them (`withSongIniFields`). Testing the halves
 * separately would miss the whole point, which is that the ini omits every
 * field equal to scan-chart's default while the parse refills all of them —
 * so the failure only shows up on the SECOND save/load cycle, once the
 * refilled values have been written back into the chart file.
 */

import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import {
  chartDocToFolderFiles,
  createEmptyChart,
  readChartForEditing,
  type ChartDocument,
} from '@/lib/chart-edit';
import {
  readSongIniMetadata,
  withSongIniFields,
} from '@/lib/chart-editor-core';

import {createOpfsProjectStore} from '../opfsProjectStore';

type Store = ReturnType<typeof createOpfsProjectStore>;

/** A document with everything the song-details dialog can set, plus the
 *  fields that ride along in the ini and nothing else. `charter` is left
 *  unset on purpose: it is the field the default refill would fill in with
 *  `"Unknown Charter"`. */
function authoredDoc(): ChartDocument {
  const parsedChart = createEmptyChart({bpm: 120, resolution: 192});
  parsedChart.metadata = {
    name: 'Real Name',
    artist: 'Real Artist',
    album: 'Real Album',
    genre: 'Rock',
    year: '2004',
    diff_drums: 4,
    diff_drums_real: 3,
    diff_guitar: 0,
    loading_phrase: 'Hold on',
    extraIniFields: {diff_bass_real: '2'},
  };
  return {parsedChart, assets: []};
}

async function createProject(store: Store, doc: ChartDocument) {
  const {chart, ini} = chartDocToFolderFiles(doc);
  const meta = await store.createProject({
    name: doc.parsedChart.metadata.name ?? '',
    artist: doc.parsedChart.metadata.artist ?? '',
    charter: doc.parsedChart.metadata.charter ?? '',
    durationSeconds: 120,
    sourceFormat: 'folder',
    originalName: 'song',
    chartText: new TextDecoder().decode(chart.data),
    audioFiles: [],
    allFiles: [chart, ini],
  });
  return meta.id;
}

/** What a host's autosave writes: one serialization, ini first. */
async function save(
  store: Store,
  projectId: string,
  doc: ChartDocument,
): Promise<void> {
  const {chart, ini} = chartDocToFolderFiles(doc);
  await store.writeSongIni(projectId, ini.data);
  await store.writeEditedChart(projectId, new TextDecoder().decode(chart.data));
}

/** What a host's load does: chart parse, then the project merge. */
async function load(store: Store, projectId: string): Promise<ChartDocument> {
  const chartText = await store.readChartText(projectId);
  const songIni = await store.readSongIni(projectId);
  const doc = readChartForEditing([
    {fileName: 'notes.chart', data: new TextEncoder().encode(chartText)},
  ]);
  if (!songIni) return doc;
  return withSongIniFields(doc, {fileName: 'song.ini', data: songIni});
}

describe('song.ini persistence', () => {
  let store: Store;

  beforeEach(() => {
    installFakeOPFS();
    store = createOpfsProjectStore('chart-editor');
  });

  it('round-trips every authored field through save and reload', async () => {
    const doc = authoredDoc();
    const projectId = await createProject(store, doc);

    await save(store, projectId, doc);
    const first = await load(store, projectId);

    expect(first.parsedChart.metadata).toMatchObject({
      name: 'Real Name',
      artist: 'Real Artist',
      album: 'Real Album',
      genre: 'Rock',
      year: '2004',
      diff_drums: 4,
      diff_drums_real: 3,
      loading_phrase: 'Hold on',
    });
    // `Number(Difficulty) || undefined` in the .chart parser drops a zero, so
    // a lead-guitar intensity of 0 survives only because the ini carries it.
    expect(first.parsedChart.metadata.diff_guitar).toBe(0);
    expect(first.parsedChart.metadata.extraIniFields).toEqual({
      diff_bass_real: '2',
    });
  });

  it('does not degrade on the second save and reload', async () => {
    const doc = authoredDoc();
    const projectId = await createProject(store, doc);

    await save(store, projectId, doc);
    const first = await load(store, projectId);
    // The second cycle is the one that catches a dense ini merge: the
    // defaults it refilled on the first load would be written into the chart
    // file here, where the chart-wins rule can no longer keep them out.
    await save(store, projectId, first);
    const second = await load(store, projectId);

    expect(second.parsedChart.metadata).toEqual(first.parsedChart.metadata);
    expect(second.parsedChart.metadata).toMatchObject({
      name: 'Real Name',
      artist: 'Real Artist',
      album: 'Real Album',
      diff_drums: 4,
      diff_drums_real: 3,
      diff_guitar: 0,
    });
    // A field nobody set stays unset rather than becoming scan-chart's
    // placeholder for "missing".
    expect(second.parsedChart.metadata.charter).toBeUndefined();
    expect(second.parsedChart.metadata.icon).toBeUndefined();
  });

  it("keeps a field the user cleared cleared, over the ini's placeholder", async () => {
    const doc = authoredDoc();
    doc.parsedChart.metadata.album = '';
    const projectId = await createProject(store, doc);

    await save(store, projectId, doc);
    const first = await load(store, projectId);
    await save(store, projectId, first);
    const second = await load(store, projectId);

    for (const loaded of [first, second]) {
      expect(loaded.parsedChart.metadata.album).not.toBe('Unknown Album');
      // The dialog reads a cleared field as an empty box either way.
      expect(
        readSongIniMetadata(loaded, {name: '', artist: '', charter: ''}).album,
      ).toBe('');
    }
  });

  it('loads a project that has no ini beside its chart, as before', async () => {
    const doc = authoredDoc();
    const {chart} = chartDocToFolderFiles(doc);
    const meta = await store.createProject({
      name: 'Real Name',
      artist: 'Real Artist',
      charter: '',
      durationSeconds: 120,
      sourceFormat: 'folder',
      originalName: 'song',
      chartText: new TextDecoder().decode(chart.data),
      audioFiles: [],
      // No ini on disk: every project created before the editor wrote one.
      allFiles: [chart],
    });

    expect(await store.readSongIni(meta.id)).toBeNull();
    const loaded = await load(store, meta.id);
    expect(loaded.parsedChart.metadata).toMatchObject({
      name: 'Real Name',
      artist: 'Real Artist',
      album: 'Real Album',
      genre: 'Rock',
    });
    // The intensities a .chart file cannot carry are gone, exactly as they
    // were before this project ever had an ini — and the first save gives it
    // one, so they persist from then on.
    expect(loaded.parsedChart.metadata.diff_drums).toBeUndefined();

    await save(store, meta.id, loaded);
    expect(await store.readSongIni(meta.id)).not.toBeNull();
  });

  it("prefers the edited chart's identity over a stale imported ini", async () => {
    // The migration case: a project imported and then edited before the ini
    // was ever rewritten. The ini is the import-time one; the edited chart is
    // the user's. Identity comes from the chart, intensities from the ini.
    const doc = authoredDoc();
    const projectId = await createProject(store, doc);
    const edited = {
      ...doc,
      parsedChart: {
        ...doc.parsedChart,
        metadata: {...doc.parsedChart.metadata, artist: 'New Artist'},
      },
    };
    const {chart} = chartDocToFolderFiles(edited);
    await store.writeEditedChart(
      projectId,
      new TextDecoder().decode(chart.data),
    );

    const loaded = await load(store, projectId);
    expect(loaded.parsedChart.metadata.artist).toBe('New Artist');
    expect(loaded.parsedChart.metadata.diff_drums).toBe(4);
  });
});
