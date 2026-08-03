/**
 * "Learn more" copy for the Chart Assist cards (plan 0074 Phase 2). Kept
 * beside the cards but out of them: the copy is long-form prose that changes
 * for editorial reasons, not for code reasons.
 */

export type LearnKey = 'tempo' | 'silence' | 'drums' | 'lyrics';

export const LEARN_COPY: Record<
  LearnKey,
  {title: string; paragraphs: string[]}
> = {
  tempo: {
    title: 'Tempo map',
    paragraphs: [
      'The tempo map is the grid every note snaps to. The AI listens to the audio, finds the beats, and fits tempo changes so bars and beats line up with the actual performance, even when the tempo drifts through the song.',
      'Re-generating replaces the whole map, including any tempo points you have edited by hand. Charts keep their positions in beats, so if the grid moves underneath them, AI-made charts like the drum transcription may need a re-run.',
    ],
  },
  silence: {
    title: 'Add leading silence',
    paragraphs: [
      'Charts need a moment of silence before the first note so the tempo grid has somewhere to anchor and players get a count-in. When the audio starts almost immediately, the first notes can feel unhittable and the grid may not align cleanly.',
      'This tool prepends a short stretch of silence to every audio stem, then shifts the tempo map and all charts by the same amount. Nothing is lost, and you can trim the silence again later if you change your mind.',
    ],
  },
  drums: {
    title: 'Drum transcription',
    paragraphs: [
      'Drum transcription listens to the drum audio and writes the Expert drum chart for you: kick, snare, toms and cymbals, each hit placed on the tempo grid.',
      'It reads the tempo map at the moment it runs. If you edit the grid afterwards, the chart can drift off the beat, which is why it gets flagged as possibly stale. Re-running replaces the Expert drum chart only; your other instruments are untouched.',
    ],
  },
  lyrics: {
    title: 'Lyrics / Vocals',
    paragraphs: [
      'Paste plain lyric text and the AI aligns each phrase to the vocal audio, producing the karaoke-style lyric track players see in game.',
      'Alignment uses the separated vocal stem, so it works even when the song is a full mix. Re-running replaces the current placement; you can still fine-tune individual phrase timings by hand afterwards.',
    ],
  },
};
