import {searchEncore} from '@/lib/search-encore';
import Search from './Search';

export const metadata = {
  title: 'Chart Preview',
  description:
    'Preview Clone Hero drum charts on a 3D highway with a playback waveform and section navigation. Search Chorus or open a local chart, all in your browser.',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | undefined;
  }>;
}) {
  const params = await searchParams;
  const query = params.q ?? '';
  const results = await searchEncore(query, 'drums', 1);
  return <Search defaultResults={results} initialQuery={query} />;
}
