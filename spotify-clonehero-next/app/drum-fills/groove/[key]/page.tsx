import {use} from 'react';
import type {Metadata} from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = {
  title: 'Groove · Drum Fills',
  description: 'Drill a groove and rotate its fills, or climb its ladder.',
};

const GrooveRoute = dynamic(() => import('./GrooveRoute'));

export default function Page({params}: {params: Promise<{key: string}>}) {
  const {key} = use(params);
  return <GrooveRoute similarityKey={decodeURIComponent(key)} />;
}
