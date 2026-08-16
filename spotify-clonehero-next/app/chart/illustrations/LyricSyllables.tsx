/**
 * What lyric syncing produces: syllables with the time each one lands.
 *
 * The example is the opening of "The Wellerman", a traditional sea shanty in
 * the public domain, and it is the same line the `/add-lyrics` social card
 * uses. One multi-syllable word split across three cells shows the
 * syllable-level granularity without any copy explaining it.
 */
const SYLLABLES: readonly (readonly [string, string])[] = [
  ['Soon', '0:02.10'],
  ['may', '0:02.45'],
  ['the', '0:02.78'],
  ['Wel', '0:03.12'],
  ['ler', '0:03.42'],
  ['man', '0:03.74'],
];

export function LyricSyllables() {
  return (
    <div
      className="flex h-32 w-full items-center justify-center gap-3 overflow-hidden rounded-lg border border-border bg-card px-6 sm:h-40 sm:gap-5"
      aria-hidden="true">
      {SYLLABLES.map(([syllable, time]) => (
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
