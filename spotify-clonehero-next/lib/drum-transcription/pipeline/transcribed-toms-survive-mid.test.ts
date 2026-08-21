/**
 * A transcribed tom stays a tom after a `.mid` export.
 *
 * `.chart` and `.mid` disagree on the default for the yellow, blue and green
 * pads: `.chart` reads an unmarked pad as a tom, `.mid` reads it as a
 * cymbal. scan-chart's MIDI writer emits a tom marker (110, 111, 112) only
 * for a note that carries `noteFlags.tom`, so a transcribed tom with no flag
 * at all exports as a cymbal and Clone Hero plays it as one.
 */

import {noteFlags, noteTypes} from '@eliwhite/scan-chart';

import {readChart, writeChartFileAs} from '@/lib/chart-edit';

import {buildChartDocument} from './chart-builder';
import {DRUM_CLASSES, type RawDrumEvent} from '../ml/types';

/** One hit per class, one second apart so nothing merges or dedups. */
const EVENTS: RawDrumEvent[] = (
  ['BD', 'SD', 'HT', 'MT', 'FT', 'HH', 'RD', 'CR'] as const
).map((drumClass, i) => ({
  drumClass,
  timeSeconds: i,
  confidence: 1,
  midiPitch: DRUM_CLASSES.find(c => c.name === drumClass)!.midiPitch,
}));

/** What the game plays each expert-drums note as, in tick order. */
function padStates(doc: ReturnType<typeof readChart>) {
  const track = doc.parsedChart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  if (!track) throw new Error('no expert drums track');
  return track.noteEventGroups.flat().map(note => {
    if (note.flags & noteFlags.cymbal) return [note.type, 'cymbal'];
    if (note.flags & noteFlags.tom) return [note.type, 'tom'];
    return [note.type, 'plain'];
  });
}

const EXPECTED = [
  [noteTypes.kick, 'plain'],
  [noteTypes.redDrum, 'tom'],
  [noteTypes.yellowDrum, 'tom'],
  [noteTypes.blueDrum, 'tom'],
  [noteTypes.greenDrum, 'tom'],
  [noteTypes.yellowDrum, 'cymbal'],
  [noteTypes.blueDrum, 'cymbal'],
  [noteTypes.greenDrum, 'cymbal'],
];

describe('a transcribed chart, written out and read back', () => {
  it.each(['mid', 'chart'] as const)(
    'keeps its toms and cymbals through .%s',
    format => {
      const doc = buildChartDocument(EVENTS, 'Song', 8);
      const written = writeChartFileAs(doc, format);
      expect(padStates(readChart([written], {pro_drums: true}))).toEqual(
        EXPECTED,
      );
    },
  );
});
