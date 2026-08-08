import type {ReactNode} from 'react';

import FindMusicClient from './FindMusicClient';

export default function FindMusicLayout({
  children,
}: Readonly<{children: ReactNode}>) {
  return (
    <>
      <FindMusicClient />
      {children}
    </>
  );
}
