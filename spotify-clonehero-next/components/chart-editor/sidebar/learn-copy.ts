/**
 * "Learn more" copy for the Chart Assist cards (plan 0074 Phase 2). Kept
 * beside the cards but out of them: the copy is long-form prose that changes
 * for editorial reasons, not for code reasons.
 */

export type LearnKey =
  | 'tempo'
  | 'sections'
  | 'silence'
  | 'drums'
  | 'lyrics'
  | 'difficulty';

export const LEARN_COPY: Record<
  LearnKey,
  {title: string; paragraphs: string[]}
> = {
  tempo: {
    title: 'Tempo map',
    paragraphs: [
      'Give ours a try. It works best for 4/4 songs. It might choose the wrong downbeat, but you can select a different downbeat in the piano roll and it will update the generated tempo map.',
      'Having a great tempo map makes drum transcription significantly more accurate, so make sure you are happy there first, or regenerate the drum transcription if you update the tempo map afterwards.',
    ],
  },
  sections: {
    title: 'Sections',
    paragraphs: [
      'Section markers name the parts of the song (intro, verse, chorus) and are what players see called out as the chart scrolls past. This listens for where the song changes character, then puts a marker on the nearest bar line and names each part.',
      'Sections are generated on their own, so building a tempo map never rewrites titles you wrote yourself. Because markers land on bar lines, changing the tempo map afterwards can leave them a bar off, which is why they get flagged as possibly stale. Re-generating replaces every section marker and nothing else.',
    ],
  },
  silence: {
    title: 'Add leading silence',
    paragraphs: [
      'Charting recommendations call for a certain amount of silence before the first notes, for playability. When starting fresh from a song you often need silence added to align the start to a full measure.',
      'We recommend adding leading silence whenever the tempo map changes, so the song starts with a full measure.',
    ],
  },
  drums: {
    title: 'Drum transcription',
    paragraphs: [
      'This is a first pass, not a finished chart: it listens to the drum audio and writes a baseline Expert drum chart (kick, snare, toms and cymbals, each hit placed on the tempo grid) significantly faster than charting from scratch. Expect to tweak and change things afterwards.',
      'It reads the tempo map at the moment it runs. If you edit the grid afterwards, the chart can drift off the beat, which is why it gets flagged as possibly stale. Re-running replaces the Expert drum chart only; your other instruments are untouched.',
    ],
  },
  lyrics: {
    title: 'Lyrics',
    paragraphs: [
      'Paste plain lyric text and it gets automatically synced to the audio, syllable-by-syllable, against the isolated vocal stem.',
      'Re-running replaces the current placement; you can still fine-tune individual phrase timings by hand afterwards.',
    ],
  },
  difficulty: {
    title: 'Difficulty generation',
    paragraphs: [
      "Generates Hard, Medium, and Easy charts from an instrument's Expert chart, thinning notes down to something playable at each level.",
      'It reads Expert at the moment it runs. If you edit Expert afterwards, the lower difficulties can drift out of sync, which is why they get flagged as possibly stale. Re-generating replaces the whole Hard/Medium/Easy set for that instrument only.',
    ],
  },
};
