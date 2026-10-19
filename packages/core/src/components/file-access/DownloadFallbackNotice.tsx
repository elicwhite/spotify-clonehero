import {cn} from '../../utils';

/**
 * What a tool says when files go to the Downloads folder because the browser
 * cannot save into the folder the user picked. The words are fixed here, so
 * every tool explains it the same way; a tool supplies only what it needs to
 * add, such as that the files come in a .zip.
 */
export function downloadFallbackText(folder = 'your selected folder'): string {
  return `Your browser is missing features required to save files into ${folder}. They will be saved to your Downloads folder.`;
}

/** A block of phrasing content, so it can sit inside a card's paragraph. */
export default function DownloadFallbackNotice({
  className,
  extra,
}: {
  className?: string;
  /** A sentence after the notice. */
  extra?: string;
}) {
  return (
    <span className={cn('block', className)}>
      {extra ? `${downloadFallbackText()} ${extra}` : downloadFallbackText()}
    </span>
  );
}
