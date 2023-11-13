'use client';

import {ReactNode} from 'react';
import {IconContext} from 'react-icons';
import {SessionProvider} from 'next-auth/react';

export default function ContextProviders({children}: {children: ReactNode}) {
  return (
    <SessionProvider>
      <IconContext.Provider
        value={{className: 'inline-block', style: {verticalAlign: 'middle'}}}>
        {children}
      </IconContext.Provider>
    </SessionProvider>
  );
}
