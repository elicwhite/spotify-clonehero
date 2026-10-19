/**
 * "Learn more" copy for the Chart Assist cards. Kept beside the cards but out
 * of them: the copy is long-form prose that changes for editorial reasons,
 * not for code reasons.
 *
 * Every entry assumes the reader already knows what the artifact IS: a
 * charter knows what a tempo map and a section marker are. Each one leads
 * with what our implementation does, where it falls down, and what the user
 * should do about it, in that order.
 */

export type LearnKey =
  | 'tempo'
  | 'sections'
  | 'silence'
  | 'drums'
  | 'lyrics'
  | 'difficulty';

/** A run of text inside a paragraph, optionally an external link. */
export type LearnInline = string | {text: string; href: string};

/**
 * A paragraph is either plain text or a sequence of inline runs, so copy can
 * carry a link without the modal needing to parse markup.
 */
export type LearnParagraph = string | readonly LearnInline[];

export const LEARN_COPY: Record<
  LearnKey,
  {title: string; paragraphs: readonly LearnParagraph[]}
> = {
  tempo: {
    title: 'Tempo map',
    paragraphs: [
      'Our tempo maps are a starting point rather than a finished grid. They are most reliable on straight 4/4 material, and the most common miss is the downbeat: the pulse is right, but the bar lines sit on the wrong beat of it. When that happens, select a different downbeat in the piano roll and the generated map is rebuilt around your choice.',
      'It is worth settling the grid before anything else leans on it. Drum transcription snaps every hit to this map, so an accurate tempo map buys a materially better transcription. If you change the map after transcribing, transcribe again so the notes follow the grid you settled on.',
    ],
  },
  sections: {
    title: 'Sections',
    paragraphs: [
      [
        'We run ',
        {text: 'LinkSeg', href: 'https://github.com/morgan76/LinkSeg'},
        ' over the song to find where its structure changes, then label each part with the classic Western section names: intro, verse, chorus, bridge, outro. Expect to rename some of what it finds and to add sections it missed.',
      ],
    ],
  },
  silence: {
    title: 'Add leading silence',
    paragraphs: [
      'This pads the front of the chart so the first notes do not arrive before the player is ready, and so the song opens on a full measure, the amount charting conventions ask for.',
      'Worth revisiting whenever the tempo map changes, since a new grid moves where the first full measure begins.',
    ],
  },
  drums: {
    title: 'Drum transcription',
    paragraphs: [
      'We isolate the drums out of the mix and write a baseline Expert chart, each hit snapped to the tempo grid. It is a first pass, far faster than charting from scratch, and not a finished chart, so expect to fix hits it invented and add ones it missed.',
      'It reads the tempo map at the moment it runs, so editing the grid afterwards can leave the chart off the beat. Settle the tempo map before you transcribe, or transcribe again once the tempo edits are done.',
    ],
  },
  lyrics: {
    title: 'Lyrics',
    paragraphs: [
      'Paste plain lyric text and we align it to the isolated vocal stem syllable by syllable, so each phrase lands where it is actually sung.',
      'It replaces the current placement outright. Individual phrase timings can still be fine-tuned by hand afterwards.',
    ],
  },
  difficulty: {
    title: 'Difficulty generation',
    paragraphs: [
      "Thins an instrument's Expert chart into Hard, Medium, and Easy, keeping what carries the part at each level and dropping what stops being playable at that density. The result is a reasonable baseline; a chart you care about is still worth a pass by hand.",
      'It reads Expert at the moment it runs, so editing Expert afterwards leaves the lower difficulties out of sync; that is what the possibly-stale flag is about. It replaces the whole Hard/Medium/Easy set for that instrument only.',
    ],
  },
};
