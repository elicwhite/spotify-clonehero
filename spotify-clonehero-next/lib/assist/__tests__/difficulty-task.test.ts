/**
 * The pure pieces around the `generate-difficulties` task (plan 0074 Phase
 * 4): `difficulty-input.ts`'s per-instrument input assembly and typed
 * rejections, and `difficulty-tiers.ts`'s reducer-output -> tier-payload
 * conversion that the task's `run` hands to `GenerateDifficultiesCommand`
 * (driven through the task with a `FakeWorker`, so the drums lane/type/flags
 * resolution actually executes).
 */

import {
  createEmptyChart,
  drumTypes,
  noteFlags,
  noteTypes,
} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {OursOutNote} from '@/lib/drum-difficulty/ours/reduce';
import {buildDifficultyGenerationInput} from '../difficulty-input';
import {makeGenerateDifficultiesTask} from '../tasks/generate-difficulties';
import type {
  DifficultyWorkerMessage,
  DifficultyWorkerRequest,
} from '../difficulty-protocol';

class FakeWorker {
  onmessage: ((e: {data: DifficultyWorkerMessage}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: DifficultyWorkerRequest[] = [];
  terminate() {}
  postMessage(msg: DifficultyWorkerRequest) {
    this.posted.push(msg);
  }
  emit(msg: DifficultyWorkerMessage) {
    this.onmessage?.({data: msg});
  }
}

/** Pro-drums doc with an Expert drums track (kick + snare + hi-hat). */
function proDrumsDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.drumType = drumTypes.fourLanePro;
  const drums = emptyTrackData('drums', 'expert');
  addDrumNote(drums, {tick: 0, type: noteTypes.kick});
  addDrumNote(drums, {tick: 480, type: noteTypes.redDrum});
  addDrumNote(drums, {
    tick: 960,
    type: noteTypes.yellowDrum,
    flags: noteFlags.cymbal,
  });
  parsed.trackData.push(drums);
  return {parsedChart: parsed, assets: []};
}

function oursNote(tick: number, lane: string): OursOutNote {
  return {
    tick,
    msTime: tick,
    lane,
    originalLane: lane,
    family: 'cymbal',
    relaned: false,
    confidence: 1,
  } as OursOutNote;
}

describe('buildDifficultyGenerationInput', () => {
  it('builds the drums featurizer input from a pro-drums Expert track', () => {
    const result = buildDifficultyGenerationInput(proDrumsDoc(), 'drums');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.instrument).toBe('drums');
    if (result.input.instrument !== 'drums') return;
    expect(result.input.input.notes.length).toBe(3);
    expect(result.input.input.resolution).toBe(480);
  });

  it('rejects with no-expert-track when the instrument has no Expert track', () => {
    const doc = proDrumsDoc();
    expect(buildDifficultyGenerationInput(doc, 'guitar')).toEqual({
      ok: false,
      reason: 'no-expert-track',
    });
  });

  it('reports five-lane and non-pro four-lane drums distinctly', () => {
    const fiveLane = proDrumsDoc();
    fiveLane.parsedChart.drumType = drumTypes.fiveLane;
    expect(buildDifficultyGenerationInput(fiveLane, 'drums')).toEqual({
      ok: false,
      reason: 'not-pro-drums-five-lane',
    });

    const fourLane = proDrumsDoc();
    fourLane.parsedChart.drumType = drumTypes.fourLane;
    expect(buildDifficultyGenerationInput(fourLane, 'drums')).toEqual({
      ok: false,
      reason: 'not-pro-drums-four-lane',
    });
  });

  it('reports no-drums when the chart has no drum type at all', () => {
    const doc = proDrumsDoc();
    doc.parsedChart.drumType = null;
    expect(buildDifficultyGenerationInput(doc, 'drums')).toEqual({
      ok: false,
      reason: 'no-drums',
    });
  });

  it('hands guitar the Expert track and a chart stripped of every tracks notes', () => {
    const doc = proDrumsDoc();
    const guitar = emptyTrackData('guitar', 'expert');
    guitar.noteEventGroups.push([
      {
        tick: 0,
        msTime: 0,
        length: 0,
        msLength: 0,
        type: noteTypes.green,
        flags: 0,
      },
    ]);
    doc.parsedChart.trackData.push(guitar);

    const result = buildDifficultyGenerationInput(doc, 'guitar');
    expect(result.ok).toBe(true);
    if (!result.ok || result.input.instrument === 'drums') return;
    expect(result.input.expertTrack).toBe(guitar);
    expect(result.input.chart.trackData).toEqual([]);
    expect(result.input.chart.resolution).toBe(480);
    expect(result.input.chart.tempos).toBe(doc.parsedChart.tempos);
  });

  it('rejects a guitar Expert track with no notes before any worker or model download', () => {
    const doc = proDrumsDoc();
    doc.parsedChart.trackData.push(emptyTrackData('guitar', 'expert'));

    expect(buildDifficultyGenerationInput(doc, 'guitar')).toEqual({
      ok: false,
      reason: 'no-expert-notes',
    });
  });
});

describe('generate-difficulties task result conversion', () => {
  it('converts the drums reducers lanes into schema notes per tier', async () => {
    let fake: FakeWorker;
    const task = makeGenerateDifficultiesTask({
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    });
    const built = buildDifficultyGenerationInput(proDrumsDoc(), 'drums');
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const promise = task.run(
      built.input,
      new AbortController().signal,
      () => {},
    );
    fake!.emit({
      type: 'result',
      tiers: {
        kind: 'drums',
        hard: [oursNote(0, 'kick'), oursNote(0, 'hihat')],
        medium: [oursNote(0, 'kick')],
        easy: [],
      },
    });
    const result = await promise;

    expect(result.tiers.hard.notes).toEqual([
      {tick: 0, type: noteTypes.kick, length: 0, flags: noteFlags.none},
      {tick: 0, type: noteTypes.yellowDrum, length: 0, flags: noteFlags.cymbal},
    ]);
    expect(result.tiers.medium.notes).toHaveLength(1);
    expect(result.tiers.easy.notes).toEqual([]);
    // Ours authors no phrase ranges; the tier still carries the (empty)
    // lists the command installs.
    expect(result.tiers.hard.starPowerSections).toEqual([]);
    expect(result.tiers.hard.flexLanes).toEqual([]);
  });

  it('carries a guitar tiers star power, solo and flex-lane ranges through', async () => {
    let fake: FakeWorker;
    const task = makeGenerateDifficultiesTask({
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    });

    const guitarTier = (tick: number) => ({
      instrument: 'guitar',
      difficulty: 'hard',
      noteEventGroups: [
        [
          {
            tick,
            msTime: 0,
            length: 120,
            msLength: 0,
            type: noteTypes.red,
            flags: 0,
          },
        ],
      ],
      starPowerSections: [{tick: 0, length: 480, msTime: 0, msLength: 500}],
      rejectedStarPowerSections: [],
      soloSections: [{tick: 480, length: 480, msTime: 500, msLength: 500}],
      flexLanes: [
        {tick: 960, length: 240, isDouble: false, msTime: 1000, msLength: 250},
      ],
      drumFreestyleSections: [],
      textEvents: [],
      versusPhrases: [],
      animations: [],
      unrecognizedMidiEvents: [],
    });

    const promise = task.run(
      {
        instrument: 'guitar',
        chart: {} as never,
        expertTrack: {} as never,
      },
      new AbortController().signal,
      () => {},
    );
    fake!.emit({
      type: 'result',
      tiers: {
        kind: 'guitar',
        hard: guitarTier(0) as never,
        medium: guitarTier(480) as never,
        easy: guitarTier(960) as never,
      },
    });
    const result = await promise;

    expect(result.tiers.hard.notes).toEqual([
      {tick: 0, type: noteTypes.red, length: 120, flags: 0},
    ]);
    expect(result.tiers.hard.starPowerSections).toEqual([
      {tick: 0, length: 480},
    ]);
    expect(result.tiers.hard.soloSections).toEqual([{tick: 480, length: 480}]);
    expect(result.tiers.hard.flexLanes).toEqual([
      {tick: 960, length: 240, isDouble: false},
    ]);
  });
});
