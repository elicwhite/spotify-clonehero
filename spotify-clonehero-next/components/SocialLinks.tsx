import Link from 'next/link';
import {Icons} from '@/components/icons';
import {Button} from '@/components/ui/button';

/**
 * The site's standing external links (Discord, GitHub), as icon buttons.
 * Both site headers show exactly these two, so the hrefs live in one place;
 * they differ only in scale, which is what `variant` picks.
 */
export default function SocialLinks({
  variant,
}: {
  /** `'nav'` is the full site navigation bar's 36px scale, `'compact'` the
   *  editor header row's 28px one. */
  variant: 'nav' | 'compact';
}) {
  const buttonClass = variant === 'compact' ? 'h-7 w-7 px-0' : 'w-9 px-0';
  const iconClass = variant === 'compact' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <>
      <Link
        href="https://discord.gg/EDxu95B98s"
        target="_blank"
        rel="noreferrer">
        <Button variant="ghost" size="icon" className={buttonClass}>
          <Icons.discord className={iconClass} />
          <span className="sr-only">Discord</span>
        </Button>
      </Link>
      <Link
        href="https://github.com/TheSavior/spotify-clonehero"
        target="_blank"
        rel="noreferrer">
        <Button variant="ghost" size="icon" className={buttonClass}>
          <Icons.gitHub className={iconClass} />
          <span className="sr-only">GitHub</span>
        </Button>
      </Link>
    </>
  );
}
