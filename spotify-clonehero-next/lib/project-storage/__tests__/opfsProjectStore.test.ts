import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import {createOpfsProjectStore} from '../opfsProjectStore';

describe('createOpfsProjectStore', () => {
  beforeEach(() => {
    installFakeOPFS();
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
      chartText: '[Song]\n{\n}\n',
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

    const chartText = await store.readChartText(meta.id);
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
      chartText: 'original',
      audioFiles: [],
      allFiles: [{fileName: 'notes.chart', data: new Uint8Array([1])}],
    });

    expect(await store.readChartText(meta.id)).toBe('original');

    await store.writeEditedChart(meta.id, 'edited');
    expect(await store.readChartText(meta.id)).toBe('edited');

    // updatedAt bumped on save.
    const updated = await store.getProject(meta.id);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(meta.updatedAt).getTime(),
    );
  });

  it('isolates projects between namespaces', async () => {
    const drumStore = createOpfsProjectStore('drum-edit-test');
    const guitarStore = createOpfsProjectStore('guitar-edit-test');

    await drumStore.createProject({
      name: 'Drum Song',
      artist: 'Artist',
      charter: 'Charter',
      durationSeconds: 60,
      sourceFormat: 'sng',
      originalName: 'drum.sng',
      chartText: 'drum-chart',
      audioFiles: [],
      allFiles: [{fileName: 'notes.chart', data: new Uint8Array([1])}],
    });

    expect(await drumStore.listProjects()).toHaveLength(1);
    expect(await guitarStore.listProjects()).toHaveLength(0);
  });
});
