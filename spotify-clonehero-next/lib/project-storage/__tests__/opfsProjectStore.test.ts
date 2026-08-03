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
    const drumStore = createOpfsProjectStore('drums-test');
    const guitarStore = createOpfsProjectStore('guitar-test');

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

  it('adopts a legacy namespace so projects saved by a retired route stay usable', async () => {
    const legacyStore = createOpfsProjectStore('legacy-route');
    const legacy = await legacyStore.createProject({
      name: 'Old Song',
      artist: 'Artist',
      charter: 'Charter',
      durationSeconds: 60,
      sourceFormat: 'sng',
      originalName: 'old.sng',
      chartText: 'old-chart',
      audioFiles: [],
      allFiles: [{fileName: 'notes.chart', data: new Uint8Array([1])}],
    });

    const store = createOpfsProjectStore('current-route', {
      legacyNamespaces: ['legacy-route'],
    });

    expect((await store.listProjects()).map(p => p.id)).toEqual([legacy.id]);
    expect(await store.getProject(legacy.id)).toEqual(legacy);
    expect(await store.readChartText(legacy.id)).toBe('old-chart');

    // Saves land on the project where it already lives, not on a copy.
    await store.writeEditedChart(legacy.id, 'edited-in-place');
    expect(await legacyStore.readChartText(legacy.id)).toBe('edited-in-place');

    // New projects go to the current namespace, and both are listed.
    const fresh = await store.createProject({
      name: 'New Song',
      artist: 'Artist',
      charter: 'Charter',
      durationSeconds: 60,
      sourceFormat: 'sng',
      originalName: 'new.sng',
      chartText: 'new-chart',
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
});
