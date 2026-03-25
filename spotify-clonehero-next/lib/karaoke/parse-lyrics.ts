import {removeStyleTags} from '@/lib/ui-utils';

export interface Syllable {
  text: string;
  msTime: number;
}

export interface LyricLine {
  startMs: number;
  endMs: number;
  syllables: Syllable[];
  text: string;
}

const MAX_LINE_CHARS = 55;

/**
 * Build syllables from raw lyric events.
 *
 * Lyric symbol conventions (from YARG/Rock Band):
 * - `+`  pitch slide (separate event = space marker; suffix = stripped)
 * - `-`  suffix: syllable joins with next (same word, no space)
 * - `=`  suffix: joins with next, displayed as hyphen
 * - `#`  suffix: non-pitched marker (stripped)
 * - `^`  suffix: lenient non-pitched (stripped)
 * - `*`  non-pitched unknown (stripped)
 * - `%`  range shift (stripped)
 * - `/`  static shift (stripped)
 * - `$`  prefix: harmony hidden (stripped)
 * - `§`  joined syllable (replaced with space)
 * - `_`  space escape (replaced with space)
 * - `[...]` control events (skipped)
 */
function buildSyllables(
  rawLyrics: {msTime: number; text: string}[],
): Syllable[] {
  const syllables: Syllable[] = [];
  let prevEndedWithDash = false;

  for (const event of rawLyrics) {
    const {text, msTime} = event;
    if (text.startsWith('[') || text === '+') continue;

    let t = text;

    // Strip leading $ (harmony hidden)
    if (t.startsWith('$')) t = t.slice(1);

    // Detect trailing flags before stripping
    const hasDash = t.endsWith('-');
    const hasEquals = !hasDash && t.endsWith('=');

    // Strip all trailing flag characters
    while (t.length > 0 && '-=#^*%/+'.includes(t[t.length - 1])) {
      t = t.slice(0, -1);
    }

    // Remove rich text style tags (e.g. <i>, <color=#FF0000>)
    t = removeStyleTags(t);

    // Replace inline symbols
    t = t.split('§').join(' ');
    t = t.split('_').join(' ');

    // = joins with hyphen display
    if (hasEquals) t = t + '-';

    if (t.length === 0) continue;

    // Add space before syllable unless previous ended with dash/equals (same word)
    if (syllables.length > 0 && !prevEndedWithDash) {
      t = ' ' + t;
    }

    syllables.push({text: t, msTime});
    prevEndedWithDash = hasDash || hasEquals;
  }

  return syllables;
}

/**
 * Group syllables into lines using vocal phrase boundaries from the chart.
 */
function groupByPhrases(
  syllables: Syllable[],
  phrases: {msTime: number; msLength: number}[],
): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const phrase of phrases) {
    const phraseEnd = phrase.msTime + phrase.msLength;
    const phraseSyllables = syllables.filter(
      s => s.msTime >= phrase.msTime - 1 && s.msTime <= phraseEnd + 1,
    );
    if (phraseSyllables.length === 0) continue;

    // Trim leading space on first syllable
    if (phraseSyllables[0].text.startsWith(' ')) {
      phraseSyllables[0] = {
        ...phraseSyllables[0],
        text: phraseSyllables[0].text.trimStart(),
      };
    }

    lines.push(makeLine(phraseSyllables));
  }

  return lines;
}

/**
 * Fallback: group syllables into lines using time-gap heuristics
 * when no vocal phrase markers are available.
 */
function groupByHeuristic(syllables: Syllable[]): LyricLine[] {
  const lines: LyricLine[] = [];
  let current: Syllable[] = [];
  let lineStartTime = 0;

  for (let i = 0; i < syllables.length; i++) {
    const s = syllables[i];
    if (current.length === 0) lineStartTime = s.msTime;
    current.push(s);

    const nextTime =
      i < syllables.length - 1 ? syllables[i + 1].msTime : Infinity;
    const gapToNext = nextTime - s.msTime;
    const hasDash = !s.text.endsWith(' ');

    if (gapToNext > 2000) {
      flush();
    } else if (!hasDash && current.length > 0) {
      const charLen = current.map(x => x.text).join('').length;
      const lineAge = s.msTime - lineStartTime;
      if (
        (charLen >= 40 && gapToNext > 490) ||
        (lineAge > 4500 && gapToNext > 650)
      ) {
        flush();
      }
    }
  }

  flush();
  return lines;

  function flush() {
    if (current.length === 0) return;
    lines.push(makeLine(current));
    current = [];
  }
}

/**
 * Recursively split lines that are too long at word boundary midpoints.
 */
function splitLongLines(lines: LyricLine[]): LyricLine[] {
  const result: LyricLine[] = [];

  function splitLine(line: LyricLine) {
    if (line.text.length <= MAX_LINE_CHARS) {
      result.push(line);
      return;
    }
    const syllables = line.syllables;
    let bestSplit = -1;
    let bestScore = Infinity;
    const targetLen = line.text.length / 2;
    let runningLen = 0;

    for (let i = 0; i < syllables.length - 1; i++) {
      runningLen += syllables[i].text.length;
      if (syllables[i + 1].text.startsWith(' ')) {
        const score = Math.abs(runningLen - targetLen);
        if (score < bestScore) {
          bestScore = score;
          bestSplit = i + 1;
        }
      }
    }

    if (bestSplit > 0) {
      const first = syllables.slice(0, bestSplit);
      const second = syllables.slice(bestSplit);
      if (second[0].text.startsWith(' ')) {
        second[0] = {...second[0], text: second[0].text.trimStart()};
      }
      splitLine(makeLine(first));
      splitLine(makeLine(second));
    } else {
      result.push(line);
    }
  }

  for (const line of lines) {
    splitLine(line);
  }

  return result;
}

/**
 * Deduplicate overlapping phrases (MIDI often has both note 105 and 106
 * for the same phrase region).
 */
function deduplicatePhrases(
  phrases: {msTime: number; msLength: number}[],
): {msTime: number; msLength: number}[] {
  if (phrases.length === 0) return phrases;

  const sorted = [...phrases].sort((a, b) => a.msTime - b.msTime);
  const result = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    const curr = sorted[i];
    if (Math.abs(curr.msTime - prev.msTime) < 50) {
      if (curr.msLength > prev.msLength) {
        result[result.length - 1] = curr;
      }
    } else {
      result.push(curr);
    }
  }

  return result;
}

/**
 * Merge adjacent short phrase-lines into longer display lines.
 */
function mergeShortLines(lines: LyricLine[]): LyricLine[] {
  if (lines.length === 0) return lines;

  const merged: LyricLine[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = lines[i];
    const combinedText = prev.text + ' ' + curr.text;
    const prevEnd = prev.syllables[prev.syllables.length - 1].msTime;
    const gap = curr.startMs - prevEnd;

    if (
      prev.text.length < 30 &&
      curr.text.length < 30 &&
      combinedText.length <= 50 &&
      gap < 800
    ) {
      const currSyllables = [...curr.syllables];
      currSyllables[0] = {
        ...currSyllables[0],
        text: ' ' + currSyllables[0].text.trimStart(),
      };
      merged[merged.length - 1] = makeLine([
        ...prev.syllables,
        ...currSyllables,
      ]);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

function makeLine(syllables: Syllable[]): LyricLine {
  return {
    startMs: syllables[0].msTime,
    endMs: 0,
    syllables,
    text: syllables.map(s => s.text).join(''),
  };
}

function setEndTimes(lines: LyricLine[]): LyricLine[] {
  for (let i = 0; i < lines.length; i++) {
    lines[i].endMs =
      i < lines.length - 1 ? lines[i + 1].startMs : lines[i].startMs + 2000;
  }
  return lines;
}

/**
 * Parse lyrics and vocal phrases from a scanned chart into display lines.
 */
export function parseLyrics(
  rawLyrics: {msTime: number; msLength: number; text: string}[],
  vocalPhrases: {msTime: number; msLength: number}[],
): LyricLine[] {
  const syllables = buildSyllables(rawLyrics);
  if (syllables.length === 0) return [];

  const phrases = deduplicatePhrases(vocalPhrases);
  const lines =
    phrases.length > 0
      ? mergeShortLines(groupByPhrases(syllables, phrases))
      : groupByHeuristic(syllables);

  return setEndTimes(splitLongLines(lines));
}
