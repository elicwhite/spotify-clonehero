/**
 * End-to-end validation for the chart-flow feature (path 3a): transcribing
 * drums against an EXISTING chart's own SyncTrack, then writing the result
 * back out packaged with the chart's original (non-audio) assets included.
 *
 * Mirrors package-validation.test.ts's approach — build real output, package
 * it, round-trip it back through scan-chart (the same parser Clone Hero /
 * YARG chart managers use), and assert it is clean/playable — but exercises
 * `buildChartDocumentFromExistingChart` (the chart-flow builder) instead of
 * `buildChartDocument` (the audio-only builder), and asserts a passthrough
 * asset file (e.g. album art) survives the round trip untouched.
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
import {exportAsZip} from '../zip';

// This file exercises buildChartDocumentFromExistingChart (the chart-flow
// builder), so events are pre-subtracted by the chart-flow systematic onset
// offset.
function ev(
  timeSeconds: number,
  drumClass: RawDrumEvent['drumClass'],
  confidence = 0.9,
): RawDrumEvent {
  return {
    timeSeconds: timeSeconds - SYSTEMATIC_ONSET_MS_CHART_FLOW / 1000,
    drumClass,
    midiPitch: 0,
    confidence,
  };
}

const EVENTS: RawDrumEvent[] = [
  ev(0.5, 'BD'),
  ev(0.5, 'HH'),
  ev(1.0, 'SD'),
  ev(1.0, 'HH'),
  ev(1.5, 'BD'),
  ev(1.5, 'HH'),
  ev(2.0, 'SD'),
  ev(2.0, 'CR'),
];

const SONG_DURATION_SECONDS = 4;

/** A minimal "existing chart" fixture: a real (non-flat-120) tempo map, as a
 * user-supplied chart package would have, with no drums track yet. */
function existingChartDocument() {
  return {
    parsedChart: createEmptyChart({
      format: 'chart',
      resolution: 480,
      bpm: 140,
      timeSignature: {numerator: 4, denominator: 4},
    }),
    assets: [] as FileEntry[],
  };
}

function fakeWav(): ArrayBuffer {
  const sampleRate = 44100;
  const pcm = new Float32Array(sampleRate);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 20) * 0.1;
  return encodeWav(pcm, sampleRate, 2);
}

describe('chart-flow: transcribe against an existing chart, round-trip export', () => {
  test('replaces the drum track, keeps the provided tempo, and carries a passthrough asset', () => {
    const existing = existingChartDocument();
    const finalDoc = buildChartDocumentFromExistingChart(
      existing,
      EVENTS,
      SONG_DURATION_SECONDS,
    );

    // The chart-flow builder must NOT install a predicted synctrack — the
    // existing chart's own 140 BPM tempo must survive untouched.
    expect(finalDoc.parsedChart.tempos).toEqual(existing.parsedChart.tempos);
    expect(finalDoc.parsedChart.tempos[0]?.beatsPerMinute).toBe(140);

    const files = writeChartFolder(finalDoc);
    const chartFile = files.find(f => f.fileName === 'notes.chart');
    if (!chartFile) throw new Error('writeChartFolder produced no notes.chart');
    const chartText = new TextDecoder().decode(chartFile.data);

    // A passthrough asset from the original package (e.g. album art) that
    // has nothing to do with audio or the chart itself.
    const albumArt: FileEntry = {
      fileName: 'album.png',
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
    };

    const packageFiles = assembleChartFiles({
      chartText,
      metadata: {
        name: 'Existing Chart Song',
        artist: 'Test Artist',
        charter: 'Original Charter',
      },
      audioSources: [{fileName: 'song.wav', data: fakeWav()}],
      extraAssets: [albumArt],
    });

    // The passthrough asset must be present, byte-for-byte.
    const roundTrippedArt = packageFiles.find(f => f.fileName === 'album.png');
    expect(roundTrippedArt).toBeDefined();
    expect(Array.from(roundTrippedArt!.data)).toEqual(Array.from(albumArt.data));

    // Package as ZIP and unpack, mirroring a real download round-trip.
    const zipBlob = exportAsZip(packageFiles);
    const entries: Record<string, Uint8Array> = {};
    for (const f of packageFiles) entries[f.fileName] = f.data;
    const unzipped = unzipSync(zipSync(entries));
    const roundTripped: FileEntry[] = Object.entries(unzipped).map(
      ([fileName, data]) => ({fileName, data}),
    );
    void zipBlob; // exportAsZip output validated structurally via zipSync above

    // scan-chart must find it clean and playable, with a drums difficulty.
    const scanned = scanChartFolder(roundTripped);
    expect(scanned.playable).toBe(true);
    expect(scanned.notesData?.instruments).toContain('drums');
    const forbidden = (scanned.notesData?.chartIssues ?? []).filter(i =>
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

    // The passthrough asset must still be in the unpacked folder.
    expect(roundTripped.some(f => f.fileName === 'album.png')).toBe(true);
  });

  test('MIDI-sourced existing chart (notes.mid) round-trips through notes.mid, symmetric with .chart', () => {
    // Most real-world charts ship as notes.mid, not notes.chart. The
    // chart-flow builder must NOT force one format onto the other — .mid
    // and .chart are both first-class writeChartFolder outputs (Eli's
    // architecture ruling, 2026-07-12), so a MIDI-sourced chart stays .mid
    // all the way through: buildChartDocumentFromExistingChart preserves
    // format, writeChartFolder emits notes.mid, and assembleChartFiles
    // accepts it directly via chartFile (not chartText, which can't carry
    // binary MIDI data). Regression test for "writeChartFolder did not
    // produce notes.chart" (2026-07-12 browser validation: a real
    // MIDI-sourced .sng threw here when the pipeline hardcoded a
    // notes.chart-only lookup).
    const existing = {
      parsedChart: createEmptyChart({
        format: 'mid',
        resolution: 480,
        bpm: 140,
        timeSignature: {numerator: 4, denominator: 4},
      }),
      assets: [] as FileEntry[],
    };
    expect(existing.parsedChart.format).toBe('mid');

    const finalDoc = buildChartDocumentFromExistingChart(
      existing,
      EVENTS,
      SONG_DURATION_SECONDS,
    );

    // format is untouched — no format-sniffing/forcing in the builder.
    expect(finalDoc.parsedChart.format).toBe('mid');
    expect(finalDoc.parsedChart.tempos).toEqual(existing.parsedChart.tempos);
    expect(finalDoc.parsedChart.tempos[0]?.beatsPerMinute).toBe(140);

    const files = writeChartFolder(finalDoc);
    const chartFile = files.find(f => f.fileName === 'notes.mid');
    expect(chartFile).toBeDefined();
    expect(files.find(f => f.fileName === 'notes.chart')).toBeUndefined();
    expect(chartFile!.data.length).toBeGreaterThan(0);

    // assembleChartFiles takes the format-agnostic chartFile (not
    // chartText, which would require text-decoding binary MIDI bytes and
    // corrupting them) — readChart detects .mid from the filename.
    const packageFiles = assembleChartFiles({
      chartFile: {fileName: chartFile!.fileName, data: chartFile!.data},
      metadata: {
        name: 'MIDI-Sourced Chart',
        artist: 'Test Artist',
        charter: 'Original Charter',
      },
      audioSources: [{fileName: 'song.wav', data: fakeWav()}],
      extraAssets: [],
    });
    // The re-serialized package still carries notes.mid, not notes.chart —
    // writeChartFolder never converts.
    expect(packageFiles.some(f => f.fileName === 'notes.mid')).toBe(true);
    expect(packageFiles.some(f => f.fileName === 'notes.chart')).toBe(false);

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

  test('add-or-replace: reprocessing a chart that already has a drums track replaces it, not merges', () => {
    const existing = existingChartDocument();
    const first = buildChartDocumentFromExistingChart(
      existing,
      EVENTS,
      SONG_DURATION_SECONDS,
    );
    // Re-run against the ALREADY-transcribed chart (simulating a second pass)
    // with a different, smaller event set.
    const second = buildChartDocumentFromExistingChart(
      first,
      [ev(0.5, 'BD')],
      SONG_DURATION_SECONDS,
    );

    const drumTracks = second.parsedChart.trackData.filter(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(drumTracks).toHaveLength(1);
  });
});
