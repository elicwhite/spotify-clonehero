/**
 * Checks that the film's highway puts every charted note on the strikeline
 * on the frame the timeline gives it.
 *
 *   node --import tsx scripts/qa/highwaySync.ts --timeline <timeline.json|module.ts> \
 *     --chart <chart folder> [--export timeline]
 *
 * For each Expert drum and guitar note in timeline.json, the note's song
 * time comes from the chart as the app parses it (scan-chart's msTime; the
 * app's reader only re-reads four-lane drums as pro drums, which leaves times
 * alone). The frame the highway draws at comes from `songTimeAt`, the
 * mapping the kit's product highway uses. The app places a note at world Y
 * `noteWorldY(noteSec, nowSec)` (src/highway/floor.ts), so the note is on
 * the strikeline at the frame that minimises |noteSec - nowSec|. That frame
 * must be the timeline's `frame` for every note. Exits 1 on any mismatch or
 * any timeline note the chart does not have.
 */
import {parseChartAndIni} from '@eliwhite/scan-chart';
import {STRIKELINE_Y, noteWorldY} from '../../src/highway/floor';
import type {Timeline} from '../../src/music/contract';
import {songTimeAt} from '../../src/music/songTime';
import {assertTimeline} from '../../src/music/validate';
import {readChartFolder} from '../audio/chart';
import {isMain, loadData, need, parseFlags, runCli} from '../lib/cli';

export interface SyncResult {
  instrument: 'drums' | 'guitar';
  notes: number;
  missing: number;
  wrongFrame: {tick: number; frame: number; nearest: number}[];
  maxOffsetMs: number;
}

type TickTimes = ReadonlyMap<number, number>;

/** Song seconds of every note tick in each Expert track of a chart folder. */
export function chartTickTimes(
  folder: string,
): Record<'drums' | 'guitar', TickTimes | null> {
  const chart = parseChartAndIni(readChartFolder(folder)).parsedChart;
  if (!chart) throw new Error(`Could not parse a chart in ${folder}`);
  const times = (instrument: 'drums' | 'guitar'): TickTimes | null => {
    const track = chart.trackData.find(
      t => t.instrument === instrument && t.difficulty === 'expert',
    );
    if (!track) return null;
    const map = new Map<number, number>();
    for (const group of track.noteEventGroups) {
      for (const note of group) map.set(note.tick, note.msTime / 1000);
    }
    return map;
  };
  return {drums: times('drums'), guitar: times('guitar')};
}

/** Every note's strikeline frame against the timeline's. */
export function checkSync(
  timeline: Timeline,
  instrument: 'drums' | 'guitar',
  times: TickTimes,
): SyncResult {
  const nowAt = (frame: number) =>
    songTimeAt(frame / timeline.fps, timeline.segments);
  const result: SyncResult = {
    instrument,
    notes: 0,
    missing: 0,
    wrongFrame: [],
    maxOffsetMs: 0,
  };
  for (const note of timeline.notes[instrument]) {
    const noteSec = times.get(note.tick);
    if (noteSec === undefined) {
      result.missing++;
      continue;
    }
    result.notes++;
    // Distance from the strikeline, in world units, at a frame.
    const distance = (frame: number) =>
      Math.abs(noteWorldY(noteSec, nowAt(frame)) - STRIKELINE_Y);
    let nearest = note.frame;
    for (let frame = note.frame - 3; frame <= note.frame + 3; frame++) {
      // A note exactly between two frames stays on the timeline's (rounded) one.
      if (distance(frame) < distance(nearest) - 1e-9) nearest = frame;
    }
    if (nearest !== note.frame)
      result.wrongFrame.push({tick: note.tick, frame: note.frame, nearest});
    result.maxOffsetMs = Math.max(
      result.maxOffsetMs,
      Math.abs(noteSec - nowAt(note.frame)) * 1000,
    );
  }
  return result;
}

const USAGE = `
Usage: node --import tsx scripts/qa/highwaySync.ts --timeline <timeline.json|module.ts>
         --chart <chart folder> [--export timeline]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    timeline: {type: 'string'},
    export: {type: 'string', default: 'timeline'},
    chart: {type: 'string'},
  });
  const file = need(values.timeline, 'timeline');
  const timeline = assertTimeline(await loadData(file, values.export), file);
  const tracks = chartTickTimes(need(values.chart, 'chart'));
  let failed = false;
  for (const instrument of ['drums', 'guitar'] as const) {
    const times = tracks[instrument];
    if (!times) {
      if (timeline.notes[instrument].length) {
        console.log(
          `${instrument}: the timeline has notes but the chart has no Expert track`,
        );
        failed = true;
      }
      continue;
    }
    const r = checkSync(timeline, instrument, times);
    console.log(
      `${instrument}: ${r.notes} notes checked, ${r.wrongFrame.length} on the wrong frame, ` +
        `${r.missing} not in the chart, max |note time - frame time| ${r.maxOffsetMs.toFixed(3)} ms ` +
        `(half a frame is ${(500 / timeline.fps).toFixed(3)} ms)`,
    );
    for (const miss of r.wrongFrame.slice(0, 10)) {
      console.log(
        `  tick ${miss.tick}: timeline frame ${miss.frame}, strikeline frame ${miss.nearest}`,
      );
    }
    if (r.wrongFrame.length || r.missing) failed = true;
  }
  if (failed) process.exitCode = 1;
}

if (isMain(import.meta.url)) runCli(USAGE, main);
