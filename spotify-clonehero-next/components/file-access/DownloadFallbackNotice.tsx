import {cn} from '@/lib/utils';

/**
 * What a tool says when a file goes to the Downloads folder instead of the
 * folder the user picked. The sentence that gives the reason is fixed here, so
 * every tool blames the browser in the same words; a tool supplies only the
 * folder and what to do with the file.
 */
export interface DownloadFallbackCopy {
  /** Where the file could not go, e.g. "your Songs folder". */
  folder: string;
  /** What the user does with the file, as a full sentence. */
  action: string;
  /** False when the user chose to download. The reason is then left out. */
  browserIsReason: boolean;
}

export function browserReasonSentence(folder: string): string {
  return `Your browser cannot save files into ${folder}.`;
}

const DOWNLOADS_SENTENCE = 'The files go to your Downloads folder.';

/** The notice as one string, for a toast. */
export function downloadFallbackText({
  folder,
  action,
  browserIsReason,
}: DownloadFallbackCopy): string {
  return [
    browserIsReason ? browserReasonSentence(folder) : null,
    DOWNLOADS_SENTENCE,
    action,
  ]
    .filter(Boolean)
    .join(' ');
}

/** A block of phrasing content, so it can sit inside a card's paragraph. */
export default function DownloadFallbackNotice({
  className,
  ...copy
}: DownloadFallbackCopy & {className?: string}) {
  return (
    <span className={cn('block', className)}>{downloadFallbackText(copy)}</span>
  );
}
