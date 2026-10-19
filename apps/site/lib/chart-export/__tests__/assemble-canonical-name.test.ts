/**
 * Regression tests for chart-file name canonicalization in
 * {@link assembleChartFiles}.
 *
 * The editor's autosave persists edits under a variant name
 * (`notes.edited.chart` / `notes.edited.mid`), and the export path hands that
 * file to `assembleChartFiles` verbatim. Assembly must re-emit it under the
 * canonical `notes.chart` / `notes.mid` so Clone Hero / YARG recognize it —
 * and must never let a `notes.edited.*` (or any other chart/ini file) slip
 * through as a passthrough asset.
 */

import {describe, test, expect} from '@jest/globals';
import {zipSync, unzipSync} from 'fflate';
import {scanChartFolder} from '@eliwhite/scan-chart';
import type {File as FileEntry} from '@eliwhite/scan-chart';

import {createEmptyChart, writeChartFolder} from '@/lib/chart-edit';
import {buildChartDocumentFromExistingChart} from '@/lib/drum-transcription/pipeline/chart-builder';
import {encodeWav} from '@/lib/audio/wav-encoder';
import type {RawDrumEvent} from '@/lib/drum-transcription/ml/types';
import {SYSTEMATIC_ONSET_MS_CHART_FLOW} from '@/lib/drum-transcription/ml/types';

import {assembleChartFiles} from '../assemble';

function ev(
  timeSeconds: number,
  drumClass: RawDrumEvent['drumClass'],
): RawDrumEvent {
  return {
    timeSeconds: timeSeconds - SYSTEMATIC_ONSET_MS_CHART_FLOW / 1000,
    drumClass,
    midiPitch: 0,
    confidence: 0.9,
  };
}

const EVENTS: RawDrumEvent[] = [
  ev(0.5, 'BD'),
  ev(0.5, 'HH'),
  ev(1.0, 'SD'),
  ev(1.0, 'HH'),
  ev(1.5, 'BD'),
  ev(2.0, 'SD'),
  ev(2.0, 'CR'),
];

/** Build a valid drums chart and return its serialized file (canonical name). */
function buildChartFile(format: 'chart' | 'mid'): FileEntry {
  const existing = {
    parsedChart: createEmptyChart({
      format,
      resolution: 480,
      bpm: 140,
      timeSignature: {numerator: 4, denominator: 4},
    }),
    assets: [] as FileEntry[],
  };
  const finalDoc = buildChartDocumentFromExistingChart(existing, EVENTS, 4);
  const files = writeChartFolder(finalDoc);
  const canonical = format === 'mid' ? 'notes.mid' : 'notes.chart';
  const chartFile = files.find(f => f.fileName === canonical);
  if (!chartFile) throw new Error(`writeChartFolder produced no ${canonical}`);
  return chartFile;
}

function fakeWav(): ArrayBuffer {
  const sampleRate = 44100;
  const pcm = new Float32Array(sampleRate);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 20) * 0.1;
  return encodeWav(pcm, sampleRate, 2);
}

describe('assembleChartFiles: chart-file name canonicalization', () => {
  test('a notes.edited.chart input assembles to canonical notes.chart', () => {
    const canonical = buildChartFile('chart');
    // Simulate autosave's variant name.
    const editedInput: FileEntry = {
      fileName: 'notes.edited.chart',
      data: canonical.data,
    };

    const packageFiles = assembleChartFiles({
      chartFile: editedInput,
      metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
      audioSources: [{fileName: 'song.opus', data: fakeWav()}],
    });

    expect(packageFiles.some(f => f.fileName === 'notes.chart')).toBe(true);
    expect(packageFiles.some(f => f.fileName.includes('edited'))).toBe(false);
    expect(packageFiles.some(f => f.fileName === 'notes.mid')).toBe(false);
  });

  test('a notes.edited.mid input assembles to canonical notes.mid', () => {
    const canonical = buildChartFile('mid');
    const editedInput: FileEntry = {
      fileName: 'notes.edited.mid',
      data: canonical.data,
    };

    const packageFiles = assembleChartFiles({
      chartFile: editedInput,
      metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
    });

    expect(packageFiles.some(f => f.fileName === 'notes.mid')).toBe(true);
    expect(packageFiles.some(f => f.fileName === 'notes.chart')).toBe(false);
    expect(packageFiles.some(f => f.fileName.includes('edited'))).toBe(false);
  });

  test('a notes.edited.chart in extraAssets never survives to the output', () => {
    const canonical = buildChartFile('chart');
    const strayEditedAsset: FileEntry = {
      fileName: 'notes.edited.chart',
      data: new TextEncoder().encode('[Song]\n{\n}\n'),
    };

    const packageFiles = assembleChartFiles({
      chartFile: {fileName: 'notes.chart', data: canonical.data},
      metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
      extraAssets: [
        strayEditedAsset,
        // A genuine non-chart passthrough must still survive.
        {fileName: 'album.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47])},
      ],
    });

    expect(packageFiles.some(f => f.fileName === 'notes.edited.chart')).toBe(
      false,
    );
    expect(packageFiles.filter(f => f.fileName === 'notes.chart')).toHaveLength(
      1,
    );
    expect(packageFiles.some(f => f.fileName === 'album.png')).toBe(true);
  });

  test('the canonicalized output round-trips cleanly through scan-chart', () => {
    const canonical = buildChartFile('chart');
    const packageFiles = assembleChartFiles({
      chartFile: {fileName: 'notes.edited.chart', data: canonical.data},
      metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
      audioSources: [{fileName: 'song.opus', data: fakeWav()}],
    });

    const entries: Record<string, Uint8Array> = {};
    for (const f of packageFiles) entries[f.fileName] = f.data;
    const unzipped = unzipSync(zipSync(entries));
    const roundTripped: FileEntry[] = Object.entries(unzipped).map(
      ([fileName, data]) => ({fileName, data}),
    );

    const scanned = scanChartFolder(roundTripped);
    expect(scanned.playable).toBe(true);
    expect(scanned.notesData?.instruments).toContain('drums');
  });
});
