/**
 * Tests for `song_length` and `diff_drums_real` stamping in
 * {@link assembleChartFiles}.
 *
 * `song_length` prefers an explicit `songLengthMs` (sourced from the actual
 * decoded audio duration by the export dialog) and falls back to the chart's
 * own last event time when omitted. `diff_drums_real` always mirrors
 * `diff_drums` — this pipeline doesn't produce a separate Phase Shift
 * "real drums" chart.
 */

import {describe, test, expect} from '@jest/globals';
import type {File as FileEntry} from '@eliwhite/scan-chart';

import {createEmptyChart, writeChartFolder} from '@/lib/chart-edit';
import {buildChartDocumentFromExistingChart} from '@/lib/drum-transcription/pipeline/chart-builder';
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

// Last note lands at 2.0s -- the chart-end fallback should land near there.
const EVENTS: RawDrumEvent[] = [
  ev(0.5, 'BD'),
  ev(0.5, 'HH'),
  ev(1.0, 'SD'),
  ev(1.0, 'HH'),
  ev(1.5, 'BD'),
  ev(2.0, 'SD'),
  ev(2.0, 'CR'),
];

function buildChartFile(): FileEntry {
  const existing = {
    parsedChart: createEmptyChart({
      format: 'chart',
      resolution: 480,
      bpm: 140,
      timeSignature: {numerator: 4, denominator: 4},
    }),
    assets: [] as FileEntry[],
  };
  const finalDoc = buildChartDocumentFromExistingChart(existing, EVENTS, 4);
  const files = writeChartFolder(finalDoc);
  const chartFile = files.find(f => f.fileName === 'notes.chart');
  if (!chartFile) throw new Error('writeChartFolder produced no notes.chart');
  return chartFile;
}

/** Parse `song.ini`'s `[song]` section into a plain key/value map. */
function parseIniEntries(packageFiles: FileEntry[]): Record<string, string> {
  const iniFile = packageFiles.find(f => f.fileName === 'song.ini');
  if (!iniFile) throw new Error('assembleChartFiles produced no song.ini');
  const text = new TextDecoder().decode(iniFile.data);
  const entries: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

describe('assembleChartFiles: song_length + diff_drums_real', () => {
  test('song_length is stamped from the provided songLengthMs', () => {
    const canonical = buildChartFile();
    const packageFiles = assembleChartFiles({
      chartFile: canonical,
      metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
      songLengthMs: 123_456,
    });

    const ini = parseIniEntries(packageFiles);
    expect(ini['song_length']).toBe('123456');
  });

  test('song_length falls back to the chart-end time when omitted', () => {
    const canonical = buildChartFile();
    const packageFiles = assembleChartFiles({
      chartFile: canonical,
      metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
    });

    const ini = parseIniEntries(packageFiles);
    expect(ini['song_length']).toBeDefined();
    const fallbackMs = Number(ini['song_length']);
    // The last note is at ~2.0s; the fallback should land at or after it,
    // and well short of a nonsense magnitude.
    expect(fallbackMs).toBeGreaterThanOrEqual(1900);
    expect(fallbackMs).toBeLessThan(5000);
  });

  test('song_length falls back when songLengthMs is non-positive', () => {
    const canonical = buildChartFile();
    const packageFiles = assembleChartFiles({
      chartFile: canonical,
      metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
      songLengthMs: 0,
    });

    const ini = parseIniEntries(packageFiles);
    const fallbackMs = Number(ini['song_length']);
    expect(fallbackMs).toBeGreaterThanOrEqual(1900);
  });

  test('diff_drums_real mirrors diff_drums', () => {
    const canonical = buildChartFile();
    const packageFiles = assembleChartFiles({
      chartFile: canonical,
      metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
    });

    const ini = parseIniEntries(packageFiles);
    expect(ini['diff_drums']).toBeDefined();
    expect(ini['diff_drums_real']).toBe(ini['diff_drums']);
  });
});
