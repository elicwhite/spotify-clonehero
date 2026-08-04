/**
 * Content-derived staleness stamps (plan 0074 Design C "Staleness model").
 *
 * Revisions are content hashes, not monotonic counters: a counter desyncs
 * under undo/redo (undoing an edit doesn't "un-increment" it), while a
 * content hash naturally matches user intuition — undo back to the exact
 * content an assist task generated from makes staleness disappear, because
 * the stamp really is identical again.
 *
 * Two kinds of stamp:
 * - Per-track content stamp: hash of the track's note/star-power/lane
 *   events. Deliberately excludes tempo/time-signature data (unlike
 *   scan-chart's `calculateTrackHash`, which bakes the tempo map into
 *   every track's hash for song-identity purposes) — a tempo edit alone
 *   must not flag every track's difficulty as stale.
 * - Tempo-map stamp: hash of the sync track (tempos + time signatures).
 *
 * Both hashes are a cheap, non-cryptographic 64-bit-ish digest (two
 * differently-seeded FNV-1a 32-bit passes folded to hex). A hash collision
 * would only cause a missed staleness prompt, never data loss, so
 * cryptographic strength isn't needed — determinism and speed are what
 * matter (this runs on every relevant EXECUTE_COMMAND/UNDO/REDO).
 */

import type {
  ChartDocument,
  ParsedChart,
  ParsedTrackData,
} from '@/lib/chart-edit';
import type {SupportedTrackInstrument, TrackKeyId} from './trackInventory';
import {trackKeyId} from './trackInventory';

/** Stamp value used when no chart is loaded. Distinct from any real hash
 *  (hashes are 16 hex chars) so it can never collide with content. */
export const EMPTY_STAMP = '';

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a over a string, folded to an unsigned 32-bit int. */
function fnv1a(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Two independently-seeded FNV-1a passes, folded to a 16-hex-char stamp. */
function stampFromParts(serialized: string): string {
  const a = fnv1a(serialized, 0x811c9dc5);
  const b = fnv1a(serialized, 0x9e3779b9);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function serializeTrackContent(track: ParsedTrackData): string {
  const parts: string[] = [];
  for (const group of track.noteEventGroups) {
    for (const note of group) {
      parts.push(`n${note.tick}.${note.length}.${note.type}.${note.flags}`);
    }
    parts.push('|');
  }
  parts.push(';sp');
  for (const sp of track.starPowerSections)
    parts.push(`${sp.tick}.${sp.length}`);
  parts.push(';fl');
  for (const fl of track.flexLanes) {
    parts.push(`${fl.tick}.${fl.length}.${fl.isDouble ? 1 : 0}`);
  }
  parts.push(';fs');
  for (const fs of track.drumFreestyleSections) {
    parts.push(`${fs.tick}.${fs.length}.${fs.isCoda ? 1 : 0}`);
  }
  return parts.join(';');
}

function serializeTempoMap(chart: ParsedChart): string {
  // `resolution` is part of the grid's identity, not just a scaling factor:
  // a synctrack swap (`ReplaceDrumTrackCommand`'s `options.sync`) can change
  // it while leaving every (tick, bpm) pair looking identical, and that
  // moves where ticks land in time. Downbeat edits need no separate term —
  // `MarkDownbeatCommand`/`RephaseDownbeatsCommand` express downbeats as
  // time-signature markers, which the `;ts` section below already hashes.
  const parts: string[] = [`r${chart.resolution}`, ';t'];
  for (const tempo of chart.tempos) {
    parts.push(`${tempo.tick}.${tempo.beatsPerMinute}`);
  }
  parts.push(';ts');
  for (const ts of chart.timeSignatures) {
    parts.push(`${ts.tick}.${ts.numerator}.${ts.denominator}`);
  }
  return parts.join(';');
}

/** Content stamp for one track (note/SP/lane events only — no tempo). */
export function computeTrackStamp(track: ParsedTrackData): string {
  return stampFromParts(serializeTrackContent(track));
}

/** Content stamp for the tempo map (SyncTrack: tempos + time signatures). */
export function computeTempoStamp(chartDoc: ChartDocument | null): string {
  if (!chartDoc) return EMPTY_STAMP;
  return stampFromParts(serializeTempoMap(chartDoc.parsedChart));
}

/** Full recompute of every track's content stamp. Used on
 *  UNDO/REDO/SET_CHART_DOC, where "just recompute everything from the
 *  restored doc" is correct and cheap enough (plan Design C bullet 2). */
export function computeAllTrackStamps(
  chartDoc: ChartDocument | null,
): Record<TrackKeyId, string> {
  if (!chartDoc) return {};
  const stamps: Record<TrackKeyId, string> = {};
  for (const track of chartDoc.parsedChart.trackData) {
    stamps[trackKeyId(track)] = computeTrackStamp(track);
  }
  return stamps;
}

/**
 * Incremental recompute: only the tracks named in `affectedTracks` get a
 * new stamp, everything else in `prevStamps` is carried over unchanged
 * (reference-stable for tracks nobody touched). A track that no longer
 * exists in `chartDoc` (deleted) loses its stamp entirely rather than
 * keeping a stale one around.
 */
export function recomputeTrackStamps(
  chartDoc: ChartDocument,
  prevStamps: Readonly<Record<TrackKeyId, string>>,
  affectedTracks: ReadonlySet<TrackKeyId> | undefined,
): Readonly<Record<TrackKeyId, string>> {
  if (!affectedTracks || affectedTracks.size === 0) {
    return prevStamps;
  }
  const next: Record<TrackKeyId, string> = {...prevStamps};
  const seen = new Set<TrackKeyId>();
  for (const track of chartDoc.parsedChart.trackData) {
    const id = trackKeyId(track);
    if (affectedTracks.has(id)) {
      next[id] = computeTrackStamp(track);
      seen.add(id);
    }
  }
  for (const id of affectedTracks) {
    if (!seen.has(id)) delete next[id];
  }
  return next;
}

// ---------------------------------------------------------------------------
// Generation provenance (rides ChartDocument, not the editor session)
// ---------------------------------------------------------------------------

/**
 * Per-feature identifier for the generic "Keep as-is" acknowledgment bag.
 * A template-literal member per instrument keeps difficulty acks distinct
 * per track without a nested record.
 */
export type AssistFeatureId =
  | TempoDerivedFeature
  | 'leading-silence'
  | `difficulty:${SupportedTrackInstrument}`;

/**
 * An assist artifact whose staleness is measured against the TEMPO MAP
 * rather than against its own content: the artifact was placed on the bars
 * of one particular grid, so a changed grid can leave it on the wrong bars.
 * Both members share one provenance record, one restamp rule and one
 * staleness rule, so a third tempo-derived artifact needs no new shape.
 */
export type TempoDerivedFeature = 'drum-transcription' | 'sections';

/**
 * Generation provenance for assist-produced artifacts. Lives INSIDE
 * `ChartDocument` (as an extra own-enumerable property, same pattern as
 * `audioAnchor` in `lib/chart-edit/leading-silence.ts`), so it rides
 * undo/redo snapshots atomically with the tracks/tempo it describes:
 * undoing past the command that generated a track removes both the track
 * and its provenance entry in the same doc swap; redo restores both.
 *
 * `acks` is a single per-feature bag for "Keep as-is" dismissals, kept
 * separate from the generation records above rather than nested inside
 * them: a dismissal is conceptually a different event (a user decision at
 * a point in time) from a generation (an artifact's origin), and keeping
 * them apart means new dismissable features don't need a new provenance
 * shape.
 */
export interface AssistProvenance {
  /** Per-instrument difficulty-generation provenance: the content stamp of
   *  the source track the reduction was generated from. */
  difficulties?: Partial<
    Record<SupportedTrackInstrument, {sourceStamp: string}>
  >;
  /**
   * Per-feature tempo-derived provenance: the tempo-map stamp in effect when
   * that artifact was generated. Staleness tracks tempo, not the artifact's
   * own content — re-transcribing drums and re-labeling sections are both
   * tempo-map concerns, not edit-history ones. It is a recommendation, not a
   * fact: a small tempo edit often leaves the artifact perfectly good, which
   * is why the cards offer "Keep as-is".
   */
  tempoDerived?: Partial<Record<TempoDerivedFeature, {tempoStamp: string}>>;
  /** Per-feature "Keep as-is" acknowledgment: the stamp the user last
   *  dismissed staleness against. A dismissal lasts only until the
   *  relevant current stamp moves past this value again. */
  acks?: Partial<Record<AssistFeatureId, {ackStamp: string}>>;
}

type DocWithAssistProvenance = ChartDocument & {
  assistProvenance?: AssistProvenance;
};

/** Read a doc's assist provenance, if any. Null-safe for "no chart loaded". */
export function getAssistProvenance(
  doc: ChartDocument | null,
): AssistProvenance | undefined {
  return doc ? (doc as DocWithAssistProvenance).assistProvenance : undefined;
}

/**
 * Return a shallow-copied doc with `assistProvenance` replaced wholesale.
 * Commands that generate artifacts (e.g. `GenerateDifficultiesCommand`,
 * `ReplaceDrumTrackCommand`) use this to write provenance in the same doc
 * mutation that adds the generated tracks, so undo removes both together.
 */
export function withAssistProvenance(
  doc: ChartDocument,
  provenance: AssistProvenance,
): ChartDocument {
  return {...doc, assistProvenance: provenance} as DocWithAssistProvenance;
}

/**
 * Record the doc's CURRENT tempo map as the grid `feature`'s artifact was
 * generated against — the write a command that produces the artifact
 * performs, in the same doc mutation that installs it, so the fresh artifact
 * starts out not stale and undo removes both together.
 */
export function setTempoStamp(
  doc: ChartDocument,
  feature: TempoDerivedFeature,
): ChartDocument {
  const provenance = getAssistProvenance(doc);
  return withAssistProvenance(doc, {
    ...provenance,
    tempoDerived: {
      ...provenance?.tempoDerived,
      [feature]: {tempoStamp: computeTempoStamp(doc)},
    },
  });
}

/**
 * Re-point EXISTING tempo-derived records at the doc's current tempo map,
 * for edits that moved the grid without moving anything relative to it (a
 * whole-song leading-silence shift, a map generated in the same run as the
 * artifact). Restamps every recorded feature by default; pass `features` to
 * restamp only some of them. A feature that was never generated is left
 * alone — there is nothing to be stale about, so nothing to restamp — and a
 * doc with no restampable record is returned by reference.
 */
export function restampTempoDerived(
  doc: ChartDocument,
  ...features: TempoDerivedFeature[]
): ChartDocument {
  const recorded = getAssistProvenance(doc)?.tempoDerived;
  if (!recorded) return doc;
  const targets = (
    features.length > 0
      ? features
      : (Object.keys(recorded) as TempoDerivedFeature[])
  ).filter(feature => recorded[feature]);
  return targets.reduce(setTempoStamp, doc);
}

/**
 * Carry `from`'s provenance bag onto `to`, for a command that commits a doc
 * captured earlier (a tempo candidate previewed before the user acked
 * something): provenance written in between lives only on the live doc, and
 * committing the older snapshot must not revert it. `to` is returned
 * untouched when both sides already agree, and when `from` carries no bag at
 * all — `to`'s own record is then the better of the two.
 */
export function carryAssistProvenance(
  from: ChartDocument,
  to: ChartDocument,
): ChartDocument {
  const provenance = getAssistProvenance(from);
  if (provenance === undefined || provenance === getAssistProvenance(to)) {
    return to;
  }
  return withAssistProvenance(to, provenance);
}

/**
 * Stale iff the artifact was generated from `currentStamp` at some point
 * that no longer matches (`recordedStamp` undefined means "never
 * generated" — nothing to be stale about), UNLESS the user acknowledged
 * exactly this `currentStamp` via "Keep as-is".
 */
export function isStampStale(
  recordedStamp: string | undefined,
  currentStamp: string,
  ackStamp: string | undefined,
): boolean {
  if (recordedStamp === undefined) return false;
  if (recordedStamp === currentStamp) return false;
  if (ackStamp === currentStamp) return false;
  return true;
}
