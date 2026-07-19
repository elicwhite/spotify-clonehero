import {describe, test, expect} from '@jest/globals';
import {createEmptyChart} from '@/lib/chart-edit';
import type {ChartDocument, NormalizedVocalPart} from '@/lib/chart-edit';
import {addPhrase, deletePhrase, insertPhrase} from '../phrases';

const RES = 480;

function emptyPart(): NormalizedVocalPart {
  return {
    notePhrases: [],
    staticLyricPhrases: [],
    starPowerSections: [],
    rangeShifts: [],
    lyricShifts: [],
    textEvents: [],
  } as unknown as NormalizedVocalPart;
}

function makeDoc(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    resolution: RES,
    bpm: 120,
  });
  parsedChart.vocalTracks.parts['vocals'] = emptyPart();
  return {parsedChart, assets: []};
}

describe('addPhrase', () => {
  test('creates an empty phrase of default length in open space', () => {
    const doc = makeDoc();
    const start = addPhrase(doc, 0);
    const phrases = doc.parsedChart.vocalTracks.parts['vocals'].notePhrases;

    expect(start).toBe(0);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]).toMatchObject({
      tick: 0,
      length: RES * 4,
      lyrics: [],
      notes: [],
    });
  });

  test('clamps length to fit before a following phrase', () => {
    const doc = makeDoc();
    const part = doc.parsedChart.vocalTracks.parts['vocals'];
    part.notePhrases.push({
      tick: 1000,
      msTime: 0,
      length: 480,
      msLength: 0,
      isPercussion: false,
      notes: [],
      lyrics: [],
    });

    const start = addPhrase(doc, 0);
    const phrases = part.notePhrases;

    expect(start).toBe(0);
    expect(phrases[0].length).toBe(1000);
  });

  test('returns null when there is no room between neighbors', () => {
    const doc = makeDoc();
    const part = doc.parsedChart.vocalTracks.parts['vocals'];
    part.notePhrases.push(
      {
        tick: 0,
        msTime: 0,
        length: 480,
        msLength: 0,
        isPercussion: false,
        notes: [],
        lyrics: [],
      },
      {
        tick: 480,
        msTime: 0,
        length: 480,
        msLength: 0,
        isPercussion: false,
        notes: [],
        lyrics: [],
      },
    );

    expect(addPhrase(doc, 480)).toBeNull();
    expect(part.notePhrases).toHaveLength(2);
  });

  test('returns null when the tick already falls inside an existing phrase', () => {
    const doc = makeDoc();
    const part = doc.parsedChart.vocalTracks.parts['vocals'];
    part.notePhrases.push({
      tick: 0,
      msTime: 0,
      length: 480,
      msLength: 0,
      isPercussion: false,
      notes: [],
      lyrics: [],
    });

    expect(addPhrase(doc, 200)).toBeNull();
    expect(part.notePhrases).toHaveLength(1);
  });
});

describe('deletePhrase / insertPhrase', () => {
  test('removes a phrase (with its lyrics/notes) and insertPhrase restores it', () => {
    const doc = makeDoc();
    const part = doc.parsedChart.vocalTracks.parts['vocals'];
    part.notePhrases.push({
      tick: 0,
      msTime: 0,
      length: 480,
      msLength: 0,
      isPercussion: false,
      notes: [
        {
          tick: 0,
          msTime: 0,
          length: 60,
          msLength: 0,
          pitch: 60,
          type: 'pitched',
        },
      ],
      lyrics: [{tick: 0, msTime: 0, text: 'hi', flags: 0}],
    });

    const removed = deletePhrase(doc, 0);
    expect(part.notePhrases).toHaveLength(0);
    expect(removed?.lyrics[0].text).toBe('hi');

    insertPhrase(doc, removed!);
    expect(part.notePhrases).toHaveLength(1);
    expect(part.notePhrases[0].lyrics[0].text).toBe('hi');
  });

  test('returns null when no phrase starts at the tick', () => {
    const doc = makeDoc();
    expect(deletePhrase(doc, 0)).toBeNull();
  });
});
