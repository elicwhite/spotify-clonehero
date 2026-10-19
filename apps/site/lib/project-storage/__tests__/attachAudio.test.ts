import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import {pickPrimaryAudioFile} from '@/lib/audio/pickPrimaryAudioFile';

import {attachAudioToProject, planAttachedAudioNames} from '../attachAudio';
import {createOpfsProjectStore} from '../opfsProjectStore';

function file(fileName: string, size: number) {
  return {fileName, data: new Uint8Array(size)};
}

describe('pickPrimaryAudioFile', () => {
  it('picks the largest file, and keeps the first on a tie', () => {
    expect(
      pickPrimaryAudioFile([file('drums.ogg', 10), file('song.ogg', 99)])
        ?.fileName,
    ).toBe('song.ogg');
    expect(
      pickPrimaryAudioFile([file('a.ogg', 10), file('b.ogg', 10)])?.fileName,
    ).toBe('a.ogg');
    expect(pickPrimaryAudioFile([])).toBeNull();
  });
});

describe('planAttachedAudioNames', () => {
  it('promotes the largest file to song.<ext> on a project with no audio', () => {
    const planned = planAttachedAudioNames(
      [file('kit.wav', 10), file('mix.mp3', 500), file('bass.ogg', 20)],
      {hadAudio: false},
    );
    expect(planned.map(f => f.fileName)).toEqual([
      'kit.wav',
      'song.mp3',
      'bass.ogg',
    ]);
  });

  it('leaves names alone once the project already has a full mix', () => {
    const planned = planAttachedAudioNames([file('mix.mp3', 500)], {
      hadAudio: true,
    });
    expect(planned.map(f => f.fileName)).toEqual(['mix.mp3']);
  });

  it('suffixes rather than overwriting a name already in audio/', () => {
    const planned = planAttachedAudioNames(
      [file('guitar.ogg', 1), file('guitar.ogg', 2)],
      {hadAudio: true, existingFileNames: ['Guitar.ogg']},
    );
    expect(planned.map(f => f.fileName)).toEqual([
      'guitar-2.ogg',
      'guitar-3.ogg',
    ]);
  });
});

describe('attachAudioToProject', () => {
  beforeEach(() => {
    installFakeOPFS();
  });

  it('writes the bytes and marks the record as having audio', async () => {
    const store = createOpfsProjectStore('attach-test');
    const meta = await store.createProject({
      name: 'Blank',
      artist: '',
      charter: '',
      durationSeconds: 300,
      sourceFormat: 'folder',
      originalName: 'Blank',
      chartFile: {
        fileName: 'notes.chart',
        data: new TextEncoder().encode('chart'),
      },
      audioFiles: [],
      allFiles: [],
    });
    expect(meta.hasAudio).toBe(false);

    await attachAudioToProject({
      store,
      projectId: meta.id,
      files: [{fileName: 'mysong.mp3', data: new Uint8Array([7, 7, 7])}],
      durationSeconds: 200,
    });

    const stored = await store.loadAudioFiles(meta.id);
    expect(stored.map(f => f.fileName)).toEqual(['song.mp3']);
    expect(Array.from(stored[0].data)).toEqual([7, 7, 7]);

    const updated = await store.getProject(meta.id);
    expect(updated.hasAudio).toBe(true);
    expect(updated.durationSeconds).toBe(200);
  });

  it('reads "already has a full mix" from disk, so a second attach does not overwrite the first', async () => {
    const store = createOpfsProjectStore('attach-test');
    const meta = await store.createProject({
      name: 'Blank',
      artist: '',
      charter: '',
      durationSeconds: 300,
      sourceFormat: 'folder',
      originalName: 'Blank',
      chartFile: {
        fileName: 'notes.chart',
        data: new TextEncoder().encode('chart'),
      },
      audioFiles: [],
      allFiles: [],
    });

    await attachAudioToProject({
      store,
      projectId: meta.id,
      files: [{fileName: 'first.mp3', data: new Uint8Array([1])}],
    });
    await attachAudioToProject({
      store,
      projectId: meta.id,
      files: [{fileName: 'second.mp3', data: new Uint8Array([2, 2])}],
    });

    const stored = await store.loadAudioFiles(meta.id);
    expect(stored.map(f => f.fileName).sort()).toEqual([
      'second.mp3',
      'song.mp3',
    ]);
  });
});
