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

/**
 * Overlay a `song.ini`'s fields onto a document parsed from a chart file
 * alone.
 *
 * A `.chart` file carries a handful of `[Song]` fields and nothing else: every
 * `diff_*` but the lead guitar's `Difficulty`, `icon`, `loading_phrase`,
 * `album_track` and any custom key a charter added live only in `song.ini`. A
 * host that persists the editable chart as `.chart` text and keeps the ini
 * beside it has to put the two back together on load, or those fields read as
 * unset in the editor and are gone from whatever it writes next.
 *
 * Only metadata is taken, matching `parseChartAndIni`'s ini-wins overlay
 * (unrecognised keys included, as `extraIniFields`). The parsed chart is
 * otherwise untouched, so the ini's `IniChartModifiers` — HOPO threshold,
 * delay, drum interpretation — cannot re-derive notes the caller already
 * derived once.
 */
export function withSongIniFields(
  doc: ChartDocument,
  iniFile: {fileName: string; data: Uint8Array},
): ChartDocument {
  const ini = scanIni([iniFile]);
  if (!ini.metadata) return doc;
  const extraIniFields = Object.keys(ini.unknownIniValues).length
    ? {extraIniFields: {...ini.unknownIniValues}}
    : {};
  return {
    ...doc,
    parsedChart: {
      ...doc.parsedChart,
      metadata: {
        ...doc.parsedChart.metadata,
        ...ini.metadata,
        ...extraIniFields,
      },
    },
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
