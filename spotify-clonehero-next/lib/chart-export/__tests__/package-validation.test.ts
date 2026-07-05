/**
 * End-to-end export validation.
 *
 * Proves that the packaging path used by the export dialog produces a chart
 * folder that scan-chart — the same full parser Clone Hero / YARG chart
 * managers rely on — accepts as a valid, playable chart with no folder,
 * metadata, or chart issues.
 *
 * The flow mirrors production exactly:
 *   buildChartDocument (real pipeline)
 *     -> writeChartFolder -> notes.chart text
 *     -> assembleChartFiles (+ audio stems)
 *     -> exportAsZip / exportAsSng
 *     -> unpack the bytes back into a file list
 *     -> scanChartFolder(files) and assert it is clean.
 *
 * If our writer ever emits a chart scan-chart rejects (bad end event,
 * misaligned time signatures, missing audio, invalid metadata, ...) this test
 * fails with the specific issue.
 */

import {describe, test, expect} from '@jest/globals';
import {zipSync, unzipSync} from 'fflate';
import {scanChartFolder} from '@eliwhite/scan-chart';
import type {File as FileEntry} from '@eliwhite/scan-chart';
import {SngStream} from '@eliwhite/parse-sng';

import {buildChartDocument} from '@/lib/drum-transcription/pipeline/chart-builder';
import {writeChartFolder} from '@/lib/chart-edit';
import {encodeWav} from '@/lib/audio/wav-encoder';
import type {RawDrumEvent} from '@/lib/drum-transcription/ml/types';
import {SYSTEMATIC_ONSET_MS} from '@/lib/drum-transcription/ml/types';
import type {Synctrack} from '@/lib/tempo-map/types';

import {muxOggOpus} from '@/lib/audio/ogg-opus';

import {assembleChartFiles, chartPackageFileName} from '../assemble';
import {exportAsZip} from '../zip';
import {exportAsSng} from '../sng';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Pre-subtract the systematic onset offset so events land on intended ticks. */
function ev(
  timeSeconds: number,
  drumClass: RawDrumEvent['drumClass'],
  confidence = 0.9,
): RawDrumEvent {
  return {
    timeSeconds: timeSeconds - SYSTEMATIC_ONSET_MS / 1000,
    drumClass,
    midiPitch: 0,
    confidence,
  };
}

const SYNC: Synctrack = {
  origin_ms: 0,
  tempos: [{ms: 0, bpm: 120}],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
};

/** A short but musically dense drum performance (kick/snare/hats/cymbals). */
const EVENTS: RawDrumEvent[] = [
  ev(0.5, 'BD'),
  ev(0.5, 'HH'),
  ev(1.0, 'SD'),
  ev(1.0, 'HH'),
  ev(1.5, 'BD'),
  ev(1.5, 'HH'),
  ev(2.0, 'SD'),
  ev(2.0, 'CR'),
  ev(2.5, 'BD'),
  ev(3.0, 'SD'),
  ev(3.0, 'HH'),
  ev(3.5, 'HT'),
];

const SONG_DURATION_SECONDS = 5;

/** Build the notes.chart text via the real production pipeline + writer. */
function buildChartText(): string {
  const doc = buildChartDocument(
    EVENTS,
    'Validation Song',
    SONG_DURATION_SECONDS,
    SYNC,
  );
  const files = writeChartFolder(doc);
  const chartFile = files.find(f => f.fileName === 'notes.chart');
  if (!chartFile) throw new Error('writeChartFolder produced no notes.chart');
  return new TextDecoder().decode(chartFile.data);
}

/** A tiny but real WAV so the package carries genuine audio bytes. */
function fakeWav(): ArrayBuffer {
  const sampleRate = 44100;
  const pcm = new Float32Array(sampleRate); // 0.5s stereo-interleaved silence-ish
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 20) * 0.1;
  return encodeWav(pcm, sampleRate, 2);
}

function buildPackageFiles(
  audioSources: {fileName: string; data: ArrayBuffer}[] = [
    {fileName: 'drums.wav', data: fakeWav()},
    {fileName: 'song.wav', data: fakeWav()},
  ],
): FileEntry[] {
  return assembleChartFiles({
    chartText: buildChartText(),
    metadata: {
      name: 'Validation Song',
      artist: 'Test Artist',
      charter: 'Drum Transcription AI',
    },
    audioSources,
  });
}

// ---------------------------------------------------------------------------
// SNG round-trip decode (uses parse-sng, the reader Clone Hero managers use)
// ---------------------------------------------------------------------------

async function unpackSng(sngBytes: Uint8Array): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sngBytes);
        controller.close();
      },
    });

    const sngStream = new SngStream(stream);
    let metadata: Record<string, string> = {};
    const files: FileEntry[] = [];

    sngStream.on('header', h => {
      metadata = h.metadata;
    });

    sngStream.on('file', async (fileName, fileStream, nextFile) => {
      const reader = fileStream.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      files.push({fileName, data: merged});

      if (nextFile) {
        nextFile();
      } else {
        // Reconstitute song.ini from the header metadata so scan-chart can
        // read the same fields it would from a folder on disk.
        const iniLines = ['[song]'];
        for (const [key, value] of Object.entries(metadata)) {
          iniLines.push(`${key} = ${value}`);
        }
        files.push({
          fileName: 'song.ini',
          data: new TextEncoder().encode(iniLines.join('\n')),
        });
        resolve(files);
      }
    });

    sngStream.on('error', reject);
    sngStream.start();
  });
}

// ---------------------------------------------------------------------------
// Assertions shared by both formats
// ---------------------------------------------------------------------------

function expectCleanScan(files: FileEntry[]): void {
  const scanned = scanChartFolder(files);

  // The chart must be playable (notesData present, no fatal issues).
  expect(scanned.playable).toBe(true);
  expect(scanned.notesData).not.toBeNull();

  // No fatal folder-level problems. `noAlbumArt` is expected — the drum
  // transcription export intentionally ships no album art — so only assert on
  // issues that mean the package itself is broken (missing/invalid audio,
  // chart, or ini).
  const benignFolderIssues = new Set(['noAlbumArt']);
  const fatalFolderIssues = scanned.folderIssues.filter(
    i => !benignFolderIssues.has(i.folderIssue),
  );
  expect(fatalFolderIssues).toEqual([]);

  // Metadata must be valid. The only tolerated warnings are the purely
  // descriptive fields the auto-transcription intentionally leaves blank
  // (album / genre / year). Anything else — a missing name/artist/charter,
  // an absent drums difficulty, or any `invalidValue` — is a real defect.
  const tolerated = new Set(['album', 'genre', 'year']);
  const seriousMetadataIssues = scanned.metadataIssues.filter(i => {
    if (i.metadataIssue !== 'missingValue') return true;
    const field = /"([^"]+)"/.exec(i.description)?.[1];
    return !field || !tolerated.has(field);
  });
  expect(seriousMetadataIssues).toEqual([]);

  // Audio and drums must have survived packaging.
  expect(scanned.notesData?.instruments).toContain('drums');

  // No chart issues that would indicate a malformed writer output, e.g.
  // 'badEndEvent', 'misalignedTimeSignature', 'brokenNote', 'invalidChord'.
  const chartIssues = scanned.notesData?.chartIssues ?? [];
  const forbidden = chartIssues.filter(i =>
    [
      'badEndEvent',
      'misalignedTimeSignature',
      'brokenNote',
      'invalidChord',
      'badStarPower',
      'noNotes',
    ].includes(i.noteIssue),
  );
  expect(forbidden).toEqual([]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exported package validates with scan-chart', () => {
  test('ZIP package scans clean', () => {
    const files = buildPackageFiles();
    const zipBlob = exportAsZip(files);
    // Blob has no sync arrayBuffer in Node; rebuild the bytes with the same
    // fflate zipSync exportAsZip uses, then unzip to mirror a download.
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.fileName] = f.data;
    const unzipped = unzipSync(zipSync(entries));
    const roundTripped: FileEntry[] = Object.entries(unzipped).map(
      ([fileName, data]) => ({fileName, data}),
    );

    // Sanity: audio actually made it into the archive.
    expect(roundTripped.map(f => f.fileName)).toEqual(
      expect.arrayContaining([
        'notes.chart',
        'song.ini',
        'drums.wav',
        'song.wav',
      ]),
    );

    expectCleanScan(roundTripped);
    // Blob is a real zip.
    expect(zipBlob.type).toBe('application/zip');
  });

  test('SNG package scans clean', async () => {
    const files = buildPackageFiles();
    const sngBytes = exportAsSng(files);
    const unpacked = await unpackSng(sngBytes);

    expect(unpacked.map(f => f.fileName)).toEqual(
      expect.arrayContaining([
        'notes.chart',
        'song.ini',
        'drums.wav',
        'song.wav',
      ]),
    );

    expectCleanScan(unpacked);
  });

  test('package includes audio stems (regression: audio was silently dropped)', () => {
    const files = buildPackageFiles();
    const audio = files.filter(f => f.fileName.endsWith('.wav'));
    expect(audio.map(f => f.fileName).sort()).toEqual([
      'drums.wav',
      'song.wav',
    ]);
    for (const a of audio) {
      expect(a.data.length).toBeGreaterThan(44); // more than a bare WAV header
    }
  });

  test('download file name follows "Artist - Song (Charter)"', () => {
    expect(
      chartPackageFileName(
        {name: 'My Song', artist: 'The Band', charter: 'AutoDrums'},
        'sng',
      ),
    ).toBe('The Band - My Song (AutoDrums).sng');
  });

  test('missing artist/charter fall back cleanly in the file name', () => {
    expect(
      chartPackageFileName({name: 'Solo', artist: '', charter: ''}, 'zip'),
    ).toBe('Unknown Artist - Solo (MusicCharts.tools).zip');
  });

  test('Opus stems (drums.opus + song.opus) scan clean', () => {
    // Real Ogg Opus bytes, matching the export path's stem format.
    const opus = () =>
      muxOggOpus({
        channelCount: 2,
        preSkip: 0,
        inputSampleRate: 48000,
        packets: [
          {data: new Uint8Array([0xfc, 1, 2, 3]), granulePosition: 960},
          {data: new Uint8Array([0xfc, 4, 5, 6]), granulePosition: 1920},
        ],
      });
    const files = buildPackageFiles([
      {fileName: 'drums.opus', data: opus().buffer as ArrayBuffer},
      {fileName: 'song.opus', data: opus().buffer as ArrayBuffer},
    ]);
    expect(files.map(f => f.fileName)).toEqual(
      expect.arrayContaining(['drums.opus', 'song.opus']),
    );
    expectCleanScan(files);
  });

  test('original audio (song.mp3) scans clean', () => {
    // No-stems export bundles the untouched upload as song.<ext>.
    const files = buildPackageFiles([
      {
        fileName: 'song.mp3',
        data: new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer,
      },
    ]);
    expect(files.map(f => f.fileName)).toContain('song.mp3');
    expectCleanScan(files);
  });
});
