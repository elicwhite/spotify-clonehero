import {use} from 'react';
import dynamic from 'next/dynamic';
import type {Metadata} from 'next';
import {getMd5FromSlug} from '@/app/getMd5FromSlug';
import {searchAdvanced} from '@/lib/search-encore';

const ClientPage = dynamic(() => import('./ClientPage'));

export async function generateMetadata({
  params,
}: {
  params: Promise<{slug: string}>;
}): Promise<Metadata> {
  const {slug} = await params;
  const md5 = getMd5FromSlug(slug);
  if (!md5) return {title: 'Invalid chart'};

  const response = await searchAdvanced({hash: md5});
  const chart = response.data[0];
  if (!chart) return {title: 'Chart not found'};

  const title = `${chart.name} by ${chart.artist} - Karaoke`;
  const description = `Karaoke video for ${chart.name} by ${chart.artist} (charted by ${chart.charter})`;
  const albumArt = `https://files.enchor.us/${chart.albumArtMd5}.jpg`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [albumArt],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [albumArt],
    },
  };
}

export default function Page({params}: {params: Promise<{slug: string}>}) {
  const {slug: slugParam} = use(params);
  const md5 = getMd5FromSlug(slugParam);

  if (!md5) {
    return 'Invalid chart';
  }

  return <ClientPage md5={md5} />;
}
