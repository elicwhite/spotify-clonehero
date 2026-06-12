/**
 * Test helpers: build synthetic ParsedCharts with planted grooves and fills.
 */

import {createEmptyChart, noteTypes, noteFlags} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@eliwhite/scan-chart';

export const RES = 192;

type Voice =
  | 'kick'
  | 'snare'
  | 'hatYellow'
  | 'tomYellow'
  | 'tomBlue'
  | 'tomGreen'
  | 'crashGreen'
  | 'crashBlue';

const VOICE_DEF: Record<Voice, {type: number; flags: number}> = {
  kick: {type: noteTypes.kick, flags: 0},
  snare: {type: noteTypes.redDrum, flags: 0},
  hatYellow: {type: noteTypes.yellowDrum, flags: noteFlags.cymbal},
  tomYellow: {type: noteTypes.yellowDrum, flags: noteFlags.tom},
  tomBlue: {type: noteTypes.blueDrum, flags: noteFlags.tom},
  tomGreen: {type: noteTypes.greenDrum, flags: noteFlags.tom},
  crashGreen: {type: noteTypes.greenDrum, flags: noteFlags.cymbal},
  crashBlue: {type: noteTypes.blueDrum, flags: noteFlags.cymbal},
};

export interface PlannedNote {
  /** Absolute tick. */
  tick: number;
  voices: Voice[];
  /** Extra flags (e.g. ghost/flam) applied to every note in the group. */
  extraFlags?: number;
}

/** Group planned notes by tick into noteEventGroups. */
function toGroups(notes: PlannedNote[], bpm: number) {
  const msPerTick = 60000 / (bpm * RES);
  const byTick = new Map<number, PlannedNote[]>();
  for (const n of notes) {
    const arr = byTick.get(n.tick) ?? [];
    arr.push(n);
    byTick.set(n.tick, arr);
  }
  const groups = [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, planned]) => {
      const group: ReturnType<typeof makeNote>[] = [];
      for (const p of planned) {
        for (const v of p.voices) {
          const def = VOICE_DEF[v];
          group.push(
            makeNote(
              tick,
              def.type,
              def.flags | (p.extraFlags ?? 0),
              msPerTick,
            ),
          );
        }
      }
      return group;
    });
  return groups;
}

function makeNote(
  tick: number,
  type: number,
  flags: number,
  msPerTick: number,
) {
  return {
    tick,
    msTime: tick * msPerTick,
    length: 0,
    msLength: 0,
    type,
    flags,
  };
}

export interface BuildOptions {
  bpm?: number;
  resolution?: number;
  timeSignatures?: {tick: number; numerator: number; denominator: number}[];
  tempos?: {tick: number; beatsPerMinute: number}[];
  sections?: {tick: number; name: string}[];
  notes: PlannedNote[];
  /** If false, omit the Expert drums track entirely. */
  hasDrums?: boolean;
}

/** Build a ParsedChart with an Expert drums track from planned notes. */
export function buildChart(options: BuildOptions): ParsedChart {
  const resolution = options.resolution ?? RES;
  const bpm = options.bpm ?? 120;
  const chart = createEmptyChart({format: 'chart', resolution, bpm});
  const msPerTick = 60000 / (bpm * resolution);

  const tempos = (options.tempos ?? [{tick: 0, beatsPerMinute: bpm}]).map(
    t => ({
      tick: t.tick,
      beatsPerMinute: t.beatsPerMinute,
      msTime: t.tick * msPerTick,
    }),
  );

  const timeSignatures = (
    options.timeSignatures ?? [{tick: 0, numerator: 4, denominator: 4}]
  ).map(s => ({
    tick: s.tick,
    numerator: s.numerator,
    denominator: s.denominator,
    msTime: s.tick * msPerTick,
    msLength: 0,
  }));

  const sections = (options.sections ?? []).map(s => ({
    tick: s.tick,
    name: s.name,
    msTime: s.tick * msPerTick,
    msLength: 0,
  }));

  const trackData =
    options.hasDrums === false
      ? []
      : [
          {
            instrument: 'drums' as const,
            difficulty: 'expert' as const,
            starPowerSections: [],
            rejectedStarPowerSections: [],
            soloSections: [],
            flexLanes: [],
            drumFreestyleSections: [],
            trackEvents: [],
            textEvents: [],
            versusPhrases: [],
            animations: [],
            unrecognizedMidiEvents: [],
            noteEventGroups: toGroups(options.notes, bpm),
          },
        ];

  return {
    ...chart,
    resolution,
    tempos,
    timeSignatures,
    sections,
    trackData,
  } as unknown as ParsedChart;
}

/**
 * A standard 4/4 backbeat groove for one bar starting at `barStart`.
 * kick on 1 & 3, snare on 2 & 4, hat on every 8th.
 */
export function backbeatBar(barStart: number, resolution = RES): PlannedNote[] {
  const eighth = resolution / 2;
  const notes: PlannedNote[] = [];
  for (let i = 0; i < 8; i++) {
    const tick = barStart + i * eighth;
    const voices: Voice[] = ['hatYellow'];
    if (i === 0 || i === 4) voices.push('kick');
    if (i === 2 || i === 6) voices.push('snare');
    notes.push({tick, voices});
  }
  return notes;
}

/** A 16th-note tom fill across one bar ending on a green crash. */
export function tomFillBar(barStart: number, resolution = RES): PlannedNote[] {
  const sixteenth = resolution / 4;
  const notes: PlannedNote[] = [];
  const toms: Voice[] = ['snare', 'tomYellow', 'tomBlue', 'tomGreen'];
  for (let i = 0; i < 16; i++) {
    const tick = barStart + i * sixteenth;
    notes.push({tick, voices: [toms[Math.floor(i / 4)]]});
  }
  return notes;
}
