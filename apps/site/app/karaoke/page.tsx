import {searchKaraoke} from './searchKaraoke';
import Search from './Search';

export const metadata = {
  title: 'Karaoke Video Generator',
  description:
    'Turn any Clone Hero chart into a karaoke video with synced lyrics and album art. Runs entirely in your browser.',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{q?: string}>;
}) {
  const params = await searchParams;
  const query = params.q ?? '';
  const results = await searchKaraoke(query);
  return <Search defaultResults={results} initialQuery={query} />;
}
