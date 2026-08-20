import {SYLLABLES} from '@/app/add-lyrics/landing/syllableAlignModel';
import {heroCanvasFrameClass} from '@/components/landing/heroCanvasFrame';
import {cn} from '@/lib/utils';

/**
 * What lyric syncing produces: syllables with the time each one lands.
 *
 * The example is the opening of "The Wellerman", from the shared
 * `/add-lyrics` syllable model, so an edited syllable time changes this
 * strip, the `/add-lyrics` hero canvas, and its social card together. Only
 * the first six syllables fit this strip's width, and the one
 * multi-syllable word split across three cells shows the syllable-level
 * granularity without any copy explaining it.
 */
const SHOWN = SYLLABLES.slice(0, 6).map(
  ({text, time}) => [text, time] as const,
);

export function LyricSyllables() {
  return (
    <div
      className={cn(
        heroCanvasFrameClass(),
        'flex items-center justify-center gap-3 overflow-hidden px-6 sm:gap-5',
      )}
      aria-hidden="true">
      {SHOWN.map(([syllable, time]) => (
        <div key={time} className="flex flex-col items-center gap-1">
          <span className="text-lg font-medium text-foreground sm:text-2xl">
            {syllable}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground sm:text-xs">
            {time}
          </span>
        </div>
      ))}
    </div>
  );
}
