'use client';

import Link from 'next/link';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {Button} from '@/components/ui/button';
import {useAuth} from '@/lib/supabase/AuthProvider';

export default function HeaderAuthControls() {
  const {user, loading, signOut} = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPathWithQuery = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const loginHref = `/auth/login?next=${encodeURIComponent(currentPathWithQuery)}`;

  if (loading) {
    return null;
  }

  if (!user) {
    return (
      <Link href={loginHref}>
        <Button variant="default" size="sm" className="ml-2">
          Log In
        </Button>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 ml-2">
      <Link href="/account">
        <Button variant="secondary" size="sm">
          Account
        </Button>
      </Link>
    </div>
  );
}
