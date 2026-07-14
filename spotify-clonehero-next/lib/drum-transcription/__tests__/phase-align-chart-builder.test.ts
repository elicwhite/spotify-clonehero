/**
 * Integration tests for the PHASE-ALIGN lever wired into buildChartDocument
 * (audio-flow) — the fixture-level counterpart to phase-align.test.ts's
 * pure-function unit tests.
 */
import {
  buildChartDocument,
  buildChartDocumentFromExistingChart,
  buildConfidenceData,
  RESOLUTION,
} from '../pipeline/chart-builder';
import type {PhaseAlignResult} from '../pipeline/phase-align';
import {
  DEFAULT_PHASE_ALIGN_CONFIG,
  type PhaseAlignGateConfig,
} from '../ml/phase-align-config';
import type {RawDrumEvent} from '../ml/types';
import {SYSTEMATIC_ONSET_MS_AUDIO_FLOW} from '../ml/types';
import {getDrumNotes, noteId, createEmptyChart} from '@/lib/chart-edit';

// Flat 120 BPM (synctrack=null): 1 beat = 500ms, 1 beat = RESOLUTION (480)
// ticks, so "on the downbeat" <=> tick is a multiple of 480.
const MS_PER_BEAT = 500;
const N = 12;

function kickAt(rawMs: number, confidence = 0.9): RawDrumEvent {
  return {
    timeSeconds: rawMs / 1000,
    drumClass: 'BD',
    midiPitch: 0,
    confidence,
  };
}

describe('buildChartDocument + PHASE-ALIGN (audio-flow)', () => {
  it('Rooftops-class fixture: gates in and lands every note on the quarter-note grid', () => {
    // Every raw onset is one 32nd note (62.5ms) before its intended quarter
    // beat, net of the flow's own systematic-onset correction — i.e. an
    // otherwise-perfect performance that a naive charter-offset model would
    // read as "every note lands early".
    const events: RawDrumEvent[] = [];
    for (let k = 1; k <= N; k++) {
      events.push(
        kickAt(k * MS_PER_BEAT - 62.5 - SYSTEMATIC_ONSET_MS_AUDIO_FLOW),
      );
    }

    const out: {result?: PhaseAlignResult} = {};
    const doc = buildChartDocument(
      events,
      'Rooftops-class',
      (N + 1) * MS_PER_BEAT * 0.001,
      null,
      null,
      DEFAULT_PHASE_ALIGN_CONFIG,
      out,
    );

    expect(out.result?.applied).toBe(true);
    expect(out.result?.shiftMs).not.toBe(0);

    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(N);
    for (const note of notes) {
      expect(note.tick % RESOLUTION).toBe(0);
    }
  });

  it('well-aligned fixture: gate does not fire and placement is untouched', () => {
    const events: RawDrumEvent[] = [];
    for (let k = 1; k <= N; k++) {
      events.push(kickAt(k * MS_PER_BEAT - SYSTEMATIC_ONSET_MS_AUDIO_FLOW));
    }

    const out: {result?: PhaseAlignResult} = {};
    const doc = buildChartDocument(
      events,
      'Well Aligned',
      (N + 1) * MS_PER_BEAT * 0.001,
      null,
      null,
      DEFAULT_PHASE_ALIGN_CONFIG,
      out,
    );

    expect(out.result?.applied).toBe(false);
    expect(out.result?.shiftMs).toBe(0);

    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(N);
    for (const note of notes) {
      expect(note.tick % RESOLUTION).toBe(0);
    }
  });

  it('disabling the lever via config leaves a decisively-misaligned fixture untouched', () => {
    const events: RawDrumEvent[] = [];
    for (let k = 1; k <= N; k++) {
      events.push(
        kickAt(k * MS_PER_BEAT - 62.5 - SYSTEMATIC_ONSET_MS_AUDIO_FLOW),
      );
    }
    const disabled: PhaseAlignGateConfig = {
      ...DEFAULT_PHASE_ALIGN_CONFIG,
      enabled: false,
    };
    const out: {result?: PhaseAlignResult} = {};
    const doc = buildChartDocument(
      events,
      'Disabled',
      (N + 1) * MS_PER_BEAT * 0.001,
      null,
      null,
      disabled,
      out,
    );

    expect(out.result?.applied).toBe(false);
    // Without the shift, ticks land near k*480-60 (one 32nd early), NOT on
    // the quarter grid — proves the lever (not some other snapping path)
    // was responsible for the aligned-tick result in the enabled test above.
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const onGrid = notes.filter(n => n.tick % RESOLUTION === 0);
    expect(onGrid.length).toBeLessThan(N);
  });

  it('buildConfidenceData given the SAME applied shift keys confidence by the identical snapped ticks', () => {
    const events: RawDrumEvent[] = [];
    for (let k = 1; k <= N; k++) {
      events.push(
        kickAt(k * MS_PER_BEAT - 62.5 - SYSTEMATIC_ONSET_MS_AUDIO_FLOW, 0.77),
      );
    }
    const out: {result?: PhaseAlignResult} = {};
    const doc = buildChartDocument(
      events,
      'Confidence Consistency',
      (N + 1) * MS_PER_BEAT * 0.001,
      null,
      null,
      DEFAULT_PHASE_ALIGN_CONFIG,
      out,
    );
    expect(out.result?.applied).toBe(true);

    const tempos = doc.parsedChart.tempos.map(t => ({
      tick: t.tick,
      beatsPerMinute: t.beatsPerMinute,
    }));
    const conf = buildConfidenceData(
      events,
      tempos,
      RESOLUTION,
      'audio',
      out.result!.shiftMs,
    );

    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const noteKeys = new Set(notes.map(n => noteId(n)));
    expect(Object.keys(conf.notes)).toHaveLength(N);
    for (const key of Object.keys(conf.notes)) {
      expect(noteKeys.has(key)).toBe(true);
      expect(conf.notes[key]).toBeCloseTo(0.77, 6);
    }
  });

  it('omitting the applied shift from buildConfidenceData desyncs the keys from the chart (regression guard for the plumbing)', () => {
    const events: RawDrumEvent[] = [];
    for (let k = 1; k <= N; k++) {
      events.push(
        kickAt(k * MS_PER_BEAT - 62.5 - SYSTEMATIC_ONSET_MS_AUDIO_FLOW),
      );
    }
    const out: {result?: PhaseAlignResult} = {};
    const doc = buildChartDocument(
      events,
      'Desync Guard',
      (N + 1) * MS_PER_BEAT * 0.001,
      null,
      null,
      DEFAULT_PHASE_ALIGN_CONFIG,
      out,
    );
    expect(out.result?.applied).toBe(true);

    const tempos = doc.parsedChart.tempos.map(t => ({
      tick: t.tick,
      beatsPerMinute: t.beatsPerMinute,
    }));
    // phaseAlignShiftMs defaults to 0 when omitted -- this must NOT match
    // the chart's own (shifted) ticks, demonstrating why callers must pass
    // the shift through explicitly.
    const confWithoutShift = buildConfidenceData(events, tempos, RESOLUTION);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const noteKeys = new Set(notes.map(n => noteId(n)));
    const mismatched = Object.keys(confWithoutShift.notes).filter(
      k => !noteKeys.has(k),
    );
    expect(mismatched.length).toBeGreaterThan(0);
  });

  it('AUDIO-FLOW ONLY: buildChartDocumentFromExistingChart never applies a phase-align shift', () => {
    // Fixture that would be decisively gated-in on the audio-flow path.
    const events: RawDrumEvent[] = [];
    for (let k = 1; k <= N; k++) {
      events.push(kickAt(k * MS_PER_BEAT - 62.5)); // chart-flow's own offset is 0ms
    }
    const existing = {
      parsedChart: createEmptyChart({
        format: 'chart',
        resolution: RESOLUTION,
        bpm: 120,
        timeSignature: {numerator: 4, denominator: 4},
      }),
      assets: [],
    };
    const doc = buildChartDocumentFromExistingChart(
      existing,
      events,
      (N + 1) * MS_PER_BEAT * 0.001,
    );
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const onGrid = notes.filter(n => n.tick % RESOLUTION === 0);
    // Chart-flow has no phase-align call in its code path at all (it never
    // imports computePhaseAlignShiftMs), so the one-32nd-early offset is
    // never corrected — ticks stay off the quarter grid.
    expect(onGrid.length).toBeLessThan(N);
  });
});
