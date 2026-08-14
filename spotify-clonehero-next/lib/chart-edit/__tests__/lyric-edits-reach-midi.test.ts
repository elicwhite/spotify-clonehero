/**
 * A lyric edit has to survive serialization to `.mid`.
 *
 * scan-chart's MIDI writer emits the UNION of a part's `notePhrases` and its
 * `staticLyricPhrases`, deduplicated by tick and text. The parser builds the
 * second list as a shallow copy of the first for PART VOCALS, so the two
 * share their lyric arrays and the union is a no-op — until something clones
 * one of them. These tests reproduce the parser's aliasing, so an edit that
 * only reaches `notePhrases` is caught here rather than in a user's export.
 *
 * Asserting on `notePhrases` alone is not enough: that passes either way.
 * Every assertion below goes through `writeChartFolder` and back.
 */

import {createEmptyChart, writeChartFolder} from '@eliwhite/scan-chart';
import {
  readChart,
  addLyric,
  addPhrase,
  type ChartDocument,
  type NormalizedVocalPart,
} from '..';
import {
  DeleteLyricCommand,
  SetLyricTextCommand,
} from '@/components/chart-editor/commands';

const RES = 480;

/**
 * A document with two lyrics, in the state a parse leaves it: the aliasing
 * between `notePhrases` and `staticLyricPhrases` is the parser's own, not
 * something this fixture fakes.
 */
function docWithLyrics(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    resolution: RES,
    bpm: 120,
  });
  parsedChart.vocalTracks.parts['vocals'] = {
    notePhrases: [],
    staticLyricPhrases: [],
    starPowerSections: [],
    rangeShifts: [],
    lyricShifts: [],
    textEvents: [],
  } as unknown as NormalizedVocalPart;
  const seed: ChartDocument = {parsedChart, assets: []};
  addPhrase(seed, 0);
  addLyric(seed, 0, 'cat');
  addLyric(seed, RES, 'dog');

  // Round-trip so the document under test is a parsed one.
  const parsed = readChart(
    writeChartFolder(seed).map(f => ({fileName: f.fileName, data: f.data})),
  );
  parsed.parsedChart.format = 'mid';
  return parsed;
}

/** Every lyric the exported `.mid` actually carries, as `tick:text`. */
function exportedLyrics(doc: ChartDocument): string[] {
  const files = writeChartFolder(doc);
  const reparsed = readChart(
    files.map(f => ({fileName: f.fileName, data: f.data})),
  );
  const out: string[] = [];
  for (const phrase of reparsed.parsedChart.vocalTracks.parts['vocals']
    ?.notePhrases ?? []) {
    for (const lyric of phrase.lyrics) out.push(`${lyric.tick}:${lyric.text}`);
  }
  return out.sort();
}

describe('lyric edits reach the exported .mid', () => {
  it('carries both lyrics before any edit', () => {
    expect(exportedLyrics(docWithLyrics())).toEqual(['0:cat', '480:dog']);
  });

  it('a deleted lyric does not come back', () => {
    const edited = new DeleteLyricCommand(0).execute(docWithLyrics());
    expect(exportedLyrics(edited)).toEqual(['480:dog']);
  });

  it('a retexted lyric does not ship alongside its old text', () => {
    const edited = new SetLyricTextCommand(0, 'bird').execute(docWithLyrics());
    expect(exportedLyrics(edited)).toEqual(['0:bird', '480:dog']);
  });
});
