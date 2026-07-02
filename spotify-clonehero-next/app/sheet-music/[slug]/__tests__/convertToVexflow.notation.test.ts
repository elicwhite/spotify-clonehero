/**
 * Ported from sightkick's chart-parser test suite (src/chart-parser/parser.test.ts)
 * and adapted to our convertToVexFlow API: the drum track is passed in directly
 * (no difficulty lookup), timeSig is the scan-chart TimeSignature object, and
 * notes carry noteIds/ms for the drum-fills overlay and playhead.
 */

import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import convertToVexFlow, {Measure, Note} from '../convertToVexflow';
import {tickToMs} from '@/lib/chart-utils/tickToMs';

type Ev = {type: number; flags?: number};

type GroupSpec = {tick: number; events: Ev[]};

const KICK: Ev = {type: noteTypes.kick};
const DOUBLE_KICK: Ev = {type: noteTypes.kick, flags: noteFlags.doubleKick};
const SNARE: Ev = {type: noteTypes.redDrum};
const TOM_YELLOW: Ev = {type: noteTypes.yellowDrum};
const TOM_BLUE: Ev = {type: noteTypes.blueDrum};
const TOM_GREEN: Ev = {type: noteTypes.greenDrum};
const HIHAT: Ev = {type: noteTypes.yellowDrum, flags: noteFlags.cymbal};
const CRASH: Ev = {type: noteTypes.greenDrum, flags: noteFlags.cymbal};
const BASE: {[duration: string]: number} = {
  w: 1,
  h: 1 / 2,
  q: 1 / 4,
  '8': 1 / 8,
  '16': 1 / 16,
  '32': 1 / 32,
  '64': 1 / 64,
};

function group(tick: number, ...events: Ev[]): GroupSpec {
  return {tick, events};
}

type ChartOpts = {
  resolution?: number;
  timeSignatures?: {tick: number; numerator: number; denominator: number}[];
  groups?: GroupSpec[];
};

function makeChart(opts: ChartOpts) {
  const chart = {
    resolution: opts.resolution ?? 192,
    timeSignatures: opts.timeSignatures ?? [],
    tempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
    trackData: [
      {
        instrument: 'drums',
        difficulty: 'expert',
        noteEventGroups: (opts.groups ?? []).map(g =>
          g.events.map(e => ({
            tick: g.tick,
            type: e.type,
            flags: e.flags ?? 0,
            length: 0,
          })),
        ),
      },
    ],
  };

  return chart as unknown as Parameters<typeof convertToVexFlow>[0];
}

function parse(opts: ChartOpts): Measure[] {
  const chart = makeChart(opts);
  return convertToVexFlow(chart, chart.trackData[0]);
}

function tupletRatios(measure: Measure): Map<number, number> {
  const map = new Map<number, number>();

  measure.tuplets.forEach(t => map.set(t.id, t.notesOccupied / t.numNotes));

  return map;
}

function noteFraction(note: Note, ratios: Map<number, number>): number {
  let fraction = BASE[note.duration] * (note.dots === 1 ? 1.5 : 1);

  if (note.tupletId !== undefined) {
    fraction *= ratios.get(note.tupletId) ?? 1;
  }

  return fraction;
}

function measureFilledFraction(measure: Measure): number {
  const ratios = tupletRatios(measure);

  return measure.notes.reduce(
    (sum, note) => sum + noteFraction(note, ratios),
    0,
  );
}

function expectedMeasureFraction(measure: Measure): number {
  return measure.timeSig.numerator / measure.timeSig.denominator;
}

function hitKeys(measures: Measure[]): string[] {
  const keys: string[] = [];

  measures.forEach(measure =>
    measure.notes.forEach(note => {
      if (!note.isRest) {
        keys.push(...note.notes);
      }

      note.graceNotes?.forEach(chord => keys.push(...chord));
    }),
  );

  return keys.sort();
}

function nonRest(measure: Measure): Note[] {
  return measure.notes.filter(note => !note.isRest);
}

describe('measure creation', () => {
  it('defaults to 4/4 when no time signatures are present', () => {
    const measures = parse({groups: [group(0, SNARE)]});

    expect(measures).toHaveLength(1);
    expect(measures[0].timeSig.numerator).toBe(4);
    expect(measures[0].timeSig.denominator).toBe(4);
    expect(measures[0].startTick).toBe(0);
    expect(measures[0].endTick).toBe(768);
  });

  it('produces no measures for an empty track', () => {
    expect(parse({groups: []})).toEqual([]);
  });

  it('creates a measure for a note past the first bar', () => {
    const measures = parse({groups: [group(0, SNARE), group(500, SNARE)]});

    expect(measures).toHaveLength(1);
  });

  it('marks only the first measure with a clef', () => {
    const measures = parse({
      resolution: 192,
      groups: [group(0, SNARE), group(768, SNARE)],
    });

    expect(measures).toHaveLength(2);
    expect(measures[0].hasClef).toBe(true);
    expect(measures[1].hasClef).toBe(false);
  });

  it('chains measure start/end ticks contiguously', () => {
    const measures = parse({
      groups: [group(0, SNARE), group(768, SNARE), group(1536, SNARE)],
    });

    expect(measures.map(m => [m.startTick, m.endTick])).toEqual([
      [0, 768],
      [768, 1536],
      [1536, 2304],
    ]);
  });

  it('creates measures across a time-signature change and flags it', () => {
    const measures = parse({
      timeSignatures: [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: 768, numerator: 3, denominator: 4},
      ],
      groups: [group(0, SNARE), group(768, SNARE), group(960, SNARE)],
    });
    const sigs = measures.map(m => ({
      timeSig: [m.timeSig.numerator, m.timeSig.denominator],
      sigChange: m.sigChange,
      start: m.startTick,
      end: m.endTick,
    }));

    expect(sigs).toEqual([
      {timeSig: [4, 4], sigChange: true, start: 0, end: 768},
      {timeSig: [3, 4], sigChange: true, start: 768, end: 768 + 576},
    ]);
  });

  it('handles a compound 6/8 meter', () => {
    const measures = parse({
      resolution: 192,
      timeSignatures: [{tick: 0, numerator: 6, denominator: 8}],
      groups: [group(0, SNARE)],
    });

    expect(measures).toHaveLength(1);

    const measure = measures[0];

    expect(measure.isCompound).toBe(true);
    expect(measure.startTick).toBe(0);
    expect(measure.endTick).toBe(576);
    expect(measure.beats).toHaveLength(2);
  });

  it('exposes beat boundaries for the click track', () => {
    const measures = parse({groups: [group(0, SNARE)]});

    expect(measures[0].beats).toEqual([
      {startTick: 0, endTick: 192},
      {startTick: 192, endTick: 384},
      {startTick: 384, endTick: 576},
      {startTick: 576, endTick: 768},
    ]);
  });
});

describe('drum key mapping', () => {
  it('maps a four-lane chord to sorted staff keys', () => {
    const measures = parse({groups: [group(0, KICK, SNARE, HIHAT, CRASH)]});
    const hits = nonRest(measures[0]);

    expect(hits).toHaveLength(1);
    expect(hits[0].notes).toEqual(['f/4', 'c/5', 'g/5/x2', 'a/5/x2']);
  });

  it('distinguishes toms from cymbals in four-lane mode', () => {
    const measures = parse({
      groups: [
        group(0, TOM_YELLOW),
        group(192, TOM_BLUE),
        group(384, TOM_GREEN),
      ],
    });

    expect(hitKeys(measures)).toEqual(['a/4', 'd/5', 'e/5']);
  });

  it('maps a double kick to its own staff position', () => {
    const measures = parse({groups: [group(0, DOUBLE_KICK)]});

    expect(hitKeys(measures)).toEqual(['e/4']);
  });

  it('carries a fill-note id per notehead, parallel to notes', () => {
    const measures = parse({groups: [group(192, KICK, SNARE)]});
    const hit = nonRest(measures[0])[0];

    expect(hit.notes).toEqual(['f/4', 'c/5']);
    expect(hit.noteIds).toEqual(['192:kick:p', '192:red:p']);
  });

  it('gives rests a null note id', () => {
    const measures = parse({groups: [group(192, SNARE)]});
    const rest = measures[0].notes.find(n => n.isRest);

    expect(rest?.noteIds).toEqual([null]);
  });
});

describe('rhythm notation', () => {
  it('notates four on-grid quarter notes literally with no rests or tuplets', () => {
    const measures = parse({
      groups: [
        group(0, SNARE),
        group(192, SNARE),
        group(384, SNARE),
        group(576, SNARE),
      ],
    });
    const measure = measures[0];

    expect(measure.tuplets).toEqual([]);
    expect(measure.notes).toHaveLength(4);
    expect(measure.notes.every(n => n.duration === 'q' && !n.isRest)).toBe(
      true,
    );
  });

  it('notates straight eighth notes within a beat', () => {
    const measures = parse({
      groups: [group(0, SNARE), group(96, SNARE)],
    });
    const measure = measures[0];
    const beatOne = measure.notes.filter(n => n.tick < 192 && !n.isRest);

    expect(beatOne).toHaveLength(2);
    expect(beatOne.every(n => n.duration === '8')).toBe(true);
    expect(measure.tuplets).toEqual([]);
  });

  it('notates an eighth-note triplet as a 3:2 tuplet', () => {
    const measures = parse({
      groups: [group(0, SNARE), group(64, SNARE), group(128, SNARE)],
    });
    const measure = measures[0];

    expect(measure.tuplets).toHaveLength(1);
    expect(measure.tuplets[0]).toMatchObject({numNotes: 3, notesOccupied: 2});

    const tripletNotes = measure.notes.filter(
      n => n.tupletId === measure.tuplets[0].id,
    );

    expect(tripletNotes).toHaveLength(3);
    expect(tripletNotes.every(n => n.duration === '8')).toBe(true);
  });

  it('notates a sixteenth-note quintuplet as a 5:4 tuplet', () => {
    const spacing = 192 / 5;
    const measures = parse({
      groups: [0, 1, 2, 3, 4].map(i => group(Math.round(i * spacing), SNARE)),
    });
    const measure = measures[0];

    expect(measure.tuplets).toHaveLength(1);
    expect(measure.tuplets[0]).toMatchObject({numNotes: 5, notesOccupied: 4});
  });

  it('fills an empty measure with a single whole rest', () => {
    const measures = parse({
      groups: [group(0, SNARE), group(1536, SNARE)],
    });
    const empty = measures[1];

    expect(empty.notes).toHaveLength(1);
    expect(empty.notes[0]).toMatchObject({
      notes: ['b/4'],
      duration: 'w',
      dots: 0,
      isRest: true,
      tick: 768,
    });
  });

  it('puts a leading rest before an onset on beat two', () => {
    const measures = parse({groups: [group(192, SNARE)]});
    const measure = measures[0];
    const firstHit = nonRest(measure)[0];

    expect(firstHit.tick).toBe(192);
    expect(measure.notes[0].isRest).toBe(true);
    expect(measure.notes[0].tick).toBe(0);
  });
});

describe('coincidence resolution', () => {
  it('merges different drums at the same tick into one chord', () => {
    const measures = parse({groups: [group(0, KICK, SNARE)]});
    const hits = nonRest(measures[0]);

    expect(hits).toHaveLength(1);
    expect(hits[0].notes).toEqual(['f/4', 'c/5']);
    expect(hits[0].graceNotes).toBeUndefined();
  });

  it('turns a same-drum repeat that is too close into a flam grace note', () => {
    const measures = parse({groups: [group(0, SNARE), group(5, SNARE)]});
    const hits = nonRest(measures[0]);

    expect(hits).toHaveLength(1);
    expect(hits[0].notes).toEqual(['c/5']);
    expect(hits[0].graceNotes).toEqual([['c/5']]);
  });

  it('keeps the grace note id of a collapsed flam', () => {
    const measures = parse({groups: [group(0, SNARE), group(5, SNARE)]});
    const hit = nonRest(measures[0])[0];

    expect(hit.noteIds).toEqual(['5:red:p']);
    expect(hit.graceNoteIds).toEqual([['0:red:p']]);
  });

  it('keeps every hit when collapsing a dense cluster', () => {
    const measures = parse({
      groups: [
        group(0, KICK),
        group(3, SNARE),
        group(6, KICK),
        group(9, SNARE),
      ],
    });

    expect(hitKeys(measures)).toEqual(['c/5', 'c/5', 'f/4', 'f/4']);
  });
});

describe('dynamics', () => {
  const ACCENT_SNARE: Ev = {
    type: noteTypes.redDrum,
    flags: noteFlags.accent,
  };
  const GHOST_SNARE: Ev = {type: noteTypes.redDrum, flags: noteFlags.ghost};

  it('marks an accented hit', () => {
    const measures = parse({groups: [group(0, ACCENT_SNARE)]});
    const hits = nonRest(measures[0]);

    expect(hits[0].accents).toEqual(['c/5']);
    expect(hits[0].ghosts).toBeUndefined();
  });

  it('marks a ghost hit', () => {
    const measures = parse({groups: [group(0, GHOST_SNARE)]});
    const hits = nonRest(measures[0]);

    expect(hits[0].ghosts).toEqual(['c/5']);
    expect(hits[0].accents).toBeUndefined();
  });

  it('marks only the flagged key in a chord', () => {
    const measures = parse({groups: [group(0, KICK, ACCENT_SNARE)]});
    const hits = nonRest(measures[0]);

    expect(hits[0].notes).toEqual(['f/4', 'c/5']);
    expect(hits[0].accents).toEqual(['c/5']);
  });

  it('leaves an unflagged hit without dynamics', () => {
    const measures = parse({groups: [group(0, SNARE)]});
    const hits = nonRest(measures[0]);

    expect(hits[0].accents).toBeUndefined();
    expect(hits[0].ghosts).toBeUndefined();
  });

  it('keeps the dynamic of the main hit when collapsing a flam', () => {
    const measures = parse({
      groups: [group(0, SNARE), group(5, ACCENT_SNARE)],
    });
    const hits = nonRest(measures[0]);

    expect(hits[0].graceNotes).toEqual([['c/5']]);
    expect(hits[0].accents).toEqual(['c/5']);
  });
});

describe('beat bucketing tolerance', () => {
  it('snaps an onset just before a beat boundary onto the next beat', () => {
    const measures = parse({groups: [group(188, SNARE)]});
    const hit = nonRest(measures[0])[0];

    expect(hit.tick).toBe(192);
  });

  it('snaps an onset just before a measure boundary into the next measure', () => {
    const measures = parse({
      groups: [group(0, SNARE), group(764, SNARE), group(1000, SNARE)],
    });

    expect(nonRest(measures[0]).map(n => n.tick)).toEqual([0]);
    expect(nonRest(measures[1])[0].tick).toBe(768);
  });

  it('stamps ms from the original onset tick, not the snapped grid position', () => {
    const opts: ChartOpts = {
      groups: [group(0, SNARE), group(764, SNARE), group(1000, SNARE)],
    };
    const chart = makeChart(opts);
    const measures = convertToVexFlow(chart, chart.trackData[0]);
    const snapped = nonRest(measures[1])[0];

    expect(snapped.tick).toBe(768);
    expect(snapped.ms).toBeCloseTo(tickToMs(chart, 764));
  });
});

describe('structural invariants', () => {
  const charts: {name: string; opts: ChartOpts}[] = [
    {
      name: 'straight quarters',
      opts: {
        groups: [
          group(0, SNARE),
          group(192, KICK),
          group(384, SNARE),
          group(576, KICK),
        ],
      },
    },
    {
      name: 'sixteenth run',
      opts: {
        groups: [0, 48, 96, 144, 192, 240, 288, 336].map(t =>
          group(t, t % 96 === 0 ? SNARE : HIHAT),
        ),
      },
    },
    {
      name: 'triplets and duplets mixed',
      opts: {
        groups: [
          group(0, SNARE),
          group(64, SNARE),
          group(128, SNARE),
          group(192, KICK),
          group(288, KICK),
        ],
      },
    },
    {
      name: 'compound 6/8',
      opts: {
        timeSignatures: [{tick: 0, numerator: 6, denominator: 8}],
        groups: [
          group(0, KICK),
          group(96, HIHAT),
          group(192, HIHAT),
          group(288, SNARE),
        ],
      },
    },
    {
      name: 'off-grid humanized',
      opts: {
        groups: [
          group(3, SNARE),
          group(190, KICK),
          group(389, SNARE),
          group(580, KICK),
        ],
      },
    },
    {
      name: '3/4 with syncopation',
      opts: {
        timeSignatures: [{tick: 0, numerator: 3, denominator: 4}],
        groups: [group(0, SNARE), group(96, KICK), group(288, SNARE)],
      },
    },
  ];

  charts.forEach(({name, opts}) => {
    describe(name, () => {
      it('preserves every charted hit', () => {
        const measures = parse(opts);
        const input = (opts.groups ?? [])
          .flatMap(g => g.events.map(e => e))
          .map(e => keyFor(e))
          .sort();

        expect(hitKeys(measures)).toEqual(input);
      });

      it('fills each measure to exactly its time-signature duration', () => {
        const measures = parse(opts);

        measures.forEach(measure => {
          expect(measureFilledFraction(measure)).toBeCloseTo(
            expectedMeasureFraction(measure),
            6,
          );
        });
      });

      it('keeps notes ordered and inside their measure', () => {
        const measures = parse(opts);

        measures.forEach(measure => {
          let last = -Infinity;

          measure.notes.forEach(note => {
            expect(note.tick).toBeGreaterThanOrEqual(last);
            expect(note.tick).toBeGreaterThanOrEqual(measure.startTick);
            expect(note.tick).toBeLessThan(measure.endTick);
            last = note.tick;
          });
        });
      });

      it('references a real tuplet for every note carrying a tuplet id', () => {
        const measures = parse(opts);

        measures.forEach(measure => {
          const ids = new Set(measure.tuplets.map(t => t.id));

          measure.notes.forEach(note => {
            if (note.tupletId !== undefined) {
              expect(ids.has(note.tupletId)).toBe(true);
            }
          });
        });
      });

      it('stamps every hit with its audio time', () => {
        const chart = makeChart(opts);
        const measures = convertToVexFlow(chart, chart.trackData[0]);
        const originalTicks = (opts.groups ?? [])
          .map(g => g.tick)
          .sort((a, b) => a - b);
        // Flams merge near-coincident same-drum hits, so compare as a subset.
        const hitMs = measures
          .flatMap(nonRest)
          .map(n => n.ms)
          .sort((a, b) => a - b);
        const originalMs = originalTicks.map(t => tickToMs(chart, t));

        hitMs.forEach(ms => {
          expect(originalMs.some(o => Math.abs(o - ms) < 1e-6)).toBe(true);
        });
      });
    });
  });
});

function keyFor(ev: Ev): string {
  if (ev.type === noteTypes.kick) {
    return ev.flags && ev.flags & noteFlags.doubleKick ? 'e/4' : 'f/4';
  }

  if (ev.type === noteTypes.redDrum) {
    return 'c/5';
  }

  if (ev.type === noteTypes.yellowDrum) {
    return ev.flags && ev.flags & noteFlags.cymbal ? 'g/5/x2' : 'e/5';
  }

  if (ev.type === noteTypes.blueDrum) {
    return ev.flags && ev.flags & noteFlags.cymbal ? 'f/5/x2' : 'd/5';
  }

  return ev.flags && ev.flags & noteFlags.cymbal ? 'a/5/x2' : 'a/4';
}
