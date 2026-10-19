/**
 * The `song.ini` surface the editor authors, as one value and one conversion.
 *
 * The song-details dialog edits a {@link SongIniMetadataValue}; every host
 * turns that value back into a `ChartDocument` through
 * {@link applySongIniMetadata} and reads it back out through
 * {@link readSongIniMetadata}. Neither side enumerates fields, so a host
 * cannot persist a subset of what the dialog collected.
 *
 * Difficulties are `number | null` here and `-1`-sentinel integers in the
 * document; the conversion happens only in this module, via
 * `lib/chart-difficulty`'s `toIniDifficulties` / `readDifficultyValues`.
 *
 * The drum recommendation's provenance rides in the document's
 * {@link AssistProvenance} — the same place difficulty generation, tempo-
 * derived artifacts and "Keep as-is" dismissals record theirs — so a stored
 * intensity going stale after a chart edit is the same concept the Chart
 * Assist cards already implement, not a second one.
 */

import {scanIni} from '@eliwhite/scan-chart';

import type {ChartDocument, ParsedChart} from '@/lib/chart-edit';
import {
  readDifficultyValues,
  toIniDifficulties,
  type DifficultyField,
} from '@/lib/chart-difficulty';

import {getAssistProvenance, withAssistProvenance} from './content-stamps';

type IniMetadata = NonNullable<ReturnType<typeof scanIni>['metadata']>;

let derivedDefaults: IniMetadata | null = null;

/**
 * scan-chart's own `song.ini` default for every metadata key, derived by
 * parsing an ini with an empty `[song]` section: `getIniString`/
 * `getIniInteger`/`getIniBoolean` all fall back to that table when a key is
 * absent, so the result of parsing nothing IS the table.
 *
 * Derived rather than transcribed because scan-chart does not export
 * `defaultMetadata` (only `defaultIniChartModifiers`, an eight-field
 * projection of it), and a hardcoded copy of ~40 values would drift silently
 * the next time the fork is bumped. Memoized: the parse is pure and the
 * answer never changes within a session.
 */
export function defaultIniMetadata(): IniMetadata {
  if (derivedDefaults) return derivedDefaults;
  const parsed = scanIni([
    {
      fileName: 'song.ini',
      // One key, unrecognised, because a `[song]` section with no keys at all
      // is not a section as far as the ini parser is concerned. It lands in
      // `unknownIniValues` and touches no metadata field.
      data: new TextEncoder().encode('[song]\r\ndefaults_probe = 1\r\n'),
    },
  ]);
  if (!parsed.metadata) {
    throw new Error('Could not derive song.ini defaults');
  }
  derivedDefaults = parsed.metadata;
  return derivedDefaults;
}

/**
 * Drop every key whose value equals scan-chart's default, restoring the
 * sparse shape a chart-file parse produces.
 *
 * `scanIni` returns a fully populated object — every absent key comes back as
 * `"Unknown Artist"`, `-1`, `""` — while `writeIniFile` omits exactly the
 * fields that equal those defaults. Left dense, a round-tripped ini would
 * contribute `"Unknown Artist"` where the user set nothing, and every host
 * that guards on truthiness (`chart.metadata.name || projectMeta.name`) would
 * start showing it.
 *
 * Default means unset is scan-chart's own semantic, not an invention here:
 * `extractSongMetadata` raises its `missingValue` issue for exactly the
 * required fields that equal their default. The cost is that a song genuinely
 * titled `Unknown Name` reads back as untitled, which is the same trade
 * scan-chart already makes.
 */
export function stripDefaultIniMetadata(
  metadata: IniMetadata,
): Partial<IniMetadata> {
  const defaults = defaultIniMetadata() as Record<string, unknown>;
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    if (value === defaults[key]) continue;
    stripped[key] = value;
  }
  return stripped as Partial<IniMetadata>;
}

/**
 * Merge a project's stored `song.ini` into the document parsed from its chart
 * file, for a project the editor itself wrote.
 *
 * A `.chart` file carries a handful of `[Song]` fields and nothing else: every
 * `diff_*` but the lead guitar's `Difficulty`, `icon`, `loading_phrase`,
 * `album_track` and any custom key a charter added live only in `song.ini`. A
 * host that persists the editable chart as `.chart` text and keeps the ini
 * beside it has to put the two back together on load, or those fields read as
 * unset in the editor and are gone from whatever it writes next.
 *
 * The merge is not `parseChartAndIni`'s ini-wins overlay, and deliberately so.
 * Ini-wins is right for scanning a folder somebody else authored — the game
 * reads the ini, so the ini is the authority, and `readChart` keeps that
 * behavior for every non-project route. It is wrong for reloading a project we
 * wrote ourselves, where both files came out of one `writeChartFolder` call on
 * one document and the ini is the lossier of the two encodings. So:
 *
 * 1. defaults are stripped from the ini (default means unset), and
 * 2. every field the chart file defines wins, since where the two disagree it
 *    is because one format could not represent the value.
 *
 * Unrecognised ini keys ride along as `extraIniFields`, the only place they
 * exist. The parsed chart is otherwise untouched, so the ini's
 * `IniChartModifiers` — HOPO threshold, delay, drum interpretation — cannot
 * re-derive notes the caller already derived once.
 */
export function withSongIniFields(
  doc: ChartDocument,
  iniFile: {fileName: string; data: Uint8Array},
): ChartDocument {
  const ini = scanIni([iniFile]);
  if (!ini.metadata) return doc;
  const fromIni = stripDefaultIniMetadata(ini.metadata);
  const fromChart: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc.parsedChart.metadata)) {
    if (value === undefined) continue;
    fromChart[key] = value;
  }
  const extraIniFields = Object.keys(ini.unknownIniValues).length
    ? {extraIniFields: {...ini.unknownIniValues}}
    : {};
  return {
    ...doc,
    parsedChart: {
      ...doc.parsedChart,
      metadata: {
        ...fromIni,
        ...fromChart,
        ...extraIniFields,
      },
    },
  };
}

/**
 * The identity fields a project record mirrors from the document, for the
 * hosts that refresh that mirror on every save.
 *
 * `ProjectMetadata.name`/`artist`/`charter` back the projects list and the
 * export file name; they are a display denormalization of the document, never
 * a metadata source. Only the fields the document actually defines are
 * returned, so a chart that never had a charter cannot blank the record's.
 */
export function documentIdentityFields(
  doc: ChartDocument,
): Partial<SongMetadataValue> {
  const {name, artist, charter} = doc.parsedChart.metadata;
  return {
    ...(name === undefined ? {} : {name}),
    ...(artist === undefined ? {} : {artist}),
    ...(charter === undefined ? {} : {charter}),
  };
}

/** Song identity: the three fields that also name a project. */
export interface SongMetadataValue {
  name: string;
  artist: string;
  charter: string;
}

/** Everything the song-details dialog edits. */
export interface SongIniMetadataValue extends SongMetadataValue {
  album: string;
  genre: string;
  year: string;
  /** Per-instrument intensities, `null` for "not set". */
  difficulties: Partial<Record<DifficultyField, number | null>>;
  /**
   * Content stamp of the Expert drums track at the moment a drums intensity
   * was last chosen. Lets a later session tell "the user picked this for the
   * chart as it is now" apart from "the user picked this, then edited the
   * chart".
   */
  drumDifficultyStamp?: string | undefined;
}

/**
 * The dialog's starting value: the document's own `song.ini` fields, with
 * identity taken from the host (which owns the project's name/artist/charter
 * and may have them under edit before the chart does).
 */
export function readSongIniMetadata(
  doc: ChartDocument | null,
  identity: SongMetadataValue,
): SongIniMetadataValue {
  const metadata: Partial<ParsedChart['metadata']> =
    doc?.parsedChart.metadata ?? {};
  return {
    ...identity,
    album: metadata.album ?? '',
    genre: metadata.genre ?? '',
    year: metadata.year ?? '',
    difficulties: readDifficultyValues(metadata),
    drumDifficultyStamp:
      getAssistProvenance(doc)?.songIniDrumDifficulty?.sourceStamp,
  };
}

/**
 * The document the dialog's value describes: identity, catalog fields and
 * `diff_*` intensities written into `parsedChart.metadata`, and the drum
 * recommendation's provenance written into the doc's assist provenance.
 */
export function applySongIniMetadata(
  doc: ChartDocument,
  value: SongIniMetadataValue,
): ChartDocument {
  const withMetadata: ChartDocument = {
    ...doc,
    parsedChart: {
      ...doc.parsedChart,
      metadata: {
        ...doc.parsedChart.metadata,
        name: value.name,
        artist: value.artist,
        charter: value.charter,
        album: value.album,
        genre: value.genre,
        year: value.year,
        ...toIniDifficulties(value.difficulties),
      },
    },
  };
  if (value.drumDifficultyStamp === undefined) return withMetadata;
  return withAssistProvenance(withMetadata, {
    ...getAssistProvenance(doc),
    songIniDrumDifficulty: {sourceStamp: value.drumDifficultyStamp},
  });
}
