import {searchEncore} from '@/lib/search-encore';
import Search from './Search';

export const metadata = {
  title: 'Sheet Music for Drums',
  description:
    'View Clone Hero drum charts as sheet music with synced click tracks and per-stem audio control. Practice and play along, all in your browser.',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | undefined;
    instrument?: string | undefined;
  }>;
}) {
  const params = await searchParams;
  const query = params.q ?? '';
  // const instrument = params.instrument ?? null;
  const instrument = 'drums';
  const results = await searchEncore(query, instrument, 1);
  return <Search defaultResults={results} initialQuery={query} />;
}
