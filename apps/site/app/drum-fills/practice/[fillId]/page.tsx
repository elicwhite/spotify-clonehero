import {use} from 'react';
import type {Metadata} from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = {
  title: 'Practice · Drum Fills',
  description: 'Practice a drum fill on the highway with live MIDI scoring.',
};

const PracticeRoute = dynamic(() => import('./PracticeRoute'));

export default function Page({params}: {params: Promise<{fillId: string}>}) {
  const {fillId} = use(params);
  return <PracticeRoute fillId={decodeURIComponent(fillId)} />;
}
