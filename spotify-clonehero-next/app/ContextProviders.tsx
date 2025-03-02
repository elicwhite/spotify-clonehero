'use client';

import {ReactNode} from 'react';
import {SessionProvider} from 'next-auth/react';
import {NuqsAdapter} from 'nuqs/adapters/next/app';
import {AudioProvider} from './AudioProvider';

export default function ContextProviders({children}: {children: ReactNode}) {
  return (
    <SessionProvider>
      <AudioProvider>
        <NuqsAdapter>{children}</NuqsAdapter>
      </AudioProvider>
    </SessionProvider>
  );
}
