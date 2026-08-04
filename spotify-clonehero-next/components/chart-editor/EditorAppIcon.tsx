import Link from 'next/link';
import {Music} from 'lucide-react';

/**
 * Small app-icon tile linking home, the leftmost element of the compact
 * editor header (plan 0074 Phase 7 task 7b). Shared by `ChartEditor`'s own
 * header, pages that render a bespoke editor header (e.g. add-lyrics), and
 * the site-wide compact header shown on editor routes before a chart is
 * loaded — one visual identity for "this is the editor" across all three.
 */
export default function EditorAppIcon() {
  return (
    <Link
      href="/"
      aria-label="Music Charts Tools home"
      title="Music Charts Tools"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
      <Music className="h-3.5 w-3.5" />
    </Link>
  );
}
