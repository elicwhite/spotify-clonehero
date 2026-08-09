'use client';

import {ReactNode} from 'react';
import {NuqsAdapter} from 'nuqs/adapters/next/app';
import {usePathname} from 'next/navigation';
import {AudioProvider} from './AudioProvider';
import {AuthProvider} from '@/lib/supabase/AuthProvider';
import {isAppleMusicConnectorRoute} from '@/lib/apple-music/private-route';

export default function ContextProviders({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const isAppleMusicConnector = isAppleMusicConnectorRoute(pathname);

  const content = (
    <AudioProvider>
      <NuqsAdapter>{children}</NuqsAdapter>
    </AudioProvider>
  );

  if (isAppleMusicConnector) return content;

  return <AuthProvider>{content}</AuthProvider>;
}
