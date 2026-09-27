import {use} from 'react';
import dynamic from 'next/dynamic';
import type {Metadata} from 'next';

import {getMd5FromSlug} from '@/app/songSlug';

/*
Pretty much all of the code that powers this page
is copied from liquid's work!
*/

const ClientPage = dynamic(() => import('./ClientPage'));

// Generic, non-blocking metadata. The page loads instantly, and the
// client patches document.title with the song name once it has the
// chart data. The OG/Twitter card carries the rich per-chart info via
// the sibling opengraph-image.tsx (which crawlers fetch separately).
export async function generateMetadata({
  params,
}: {
  params: Promise<{slug: string}>;
}): Promise<Metadata> {
  const {slug} = await params;
  const md5 = getMd5FromSlug(slug);
  if (!md5) return {title: 'Invalid chart'};

  return {
    title: 'Drum Sheet Music',
    description:
      'View Clone Hero drum charts as sheet music, with synced audio playback.',
  };
}

export default function Page({params}: {params: Promise<{slug: string}>}) {
  const {slug: slugParam} = use(params);
  const slug = getMd5FromSlug(slugParam);

  if (!slug) {
    return 'Invalid chart';
  }

  return <ClientPage md5={slug} />;
}
