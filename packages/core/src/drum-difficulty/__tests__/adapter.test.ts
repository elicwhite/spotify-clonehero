import {noteTypes, noteFlags, drumTypes} from '../../chart-edit/types';
import type {NoteEvent, ParsedChart} from '../../chart-edit/types';
import {Rational} from '../rational';
import {
  HOPCAT_TQN,
  parsedChartToRawDrums,
  rescaleTickTo480,
  resolveLane,
  toHopcatInput,
  toOnyxInput,
} from '../adapter';

// ---------------------------------------------------------------------------
// ParsedChart fixture builders (only the fields the adapter reads).
// ---------------------------------------------------------------------------

function note(tick: number, type: number, flags = 0, length = 0): NoteEvent {
  return {
    tick,
    msTime: tick,
    length,
    msLength: length,
    type,
    flags,
  } as NoteEvent;
}

function groupByTick(notes: NoteEvent[]): NoteEvent[][] {
  const groups: NoteEvent[][] = [];
  let cur = Number.NaN;
  let g: NoteEvent[] | null = null;
  for (const n of [...notes].sort((a, b) => a.tick - b.tick)) {
    if (n.tick !== cur) {
      cur = n.tick;
      g = [n];
      groups.push(g);
    } else {
      g!.push(n);
    }
  }
  return groups;
}

interface FixtureOpts {
  resolution?: number;
  drumType?: number | null;
  expertNotes?: NoteEvent[];
  includeExpertTrack?: boolean;
  starPower?: {tick: number; length: number}[];
  flexLanes?: {tick: number; length: number; isDouble: boolean}[];
  timeSignatures?: {tick: number; numerator: number; denominator: number}[];
  sections?: {tick: number; name: string}[];
}

function makeChart(opts: FixtureOpts = {}): ParsedChart {
  const {
    resolution = 480,
    drumType = drumTypes.fourLanePro,
    expertNotes = [],
    includeExpertTrack = true,
    starPower = [],
    flexLanes = [],
    timeSignatures = [{tick: 0, numerator: 4, denominator: 4}],
    sections = [],
  } = opts;

  const track = {
    instrument: 'drums',
    difficulty: 'expert',
    noteEventGroups: groupByTick(expertNotes),
    starPowerSections: starPower.map(s => ({...s, msTime: 0, msLength: 0})),
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: flexLanes.map(f => ({...f, msTime: 0, msLength: 0})),
    drumFreestyleSections: [],
    textEvents: [],
    versusPhrases: [],
    animations: [],
    unrecognizedMidiEvents: [],
  };

  return {
    resolution,
    drumType,
    tempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
    timeSignatures: timeSignatures.map(ts => ({...ts, msTime: 0, msLength: 0})),
    sections: sections.map(s => ({...s, msTime: 0, msLength: 0})),
    trackData: includeExpertTrack ? [track] : [],
  } as unknown as ParsedChart;
}

// ---------------------------------------------------------------------------

describe('resolveLane', () => {
  test('kick / snare', () => {
    expect(resolveLane('kick', false, 'off')).toBe('kick');
    expect(resolveLane('red', false, 'off')).toBe('snare');
    expect(resolveLane('red', false, 'noflip')).toBe('snare');
  });

  test('disco flip swaps red<->yellow regardless of tom/cymbal', () => {
    expect(resolveLane('red', false, 'flip')).toBe('hihat');
    expect(resolveLane('yellow', true, 'flip')).toBe('snare');
    expect(resolveLane('yellow', false, 'flip')).toBe('snare');
  });

  test('tom/cymbal per lane when not disco-flipped', () => {
    expect(resolveLane('yellow', true, 'off')).toBe('hihat');
    expect(resolveLane('yellow', false, 'off')).toBe('high-tom');
    expect(resolveLane('blue', true, 'off')).toBe('ride');
    expect(resolveLane('blue', false, 'off')).toBe('mid-tom');
    expect(resolveLane('green', true, 'off')).toBe('crash');
    expect(resolveLane('green', false, 'off')).toBe('floor-tom');
  });
});

describe('rescaleTickTo480', () => {
  test('passes ticks through unchanged when already at 480', () => {
    expect(rescaleTickTo480(0, HOPCAT_TQN)).toBe(0);
    expect(rescaleTickTo480(12345, HOPCAT_TQN)).toBe(12345);
  });

  test('musical grid positions rescale exactly from 192', () => {
    expect(rescaleTickTo480(192, 192)).toBe(480); // quarter
    expect(rescaleTickTo480(96, 192)).toBe(240); // eighth
    expect(rescaleTickTo480(48, 192)).toBe(120); // sixteenth
    expect(rescaleTickTo480(64, 192)).toBe(160); // quarter triplet
    expect(rescaleTickTo480(0, 192)).toBe(0);
  });

  test('rescales exactly from other resolutions', () => {
    expect(rescaleTickTo480(384, 384)).toBe(480);
    expect(rescaleTickTo480(192, 384)).toBe(240);
    expect(rescaleTickTo480(960, 960)).toBe(480);
  });

  test('off-grid ticks round to nearest, ties up', () => {
    // 1 * 480 / 192 = 2.5 -> ties up to 3.
    expect(rescaleTickTo480(1, 192)).toBe(3);
    // 5 * 480 / 192 = 12.5 -> 13.
    expect(rescaleTickTo480(5, 192)).toBe(13);
  });
});

describe('parsedChartToRawDrums — rejections', () => {
  test('no drums', () => {
    expect(parsedChartToRawDrums(makeChart({drumType: null}))).toEqual({
      ok: false,
      reason: 'no-drums',
    });
  });

  test('five-lane', () => {
    expect(
      parsedChartToRawDrums(
        makeChart({
          drumType: drumTypes.fiveLane,
          expertNotes: [note(0, noteTypes.kick)],
        }),
      ),
    ).toEqual({ok: false, reason: 'not-pro-drums', drumType: 'five-lane'});
  });

  test('four-lane non-pro', () => {
    expect(
      parsedChartToRawDrums(
        makeChart({
          drumType: drumTypes.fourLane,
          expertNotes: [note(0, noteTypes.kick)],
        }),
      ),
    ).toEqual({ok: false, reason: 'not-pro-drums', drumType: 'four-lane'});
  });

  test('no expert track', () => {
    expect(
      parsedChartToRawDrums(makeChart({includeExpertTrack: false})),
    ).toEqual({ok: false, reason: 'no-expert-track'});
  });

  test('no notes', () => {
    expect(parsedChartToRawDrums(makeChart({expertNotes: []}))).toEqual({
      ok: false,
      reason: 'no-notes',
    });
  });
});

describe('parsedChartToRawDrums — resolved IR', () => {
  const chart = makeChart({
    expertNotes: [
      note(0, noteTypes.kick, noteFlags.doubleKick),
      note(0, noteTypes.redDrum),
      note(240, noteTypes.yellowDrum, noteFlags.cymbal), // hihat
      note(480, noteTypes.yellowDrum, noteFlags.tom), // high-tom
      note(720, noteTypes.redDrum, noteFlags.disco), // disco -> hihat
      note(720, noteTypes.yellowDrum, noteFlags.cymbal | noteFlags.disco), // disco -> snare
      note(960, noteTypes.blueDrum, noteFlags.cymbal), // ride
      note(1200, noteTypes.blueDrum, noteFlags.tom), // mid-tom
      note(1440, noteTypes.greenDrum, noteFlags.cymbal), // crash
      note(1680, noteTypes.greenDrum, noteFlags.tom), // floor-tom
    ],
    starPower: [{tick: 0, length: 480}],
    flexLanes: [
      {tick: 960, length: 240, isDouble: false},
      {tick: 1440, length: 240, isDouble: true},
    ],
    sections: [{tick: 0, name: 'Intro'}],
  });

  const result = parsedChartToRawDrums(chart);

  test('accepts the pro-drums chart', () => {
    expect(result.ok).toBe(true);
  });

  test('resolves every lane (tom/cymbal + disco applied)', () => {
    if (!result.ok) throw new Error('expected ok');
    const lanes = result.chart.notes.map(n => n.lane);
    expect(lanes).toEqual([
      'kick',
      'snare',
      'hihat',
      'high-tom',
      'hihat', // red + disco
      'snare', // yellow + disco
      'ride',
      'mid-tom',
      'crash',
      'floor-tom',
    ]);
  });

  test('carries doubleKick, disco, and raw flags', () => {
    if (!result.ok) throw new Error('expected ok');
    expect(result.chart.notes[0].doubleKick).toBe(true);
    expect(result.chart.notes[4].disco).toBe('flip');
    expect(result.chart.notes[1].disco).toBe('off');
  });

  test('maps overdrive phrases, roll/swell markers, sections', () => {
    if (!result.ok) throw new Error('expected ok');
    expect(result.chart.overdrivePhrases).toEqual([
      {startTick: 0, endTick: 480},
    ]);
    expect(result.chart.rollMarkers).toEqual([
      {startTick: 960, endTick: 1200, isDouble: false},
      {startTick: 1440, endTick: 1680, isDouble: true},
    ]);
    expect(result.chart.sections).toEqual([{tick: 0, name: 'Intro'}]);
  });
});

describe('toHopcatInput — reverse-mapping + rescale', () => {
  test('encodes pads to Expert pitches and rescales 192 -> 480', () => {
    const chart = makeChart({
      resolution: 192,
      expertNotes: [
        note(0, noteTypes.kick),
        note(0, noteTypes.redDrum),
        note(96, noteTypes.yellowDrum, noteFlags.cymbal),
        note(192, noteTypes.blueDrum, noteFlags.cymbal),
        note(288, noteTypes.greenDrum, noteFlags.cymbal),
      ],
    });
    const res = parsedChartToRawDrums(chart);
    if (!res.ok) throw new Error('expected ok');
    const {notes} = toHopcatInput(res.chart);
    const byPitch = new Map(notes.map(n => [n.pitch, n.pos]));
    expect(byPitch.get(96)).toBe(0); // kick
    expect(byPitch.get(97)).toBe(0); // snare (red)
    expect(byPitch.get(98)).toBe(240); // yellow @96 -> 240
    expect(byPitch.get(99)).toBe(480); // blue @192 -> 480
    expect(byPitch.get(100)).toBe(720); // green @288 -> 720
  });

  test('emits one tom-status marker (110-112) per cymbal->tom transition', () => {
    // A raw RB tom-marker span emits a single note_on where the lane's tom
    // status turns on; the reducers only consult 110-112 by exact same-tick
    // chord membership, so the marker is synthesized at each transition into
    // tom (lane's first note if it opens in tom, or the first tom after a
    // cymbal), NOT once per tom gem.
    const chart = makeChart({
      expertNotes: [
        note(0, noteTypes.yellowDrum, noteFlags.tom), // first yellow, tom -> 110
        note(240, noteTypes.yellowDrum, noteFlags.tom), // still tom -> NO marker
        note(480, noteTypes.yellowDrum, noteFlags.cymbal), // cymbal, resets lane
        note(720, noteTypes.yellowDrum, noteFlags.tom), // cymbal->tom -> 110 again
        note(960, noteTypes.blueDrum, noteFlags.cymbal), // first blue is cymbal -> no marker
        note(1200, noteTypes.blueDrum, noteFlags.tom), // cymbal->tom -> 111
        note(1440, noteTypes.greenDrum, noteFlags.tom), // first green, tom -> 112
      ],
    });
    const res = parsedChartToRawDrums(chart);
    if (!res.ok) throw new Error('expected ok');
    const {notes} = toHopcatInput(res.chart);
    const markers = notes
      .filter(n => n.pitch >= 110 && n.pitch <= 112)
      .sort((a, b) => a.pos - b.pos);
    expect(markers).toEqual([
      {pos: 0, pitch: 110, vel: 100, dur: 0},
      {pos: 720, pitch: 110, vel: 100, dur: 0},
      {pos: 1200, pitch: 111, vel: 100, dur: 0},
      {pos: 1440, pitch: 112, vel: 100, dur: 0},
    ]);
  });

  test('encodes a 2x-bass kick at pitch 95 (tier-less passthrough)', () => {
    // HOPCAT's tier_of treats 95 (< 96) as tier-less: it is never cascaded
    // into a reduced tier, matching raw notes.mid where double-kick lives at
    // 95. A normal kick stays at 96. See parity fixtures reduction-10/11/14.
    const chart = makeChart({
      expertNotes: [
        note(0, noteTypes.kick),
        note(240, noteTypes.kick, noteFlags.doubleKick),
      ],
    });
    const res = parsedChartToRawDrums(chart);
    if (!res.ok) throw new Error('expected ok');
    const {notes} = toHopcatInput(res.chart);
    const kicks = notes.filter(n => n.pitch === 95 || n.pitch === 96);
    expect(kicks).toEqual([
      {pos: 0, pitch: 96, vel: 100, dur: 0},
      {pos: 240, pitch: 95, vel: 100, dur: 0},
    ]);
  });

  test('emits roll (126) and swell (127) marker notes', () => {
    const chart = makeChart({
      expertNotes: [note(0, noteTypes.yellowDrum, noteFlags.cymbal)],
      flexLanes: [
        {tick: 0, length: 240, isDouble: false},
        {tick: 480, length: 240, isDouble: true},
      ],
    });
    const res = parsedChartToRawDrums(chart);
    if (!res.ok) throw new Error('expected ok');
    const {notes} = toHopcatInput(res.chart);
    expect(notes.find(n => n.pitch === 126)).toMatchObject({pos: 0, dur: 240});
    expect(notes.find(n => n.pitch === 127)).toMatchObject({
      pos: 480,
      dur: 240,
    });
  });

  test('reconstructs disco-flip text-event windows bracketing flagged notes', () => {
    const chart = makeChart({
      expertNotes: [
        note(0, noteTypes.redDrum), // off
        note(48, noteTypes.redDrum, noteFlags.disco), // flip start
        note(96, noteTypes.yellowDrum, noteFlags.disco), // flip
        note(144, noteTypes.redDrum), // off -> closes window
      ],
    });
    const res = parsedChartToRawDrums(chart);
    if (!res.ok) throw new Error('expected ok');
    const {events} = toHopcatInput(res.chart);
    expect(events).toEqual([
      {pos: 48, text: '[mix 3 drums0d]'},
      {pos: 97, text: '[mix 3 drums0]'}, // one tick past the last flipped note
    ]);
  });

  test('leaves an unterminated flip open (start marker only)', () => {
    const chart = makeChart({
      expertNotes: [
        note(0, noteTypes.redDrum, noteFlags.disco),
        note(48, noteTypes.yellowDrum, noteFlags.disco),
      ],
    });
    const res = parsedChartToRawDrums(chart);
    if (!res.ok) throw new Error('expected ok');
    const {events} = toHopcatInput(res.chart);
    expect(events).toEqual([{pos: 0, text: '[mix 3 drums0d]'}]);
  });
});

describe('toOnyxInput — raw gems, status edges, measure map', () => {
  const chart = makeChart({
    expertNotes: [
      note(0, noteTypes.kick),
      note(0, noteTypes.redDrum),
      note(240, noteTypes.yellowDrum, noteFlags.tom),
      note(480, noteTypes.blueDrum, noteFlags.cymbal),
      note(720, noteTypes.redDrum, noteFlags.disco),
    ],
    starPower: [{tick: 0, length: 960}],
  });
  const res = parsedChartToRawDrums(chart);
  if (!res.ok) throw new Error('expected ok');
  const onyx = toOnyxInput(res.chart);

  test('unresolved raw color gems', () => {
    expect(onyx.rawGems.map(g => g.gem)).toEqual([
      {kind: 'kick', color: '', protype: ''},
      {kind: 'red', color: '', protype: ''},
      {kind: 'pro', color: 'yellow', protype: ''},
      {kind: 'pro', color: 'blue', protype: ''},
      {kind: 'red', color: '', protype: ''},
    ]);
  });

  test('resolved gems match scan-chart resolution (recommended path)', () => {
    expect(onyx.resolvedGems.map(g => g.lane)).toEqual([
      'kick',
      'snare',
      'high-tom',
      'ride',
      'hihat', // red + disco
    ]);
  });

  test('positions are exact rational beats', () => {
    expect(onyx.rawGems[2].pos.eq(Rational.of(1, 2))).toBe(true); // 240/480
    expect(onyx.rawGems[3].pos.eq(Rational.of(1))).toBe(true); // 480/480
  });

  test('per-note tom-status edges (is_tom)', () => {
    expect(onyx.tomStatus.yellow).toHaveLength(1);
    expect(onyx.tomStatus.yellow[0].value).toBe(true); // tom
    expect(onyx.tomStatus.blue[0].value).toBe(false); // cymbal
  });

  test('per-note disco-status edges (is_disco) on red/yellow only', () => {
    // red@0 (off), yellow@240 (off), red@720 (flip).
    expect(onyx.discoStatus.map(e => e.value)).toEqual([false, false, true]);
  });

  test('overdrive phrases in beats, half-open', () => {
    expect(onyx.overdrivePhrases[0].start.eq(Rational.ZERO)).toBe(true);
    expect(onyx.overdrivePhrases[0].end.eq(Rational.of(2))).toBe(true); // 960/480
  });

  test('measure starts in beats (4/4 -> every 4 beats)', () => {
    // endTick spans ~2 bars (OD to tick 960 = 2 beats), plus the trailing
    // one-bar overrun, so measures start at 0 and 4.
    expect(onyx.measureStarts[0].eq(Rational.ZERO)).toBe(true);
    expect(onyx.measureStarts[1].eq(Rational.of(4))).toBe(true);
    expect(onyx.measureStarts.every(s => s.den === BigInt(1))).toBe(true);
  });

  test('measure starts stay exact for /8 meters', () => {
    const odd = makeChart({
      timeSignatures: [{tick: 0, numerator: 7, denominator: 8}],
      expertNotes: [note(0, noteTypes.kick), note(3360, noteTypes.kick)],
    });
    const r = parsedChartToRawDrums(odd);
    if (!r.ok) throw new Error('expected ok');
    const starts = toOnyxInput(r.chart).measureStarts;
    // 7/8 bar = 7*4/8 = 7/2 beats.
    expect(starts[0].eq(Rational.ZERO)).toBe(true);
    expect(starts[1].eq(Rational.of(7, 2))).toBe(true);
    expect(starts[2].eq(Rational.of(7))).toBe(true);
  });
});
