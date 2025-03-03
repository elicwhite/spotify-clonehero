import {searchEncore} from '@/lib/search-encore';
import Typeahead from './Typeahead';

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
  const instrument = params.instrument ?? null;
  const results = await searchEncore(query, instrument);
  return <Typeahead defaultResults={results} />;
}
