import {use} from 'react';
import dynamic from 'next/dynamic';
import Error from 'next/error';

import {getMd5FromSlug} from '@/app/getMd5FromSlug';
import {searchAdvanced} from '@/lib/search-encore';

/*
Pretty much all of the code that powers this page
is copied from liquid's work!
*/

const ClientPage = dynamic(() => import('./ClientPage'));

// export default function Page() {
//   return <ClientPage />;
// }

export default function Page({params}: {params: Promise<{slug: string}>}) {
  const {slug: slugParam} = use(params);
  const slug = getMd5FromSlug(slugParam);

  if (!slug) {
    return 'Invalid chart';
  }

  return <ClientPage md5={slug} />;
}
