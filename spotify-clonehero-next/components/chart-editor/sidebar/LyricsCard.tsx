'use client';

/**
 * Chart Assist "Lyrics / Vocals" card (plan 0074 Phase 2).
 *
 * Delegates to the existing `AddLyricsDialog` wholesale (same task, same
 * dialog, same paste-textarea flow the drum-transcription editor already
 * ships) rather than re-implementing a second lyrics flow here — the card is
 * a thin wrapper around its trigger button.
 */

import {Captions} from 'lucide-react';

import type {LoadAssistAudio} from '@/lib/assist/tasks/types';

import AddLyricsDialog from '../AddLyricsDialog';
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
      icon={Captions}
      name="Lyrics / Vocals"
      explanation="Aligns pasted lyric text to the vocals for in-game karaoke lyrics."
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
