import {notFound, redirect} from 'next/navigation';

import {findSongSlugInSegments} from '@/app/songSlug';

/**
 * A chart path with more than one segment after `/sheet-music/`. Sends it to
 * the chart named by its last segment, or answers 404 when there is none.
 * See `findSongSlugInSegments` for the URLs that arrive here.
 *
 * Next passes the params percent-encoded, so the segment goes back into the
 * path as it is. The target starts with `/sheet-music/` and a segment cannot
 * hold a `/`, so the redirect cannot leave this route.
 */
export default async function Page({
  params,
}: {
  params: Promise<{slug: string; rest: string[]}>;
}) {
  const {slug, rest} = await params;
  const songSlug = findSongSlugInSegments([slug, ...rest]);
  if (songSlug == null) {
    notFound();
  }
  redirect(`/sheet-music/${songSlug}`);
}
