import dynamic from 'next/dynamic';
import Error from 'next/error';

import {getMd5FromSlug} from '@/app/getMd5FromSlug';
import {searchAdvanced} from '@/lib/search-encore';

/*
Pretty much all of the code that powers this page
is copied from liquid's work!
*/

const ClientPage = dynamic(() => import('./ClientPage'), {
  ssr: false,
});

// export default function Page() {
//   return <ClientPage />;
// }

export default async function Page({
  params,
}: {
  params: Promise<{slug: string}>;
}) {
  const slug = getMd5FromSlug((await params).slug);
  if (!slug) {
    return 'Invalid chart';
  }

  return <ClientPage md5={slug} />;
}
