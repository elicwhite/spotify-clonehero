import {type CSSProperties, type ReactNode} from 'react';

/**
 * The chart editor's own header row: song identity (title/artist/charter)
 * plus actions like Export. A 52px row, rendered directly by whichever page
 * owns it (`ChartEditor`, or a page building its own row like add-lyrics),
 * directly beneath the site's compact header
 * (`components/CompactSiteHeader.tsx`).
 *
 * This is the row itself, not a slot: the compact site header and this row
 * are two separate rows stacked vertically, so neither has to know about the
 * other's contents.
 */
export default function EditorHeaderRow({
  children,
  style,
}: {
  children: ReactNode;
  /** Style for the row, e.g. a CSS grid area. */
  style?: CSSProperties | undefined;
}) {
  return (
    <header
      style={style}
      className="flex h-[3.25rem] min-w-0 shrink-0 items-center gap-3 border-b bg-background px-3.5">
      {children}
    </header>
  );
}
