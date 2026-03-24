import {searchAdvanced} from '@/lib/search-encore';
import Search from './Search';

export const metadata = {
  title: 'Karaoke Video Generator',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{q?: string}>;
}) {
  const params = await searchParams;
  const query = params.q ?? '';
  const results = await searchAdvanced({
    name: {value: query, exact: false, exclude: false},
    hasLyrics: true,
    per_page: 50,
  });
  return <Search defaultResults={results} initialQuery={query} />;
}
