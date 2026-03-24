import {use} from 'react';
import dynamic from 'next/dynamic';
import {getMd5FromSlug} from '@/app/getMd5FromSlug';

const ClientPage = dynamic(() => import('./ClientPage'));

export default function Page({params}: {params: Promise<{slug: string}>}) {
  const {slug: slugParam} = use(params);
  const md5 = getMd5FromSlug(slugParam);

  if (!md5) {
    return 'Invalid chart';
  }

  return <ClientPage md5={md5} />;
}
