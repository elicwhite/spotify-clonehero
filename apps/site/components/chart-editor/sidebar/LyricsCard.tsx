'use client';

/**
 * Chart Assist "Lyrics" card (plan 0074 Phase 2; plan 0076 item 13: titled
 * and worded as just "Lyrics" — never "karaoke", never "vocals" since vocals
 * implies pitches, which this doesn't touch).
 *
 * Delegates to the existing `AddLyricsDialog` wholesale (same task, same
 * dialog, same paste-textarea flow the drum-transcription editor already
 * ships) rather than re-implementing a second lyrics flow here — the card is
 * a thin wrapper around its trigger button.
 */

import type {LoadAssistAudio} from '@/lib/assist/tasks/types';

import AddLyricsDialog from '../AddLyricsDialog';
import InstrumentIcon from '../InstrumentIcon';
import {CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';

export interface LyricsCardProps {
  /** The song's audio. All the `add-lyrics` task needs, so this card works
   *  on any host that can produce the song's bytes, project-backed or not. */
  loadAudio: LoadAssistAudio;
  onAlignedFromCachedVocals: (() => void) | undefined;
  onLearnMore: (key: LearnKey) => void;
}

export default function LyricsCard({
  loadAudio,
  onAlignedFromCachedVocals,
  onLearnMore,
}: LyricsCardProps) {
  return (
    <CardShell
      icon={<InstrumentIcon instrument="vocals" size={14} />}
      name="Lyrics"
      explanation="Automatically syncs pasted lyric text to the audio, syllable-by-syllable."
      learnKey="lyrics"
      onLearnMore={onLearnMore}
      actions={
        <AddLyricsDialog
          loadAudio={loadAudio}
          onAlignedFromCachedVocals={onAlignedFromCachedVocals}
        />
      }
    />
  );
}
