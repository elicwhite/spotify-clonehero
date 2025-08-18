'use client';

import dynamic from 'next/dynamic';
import {Suspense} from 'react';

/*
Pretty much all of the code that powers this page
is copied from liquid's work!
*/

const Preview = dynamic(() => import('./Preview'));

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Preview />
    </Suspense>
  );
}
