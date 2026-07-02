// Ported from the drum-hero author's rewritten notation engine in sightkick
// (src/chart-parser/parser.ts). Thanks!

import {parseChartFile} from '@eliwhite/scan-chart';
import {tickToMs} from '@/lib/chart-utils/tickToMs';
import {
  interpretDrumNote,
  type DrumNoteInstrument,
} from '@/lib/drum-mapping/noteToInstrument';
import {fillNoteIdFromRaw} from '@/lib/drum-fills/midi/noteId';
import {Head, Note, TupletMeta} from './notation/types';
import {
  Meter,
  Onset,
  makeMeter,
  notateMeasure,
  sortHeads,
} from './notation/engine';
import {makeRest, mergeMeasureRests} from './notation/durations';

type ParsedChart = ReturnType<typeof parseChartFile>;
type TimeSignature = ParsedChart['timeSignatures'][0];

/**
 * Clone Hero drum midi -> sheet music model. This module maps chart notes to
 * drum staff heads (via interpretDrumNote, which applies pro-drums tom markers
 * and disco flip), builds measures/beats from the time signature track, and
 * hands each beat's onsets to the notation engine (./notation/engine.ts) to be
 * written as notes, rests and tuplets.
 */

export default function convertToVexFlow(
  chart: ParsedChart,
  track: ParsedChart['trackData'][0],
): Measure[] {
  return new Parser(chart, track).getMeasures();
}

export interface Measure {
  timeSig: TimeSignature;
  sigChange: boolean;
  hasClef: boolean;
  isCompound: boolean;
  notes: Note[];
  tuplets: TupletMeta[];
  /** Beat boundaries within the measure (used by the click track). */
  beats: Beat[];
  startTick: number;
  endTick: number;
  startMs: number;
  endMs: number;
}

export interface Beat {
  startTick: number;
  endTick: number;
}

interface BeatLocation {
  measureIndex: number;
  beatIndex: number;
}

type InstrumentMapping = {
  [key in DrumNoteInstrument]: string;
};

const mapping: InstrumentMapping = {
  kick: 'f/4',
  snare: 'c/5',
  hihat: 'g/5/x2',
  ride: 'f/5/x2',
  crash: 'a/5/x2',
  'high-tom': 'e/5',
  'mid-tom': 'd/5',
  'floor-tom': 'a/4',
};
const DOUBLE_KICK_KEY = 'e/4';

class Parser {
  private measures: Measure[] = [];

  private endOfTrackTicks: number;

  private chart: ParsedChart;

  private ppq: number;

  private nextTupletId = 0;

  constructor(chart: ParsedChart, drumPart: ParsedChart['trackData'][0]) {
    this.chart = chart;
    this.ppq = chart.resolution;

    const allTicks = drumPart.noteEventGroups.flat().map(e => e.tick);

    this.endOfTrackTicks = allTicks.length > 0 ? Math.max(...allTicks) + 1 : 0;

    const onsets = this.collectOnsets(drumPart.noteEventGroups);

    this.createMeasures(chart.timeSignatures);
    this.buildMeasures(onsets);
  }

  getMeasures() {
    return this.measures;
  }

  private meterOf(measure: Measure): Meter {
    return makeMeter(
      measure.timeSig.numerator,
      measure.timeSig.denominator,
      this.ppq,
    );
  }

  private collectOnsets(
    noteEventGroups: ParsedChart['trackData'][0]['noteEventGroups'],
  ): Onset[] {
    return noteEventGroups
      .map((group): Onset | null => {
        const tick = group[0]?.tick;

        if (tick === undefined) {
          return null;
        }

        const heads: Head[] = group.map(note => {
          const interpreted = interpretDrumNote(note);

          return {
            key: interpreted.isDoubleKick
              ? DOUBLE_KICK_KEY
              : mapping[interpreted.instrument],
            id: fillNoteIdFromRaw(tick, note)?.id ?? null,
            accent: interpreted.dynamic === 'accent',
            ghost: interpreted.dynamic === 'ghost',
          };
        });

        return heads.length > 0 ? {tick, heads: sortHeads(heads)} : null;
      })
      .filter((o): o is Onset => o !== null);
  }

  private createMeasures(timeSignatures: ParsedChart['timeSignatures']) {
    const sigs =
      timeSignatures.length > 0
        ? timeSignatures
        : ([{tick: 0, numerator: 4, denominator: 4}] as TimeSignature[]);
    let startTick = 0;

    sigs.forEach((timeSig, index) => {
      const meter = makeMeter(timeSig.numerator, timeSig.denominator, this.ppq);
      const measureTicks = meter.beatsPerMeasure * meter.beatTicks;
      const sectionTicks =
        (sigs[index + 1]?.tick ?? this.endOfTrackTicks) - timeSig.tick;
      const numberOfMeasures = Math.max(
        0,
        Math.ceil(sectionTicks / measureTicks - 1e-9),
      );

      for (let measure = 0; measure < numberOfMeasures; measure += 1) {
        const endTick = startTick + measureTicks;

        this.measures.push({
          timeSig,
          hasClef: this.measures.length === 0,
          sigChange: measure === 0,
          isCompound: meter.isCompound,
          startTick,
          endTick,
          startMs: tickToMs(this.chart, startTick),
          endMs: tickToMs(this.chart, endTick),
          notes: [],
          tuplets: [],
          beats: new Array(meter.beatsPerMeasure)
            .fill(null)
            .map((_, beatIndex) => ({
              startTick: startTick + beatIndex * meter.beatTicks,
              endTick: startTick + (beatIndex + 1) * meter.beatTicks,
            })),
        });
        startTick += measureTicks;
      }
    });
  }

  private buildMeasures(onsets: Onset[]) {
    if (this.measures.length === 0) {
      return;
    }

    const buckets = this.bucketOnsets(onsets);
    const nextId = () => {
      const id = this.nextTupletId;

      this.nextTupletId += 1;

      return id;
    };

    this.measures.forEach((measure, measureIndex) => {
      const meter = this.meterOf(measure);
      const beatOnsets = buckets[measureIndex];

      if (beatOnsets.every(beat => beat.length === 0)) {
        measure.notes = [makeRest(measure.startTick, 'w', 0)];

        return;
      }

      const {notes, tuplets} = notateMeasure(
        measure.startTick,
        meter,
        beatOnsets,
        nextId,
      );

      measure.notes = mergeMeasureRests(
        notes,
        measure.startTick,
        measure.endTick - measure.startTick,
        this.ppq,
        meter.beatsPerMeasure % 2 === 0,
      );
      measure.tuplets = tuplets;

      // Audio time comes from the hit's original chart tick (not its notated
      // grid position) so the playhead reaches the notehead exactly when the
      // hit sounds, even when the engine regularized its written position.
      measure.notes.forEach(note => {
        if (note.sourceTick !== undefined) {
          note.ms = tickToMs(this.chart, note.sourceTick);
        }
      });
    });
  }

  /**
   * Distribute onsets into [measure][beat] buckets. An onset within a small
   * tolerance before a beat boundary belongs to the next beat — that catches
   * negative humanization jitter at beat and measure boundaries.
   */
  private bucketOnsets(onsets: Onset[]): Onset[][][] {
    const buckets = this.measures.map(measure =>
      new Array(this.meterOf(measure).beatsPerMeasure)
        .fill(null)
        .map(() => [] as Onset[]),
    );

    onsets.forEach(onset => {
      const {measureIndex, beatIndex} = this.findBeat(onset.tick);

      buckets[measureIndex][beatIndex].push(onset);
    });

    return buckets;
  }

  private findBeat(tick: number): BeatLocation {
    let low = 0;
    let high = this.measures.length - 1;
    let measureIndex = this.measures.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);

      if (this.measures[mid].startTick <= tick) {
        measureIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const measure = this.measures[measureIndex];
    const meter = this.meterOf(measure);
    let beatIndex = Math.min(
      meter.beatsPerMeasure - 1,
      Math.max(0, Math.floor((tick - measure.startTick) / meter.beatTicks)),
    );
    const beatEnd = measure.startTick + (beatIndex + 1) * meter.beatTicks;

    if (beatEnd - tick <= meter.beatTicks / 32) {
      if (beatIndex + 1 < meter.beatsPerMeasure) {
        beatIndex += 1;
      } else if (measureIndex + 1 < this.measures.length) {
        return {measureIndex: measureIndex + 1, beatIndex: 0};
      }
    }

    return {measureIndex, beatIndex};
  }
}
