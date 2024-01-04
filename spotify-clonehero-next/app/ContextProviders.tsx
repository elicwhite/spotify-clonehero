'use client';

import {ReactNode} from 'react';
import {SessionProvider} from 'next-auth/react';
import {AudioProvider} from './AudioProvider';

export default function ContextProviders({children}: {children: ReactNode}) {
  return (
    <SessionProvider>
      <AudioProvider>{children}</AudioProvider>
    </SessionProvider>
  );
}
