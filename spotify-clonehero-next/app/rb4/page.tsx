'use client';

import dynamic from 'next/dynamic';

const RockBand4 = dynamic(() => import('./RockBand4'));

export default function Page() {
  return <RockBand4 />;
}
