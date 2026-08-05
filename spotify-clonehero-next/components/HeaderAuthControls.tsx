'use client';

import Link from 'next/link';
import {usePathname, useSearchParams} from 'next/navigation';
import {Button} from '@/components/ui/button';
import {useAuth} from '@/lib/supabase/AuthProvider';
import {cn} from '@/lib/utils';

/**
 * The site header's auth affordance (Log In, or Account when signed in).
 *
 * `variant` picks the scale the same way `SocialLinks` does, and for the same
 * reason: the compact editor header runs its own 28px row. The compact scale
 * is a literal `h-7`, not the `sm` size's `--ed-control-h` token, so the
 * button is 28px on the server's first paint too — the editor density scope
 * that token follows is only applied once an editor mounts, so a token-sized
 * button in this header would render at 36px and then shrink.
 */
export default function HeaderAuthControls({
  variant = 'nav',
}: {
  variant?: 'nav' | 'compact';
}) {
  const {user, loading} = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPathWithQuery = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const loginHref = `/auth/login?next=${encodeURIComponent(currentPathWithQuery)}`;
  const compact = variant === 'compact';
  const buttonClass = compact ? 'h-7 px-2 text-xs font-semibold' : undefined;

  if (loading) {
    return null;
  }

  if (!user) {
    return (
      <Link href={loginHref}>
        <Button variant="default" size="sm" className={cn('ml-2', buttonClass)}>
          Log In
        </Button>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 ml-2">
      <Link href="/account">
        <Button variant="secondary" size="sm" className={buttonClass}>
          Account
        </Button>
      </Link>
    </div>
  );
}
