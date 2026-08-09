'use client';

import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {isTasteDataPrivateRoute} from '@/lib/apple-music/private-route';

export default function WebMCPInit() {
  const pathname = usePathname();
  const isTasteDataPrivate = isTasteDataPrivateRoute(pathname);

  useEffect(() => {
    if (isTasteDataPrivate) return;

    let cancelled = false;
    void import('@mcp-b/global').then(({initializeWebModelContext}) => {
      if (!cancelled) initializeWebModelContext();
    });

    return () => {
      cancelled = true;
    };
  }, [isTasteDataPrivate]);

  return null;
}
