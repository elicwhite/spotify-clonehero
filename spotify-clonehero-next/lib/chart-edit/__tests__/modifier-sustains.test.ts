/**
 * Regression tests for guitar force modifier sustain-range round-trip.
 *
 * scan-chart's MIDI parser splits SysEx modifier sustains (forceTap, forceOpen)
 * into zero-length events at each note tick. Our patched scan-chart preserves
 * the original sustains in modifierSustains. The MIDI writer uses these to
 * produce sustain-range SysEx that Moonscraper and Clone Hero expect.
 */
import fs from 'fs';
import path from 'path';
import { readChart } from '../reader';
import { writeChart } from '../writer';
import { eventTypes } from '../types';
import { parseMidi } from 'midi-file';

const INPUT_DIR = '/Users/eliwhite/Downloads/Sabaton - Hordes of Khan (Yhughu)';

const hasFixture = fs.existsSync(INPUT_DIR);
const describeIfFixture = hasFixture ? describe : describe.skip;

function loadFiles(dir: string) {
  return fs.readdirSync(dir).map(f => ({
    fileName: f,
    data: new Uint8Array(fs.readFileSync(path.join(dir, f))),
  }));
}

function extractSysEx(midi: ReturnType<typeof parseMidi>, trackName: string) {
  for (const track of midi.tracks) {
    const nameEvt = track.find((e: any) => e.type === 'trackName');
    if (!nameEvt || (nameEvt as any).text !== trackName) continue;

    let absTick = 0;
    const result: { tick: number; isStart: boolean; diff: number; type: number }[] = [];
    for (const ev of track) {
      absTick += ev.deltaTime;
      if ((ev.type === 'sysEx' || ev.type === 'endSysEx') && ev.data) {
        const d = ev.data as Uint8Array;
        if (d[0] === 0x50 && d[1] === 0x53) {
          result.push({ tick: absTick, isStart: d[6] === 0x01, diff: d[4], type: d[5] });
        }
      }
    }
    return result;
  }
  return [];
}

describeIfFixture('guitar force modifier sustain ranges', () => {
  test('modifierSustains preserves original MIDI sustain ranges', () => {
    const inputFiles = loadFiles(INPUT_DIR);
    const input = readChart(inputFiles);

    const guitarExpert = input.trackData.find(
      td => td.instrument === 'guitar' && td.difficulty === 'expert',
    )!;
    expect(guitarExpert.modifierSustains).toBeDefined();
    expect(guitarExpert.modifierSustains.length).toBeGreaterThan(0);

    // Should have 6 forceTap sustain ranges
    const tapSustains = guitarExpert.modifierSustains.filter(
      m => m.type === eventTypes.forceTap,
    );
    expect(tapSustains.length).toBe(6);
    for (const s of tapSustains) {
      expect(s.length).toBeGreaterThan(0);
    }
  });

  test('forceTap SysEx round-trip matches original ranges exactly', () => {
    const inputFiles = loadFiles(INPUT_DIR);
    const input = readChart(inputFiles);

    const written = writeChart(input, 'mid');
    const midFile = written.find(f => f.fileName === 'notes.mid')!;
    const outputParsed = parseMidi(midFile.data);
    const inputMid = inputFiles.find(f => f.fileName === 'notes.mid')!;
    const inputParsed = parseMidi(inputMid.data);

    const inputTapSysEx = extractSysEx(inputParsed, 'PART GUITAR').filter(e => e.type === 0x04);
    const outputTapSysEx = extractSysEx(outputParsed, 'PART GUITAR').filter(e => e.type === 0x04);

    // Same number of events (6 on/off pairs = 12)
    expect(outputTapSysEx.length).toBe(inputTapSysEx.length);

    // All use 0xFF
    for (const se of outputTapSysEx) {
      expect(se.diff).toBe(0xff);
    }

    // Same start/end ticks
    expect(outputTapSysEx).toEqual(inputTapSysEx);
  });

  test('forceTap events survive round-trip with correct ticks', () => {
    const inputFiles = loadFiles(INPUT_DIR);
    const input = readChart(inputFiles);

    const written = writeChart(input, 'mid');
    const reparse = readChart(written);

    const inputTaps = input.trackData
      .find(td => td.instrument === 'guitar' && td.difficulty === 'expert')!
      .trackEvents.filter(e => e.type === eventTypes.forceTap);
    const outputTaps = reparse.trackData
      .find(td => td.instrument === 'guitar' && td.difficulty === 'expert')!
      .trackEvents.filter(e => e.type === eventTypes.forceTap);

    expect(outputTaps.map(t => t.tick)).toEqual(inputTaps.map(t => t.tick));
  });

  test('forceOpen SysEx round-trip produces sustain ranges', () => {
    const inputFiles = loadFiles(INPUT_DIR);
    const input = readChart(inputFiles);

    const written = writeChart(input, 'mid');
    const midFile = written.find(f => f.fileName === 'notes.mid')!;
    const outputParsed = parseMidi(midFile.data);
    const inputMid = inputFiles.find(f => f.fileName === 'notes.mid')!;
    const inputParsed = parseMidi(inputMid.data);

    const inputOpenCount = extractSysEx(inputParsed, 'PART GUITAR').filter(e => e.type === 0x01).length;
    const outputOpenCount = extractSysEx(outputParsed, 'PART GUITAR').filter(e => e.type === 0x01).length;

    // Sustain ranges should produce fewer or equal events
    expect(outputOpenCount).toBeLessThanOrEqual(inputOpenCount);
  });
});
