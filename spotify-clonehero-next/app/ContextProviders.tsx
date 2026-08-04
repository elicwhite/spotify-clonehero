'use client';

import {ReactNode} from 'react';
import {NuqsAdapter} from 'nuqs/adapters/next/app';
import {AudioProvider} from './AudioProvider';
import {AuthProvider} from '@/lib/supabase/AuthProvider';
import {EditorChromeProvider} from '@/components/SiteChrome';

export default function ContextProviders({children}: {children: ReactNode}) {
  return (
    <AuthProvider>
      <AudioProvider>
        <NuqsAdapter>
          <EditorChromeProvider>{children}</EditorChromeProvider>
        </NuqsAdapter>
      </AudioProvider>
    </AuthProvider>
  );
}
