/**
 * A stable, opaque identifier for the song a chart is of (plan 0105).
 *
 * The point is to count DISTINCT charts, not to know which songs they are.
 * Exporting one chart five times has to collapse to one funnel run, so what
 * is sent is a digest of the identity rather than the title.
 *
 * This is a checksum, not a secret. A 64-bit non-cryptographic digest over a
 * short string is confirmable against a candidate list, so the claim it
 * supports is "we do not collect song titles", not "song titles cannot be
 * recovered". `app/privacy/page.tsx` says exactly that, and has to keep
 * saying it if this ever changes.
 *
 * The hash is over the song's METADATA, not its notes. A key derived from
 * chart content would change every time the charter edited, which is the one
 * thing they are certain to do between exports: every re-export would read
 * as a brand-new chart and the dedup would be worthless.
 *
 * The digest is the shared `fnvDigest` — a collision would merge two songs
 * in a report, never lose or corrupt anything, so cryptographic strength
 * buys nothing here.
 */

import {fnvDigest} from '@/lib/hash/fnv';

/**
 * Case, surrounding space and repeated inner space are normalized away, so
 * `"  The   Beatles "` and `"the beatles"` are one artist. Nothing more
 * aggressive: stripping punctuation would merge songs that really are
 * different, and an over-merged count is a wrong answer that looks right.
 */
function normalize(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Reported for a chart whose song has not been named yet. */
export const UNNAMED_SONG = 'unnamed';

/**
 * The identities a chart carries before anyone has said what song it is: the
 * two `createBlankProject` placeholders, and the fallback the export path
 * supplies for an empty name.
 *
 * Spelled out rather than imported. Importing them would make this module
 * depend on `lib/chart-export` and `lib/project-storage` at runtime, and
 * both are mocked wholesale by suites that have nothing to do with
 * analytics. The test imports the real constants and asserts each one is
 * recognised here, which catches a drift without the coupling.
 */
const PLACEHOLDER_NAMES = new Set(['', 'untitled', 'untitled chart']);
const PLACEHOLDER_ARTISTS = new Set(['', 'unnamed artist']);

function isPlaceholder(artist: string, name: string): boolean {
  return PLACEHOLDER_NAMES.has(name) && PLACEHOLDER_ARTISTS.has(artist);
}

/**
 * The analytics key for a song, or {@link UNNAMED_SONG} for a chart that has
 * no song identity yet. Charts with the same artist and name share
 * one, whatever else about them differs — including the charter, so two
 * people charting one song are visibly charting the same song.
 */
export function songKey(artist: string | undefined, name: string | undefined) {
  const artistPart = normalize(artist);
  const namePart = normalize(name);
  // A chart still carrying the placeholders every new chart starts with is
  // not identifiable, and hashing them anyway would collapse every such
  // chart in the world onto two global constants — turning the one figure
  // this key exists to produce, "how many distinct charts", into a 1.
  // A named sentinel says so out loud, and unlike an empty string it is a
  // value GA4 certainly keeps and an analyst can count.
  if (isPlaceholder(artistPart, namePart)) return UNNAMED_SONG;
  return fnvDigest(`${artistPart}|${namePart}`);
}
