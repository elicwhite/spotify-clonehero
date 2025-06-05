'use client';

import dynamic from 'next/dynamic';

const Checker = dynamic(() => import('./Checker'));

export default function Page() {
  return <Checker />;
}
