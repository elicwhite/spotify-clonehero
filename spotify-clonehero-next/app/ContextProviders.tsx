'use client';

import {ReactNode} from 'react';
import {IconContext} from 'react-icons';
import {SessionProvider} from 'next-auth/react';
import {AudioProvider} from './AudioProvider';
import dynamic from 'next/dynamic';

export default function ContextProviders({children}: {children: ReactNode}) {
  return (
    <SessionProvider>
      <IconContext.Provider
        value={{className: 'inline-block', style: {verticalAlign: 'middle'}}}>
        <AudioProvider>{children}</AudioProvider>
      </IconContext.Provider>
    </SessionProvider>
  );
}
