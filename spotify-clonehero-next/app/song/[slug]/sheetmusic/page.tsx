// import {getMd5FromSlug} from '../../../getMd5FromSlug';

export default async function Page({
  params,
}: {
  params: Promise<{slug: string}>;
}) {
  // const slug = getMd5FromSlug((await params).slug);

  return <div>Sheet Music {params?.slug}</div>;
}
