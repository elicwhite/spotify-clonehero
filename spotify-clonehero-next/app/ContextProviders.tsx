'use client';

import {ReactNode} from 'react';
import {SessionProvider} from 'next-auth/react';
import {NuqsAdapter} from 'nuqs/adapters/next/app';
import {AudioProvider} from './AudioProvider';
import {AuthProvider} from '@/lib/supabase/AuthProvider';

export default function ContextProviders({children}: {children: ReactNode}) {
  return (
    <SessionProvider>
      <AuthProvider>
        <AudioProvider>
          <NuqsAdapter>{children}</NuqsAdapter>
        </AudioProvider>
      </AuthProvider>
    </SessionProvider>
  );
}
