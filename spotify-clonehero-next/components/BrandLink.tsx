import Link from 'next/link';
import {Music} from 'lucide-react';
import {cn} from '@/lib/utils';

/**
 * The brand link home, as both site headers wear it. The third affordance
 * the two headers share, extracted for the same reason as `SocialLinks` and
 * `HeaderAuthControls`: one `href` and one mark, and a `variant` that picks
 * how the header wears them.
 *
 * Unlike those two, the variants differ in composition and not only in
 * scale, which is what this table is for. The compact editor row shows the
 * mark always and adds the wordmark when it fits. The full nav shows one or
 * the other: the mark is what the wordmark shrinks to below `md`, where the
 * row has to fit at 320px, and a nav that carried both would put a mark on
 * the desktop nav that has never had one.
 */
const VARIANTS = {
  nav: {
    mark: 'h-7 w-7 md:hidden',
    icon: 'h-4 w-4',
    wordmark: 'hidden text-xl md:inline',
  },
  compact: {
    mark: 'h-6 w-6',
    icon: 'h-3.5 w-3.5',
    wordmark: 'hidden text-sm sm:inline',
  },
} as const;

export default function BrandLink({variant}: {variant: 'nav' | 'compact'}) {
  const scale = VARIANTS[variant];
  return (
    <Link
      href="/"
      aria-label="Music Charts Tools home"
      title="Music Charts Tools"
      className="flex shrink-0 items-center gap-2">
      <span
        className={cn(
          'flex items-center justify-center rounded-md bg-primary text-primary-foreground',
          scale.mark,
        )}>
        <Music className={scale.icon} />
      </span>
      <span
        className={cn(
          'self-center font-semibold whitespace-nowrap dark:text-white',
          scale.wordmark,
        )}>
        Music Charts Tools
      </span>
    </Link>
  );
}
