import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import {
  createBlankProject,
  deleteProject,
  findProject,
  listProjects,
  renameProject,
} from '../projects';
import {createOpfsProjectStore} from '../opfsProjectStore';

import {writeChartFolder} from '@/lib/chart-edit';
import {createBlankChartDocument} from '../blankChart';

let opfs: ReturnType<typeof installFakeOPFS>;

/** A real `.chart` body, so the rename path has something parseable to read. */
function blankChartText(name: string): string {
  const files = writeChartFolder(createBlankChartDocument({name}));
  const chart = files.find(f => f.fileName === 'notes.chart')!;
  return new TextDecoder().decode(chart.data);
}

/** Writes a project directory by hand, so a suite can pin how a record
 *  written before a field existed reads back today. */
function writeRawProject(
  namespace: string,
  id: string,
  metadata: Record<string, unknown>,
  extraFiles: Record<string, string> = {},
): void {
  const write = (path: string, text: string) =>
    opfs.store.set(path, new TextEncoder().encode(text).buffer as ArrayBuffer);
  write(`/${namespace}/${id}/metadata.json`, JSON.stringify(metadata));
  for (const [fileName, text] of Object.entries(extraFiles)) {
    write(`/${namespace}/${id}/${fileName}`, text);
  }
}

describe('project facade', () => {
  beforeEach(() => {
    opfs = installFakeOPFS();
  });

  it('lists both layouts, most recently updated first', async () => {
    writeRawProject('chart-editor', 'pkg-1', {
      id: 'pkg-1',
      name: 'Package Song',
      artist: 'Package Artist',
      charter: 'Charter',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      durationSeconds: 200,
      sourceFormat: 'sng',
      originalName: 'pkg.sng',
    });
    writeRawProject('drum-transcription', 'dt-1', {
      id: 'dt-1',
      name: 'Transcribed Song',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      durationSeconds: 180,
      stage: 'editing',
    });

    const records = await listProjects();
    expect(records.map(r => r.id)).toEqual(['dt-1', 'pkg-1']);
    expect(records[0].layout).toBe('drum-transcription');
    expect(records[1].layout).toBe('chart-package');
  });

  it('derives origin for records written before the field existed', async () => {
    writeRawProject('chart-editor', 'pkg-1', {
      id: 'pkg-1',
      name: 'Package Song',
      artist: 'A',
      charter: 'C',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      durationSeconds: 200,
      sourceFormat: 'sng',
      originalName: 'pkg.sng',
    });
    writeRawProject('drum-transcription', 'dt-1', {
      id: 'dt-1',
      name: 'Transcribed Song',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      durationSeconds: 180,
      stage: 'editing',
    });
    writeRawProject('chart-editor', 'pkg-2', {
      id: 'pkg-2',
      name: 'Stored Origin',
      artist: 'A',
      charter: 'C',
      origin: 'drum-transcription',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      durationSeconds: 200,
      sourceFormat: 'sng',
      originalName: 'pkg.sng',
    });

    const byId = new Map((await listProjects()).map(r => [r.id, r]));
    expect(byId.get('pkg-1')?.origin).toBe('chart-editor');
    expect(byId.get('dt-1')?.origin).toBe('drum-transcription');
    expect(byId.get('pkg-2')?.origin).toBe('drum-transcription');
  });

  it('treats a missing hasAudio as true and maps pipeline stage to readiness', async () => {
    writeRawProject('chart-editor', 'pkg-1', {
      id: 'pkg-1',
      name: 'Package Song',
      artist: 'A',
      charter: 'C',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      durationSeconds: 200,
      sourceFormat: 'sng',
      originalName: 'pkg.sng',
    });
    writeRawProject('drum-transcription', 'dt-busy', {
      id: 'dt-busy',
      name: 'Mid pipeline',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      durationSeconds: null,
      stage: 'separating',
    });
    writeRawProject('drum-transcription', 'dt-ready', {
      id: 'dt-ready',
      name: 'Done',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      durationSeconds: 120,
      stage: 'editing',
    });

    const byId = new Map((await listProjects()).map(r => [r.id, r]));
    expect(byId.get('pkg-1')?.hasAudio).toBe(true);
    expect(byId.get('pkg-1')?.ready).toBe(true);
    expect(byId.get('pkg-1')?.pipelineStage).toBeNull();

    const busy = byId.get('dt-busy');
    expect(busy?.ready).toBe(false);
    expect(busy?.pipelineStage).toBe('separating');
    expect(busy?.durationSeconds).toBeNull();

    expect(byId.get('dt-ready')?.ready).toBe(true);
  });

  it('resolves, renames and deletes a project in an adopted legacy namespace', async () => {
    const legacyStore = createOpfsProjectStore('drum-edit');
    const created = await legacyStore.createProject({
      name: 'Old Song',
      artist: 'Old Artist',
      charter: 'Old Charter',
      durationSeconds: 100,
      sourceFormat: 'sng',
      originalName: 'old.sng',
      chartText: blankChartText('Old Song'),
      audioFiles: [{fileName: 'song.ogg', data: new Uint8Array([1])}],
      allFiles: [],
    });

    const found = await findProject(created.id);
    expect(found?.namespace).toBe('drum-edit');
    expect(found?.layout).toBe('chart-package');

    const renamed = await renameProject(created.id, {
      name: 'New Song',
      artist: 'New Artist',
      charter: 'New Charter',
    });
    expect(renamed.name).toBe('New Song');
    expect(renamed.artist).toBe('New Artist');

    // Written in place: the project never moved out of `drum-edit`.
    expect(renamed.namespace).toBe('drum-edit');
    expect(
      [...opfs.store.keys()].some(k => k.startsWith('/chart-editor/')),
    ).toBe(false);

    // The chart itself carries the new identity, so the editor's next save
    // cannot mirror a stale name back over the record.
    const chartText = await legacyStore.readChartText(created.id);
    expect(chartText).toContain('New Song');
    const ini = await legacyStore.readSongIni(created.id);
    expect(new TextDecoder().decode(ini!)).toContain('name = New Song');

    await deleteProject(created.id);
    expect(await findProject(created.id)).toBeNull();
  });

  it('creates a blank project with a chart, a song.ini and no audio', async () => {
    const record = await createBlankProject({
      name: 'Blank Song',
      artist: 'Nobody',
    });

    expect(record.hasAudio).toBe(false);
    expect(record.ready).toBe(true);
    expect(record.origin).toBe('chart-editor');
    expect(record.durationSeconds).toBe(300);

    const store = createOpfsProjectStore('chart-editor');
    expect(await store.loadAudioFiles(record.id)).toHaveLength(0);

    const chartText = await store.readChartText(record.id);
    expect(chartText).toContain('[ExpertDrums]');

    const ini = await store.readSongIni(record.id);
    expect(ini).not.toBeNull();
    const iniText = new TextDecoder().decode(ini!);
    expect(iniText).toContain('song_length = 300000');
    expect(iniText).toContain('name = Blank Song');
  });
});
