/**
 * EditorScope — what the editor is currently editing.
 *
 * Every callsite that resolves "the active track" reads this scope.
 *
 * Three kinds:
 *
 *  - `track` — a single instrument+difficulty pair (drums/guitar/bass/...).
 *    The editor renders the corresponding track on the highway, and
 *    note/section/star-power adapters scope to it.
 *
 *  - `vocals` — a single vocal part (`vocals` / `harm1` / `harm2` / `harm3`).
 *    No notes track is involved; lyric + phrase markers are the editable
 *    entities.
 *
 *  - `global` — chart-wide editing only (sections, BPM, time-signature).
 *    Reserved for future use; no consumer today.
 */

import type {
  Difficulty,
  Instrument,
  ParsedTrackData,
  TrackKey,
} from '@/lib/chart-edit';
import {findTrack} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {trackKeyId as inventoryTrackKeyId} from '@/lib/chart-editor-core/trackInventory';

export type {TrackKey};

/** Stable id for a track row and for track-qualified note selections. */
export const trackKeyId = inventoryTrackKeyId;

/**
 * Shared selection ids include their owning track. Commands convert these
 * back to local `tick:type` ids at the command boundary.
 */
export function trackQualifiedNoteId(track: TrackKey, localId: string): string {
  return `${trackKeyId(track)}|${localId}`;
}

export function parseTrackQualifiedNoteId(
  id: string,
): {track: TrackKey; localId: string} | null {
  const separator = id.indexOf('|');
  if (separator <= 0 || separator === id.length - 1) return null;
  const trackPart = id.slice(0, separator);
  const localId = id.slice(separator + 1);
  const colon = trackPart.indexOf(':');
  if (colon <= 0 || colon === trackPart.length - 1) return null;
  return {
    track: {
      instrument: trackPart.slice(0, colon) as Instrument,
      difficulty: trackPart.slice(colon + 1) as Difficulty,
    },
    localId,
  };
}

/** Convert a shared selection id into the local id expected by commands. */
export function localNoteIdForTrack(
  id: string,
  track: TrackKey,
): string | null {
  const parsed = parseTrackQualifiedNoteId(id);
  if (!parsed) return id;
  return trackKeyId(parsed.track) === trackKeyId(track) ? parsed.localId : null;
}

export function localNoteIdsForTrack(
  ids: Iterable<string>,
  track: TrackKey,
): string[] {
  return Array.from(ids)
    .map(id => localNoteIdForTrack(id, track))
    .filter((id): id is string => id !== null);
}

export type EditorScope =
  | {kind: 'global'}
  | {kind: 'track'; track: TrackKey}
  | {kind: 'vocals'; part: string};

export const DEFAULT_DRUMS_EXPERT_SCOPE: EditorScope = {
  kind: 'track',
  track: {instrument: 'drums', difficulty: 'expert'},
};

export const DEFAULT_GUITAR_EXPERT_SCOPE: EditorScope = {
  kind: 'track',
  track: {instrument: 'guitar', difficulty: 'expert'},
};

export const DEFAULT_BASS_EXPERT_SCOPE: EditorScope = {
  kind: 'track',
  track: {instrument: 'bass', difficulty: 'expert'},
};

export const DEFAULT_VOCALS_SCOPE: EditorScope = {
  kind: 'vocals',
  part: 'vocals',
};

export function isTrackScope(
  scope: EditorScope,
): scope is Extract<EditorScope, {kind: 'track'}> {
  return scope.kind === 'track';
}

export function isVocalsScope(
  scope: EditorScope,
): scope is Extract<EditorScope, {kind: 'vocals'}> {
  return scope.kind === 'vocals';
}

/**
 * Resolve the `ParsedTrackData` referenced by a scope, or null when the
 * scope doesn't refer to a notes track (vocals / global) or the track
 * doesn't exist in the document.
 */
export function resolveScopeTrack(
  doc: ChartDocument | null,
  scope: EditorScope,
): ParsedTrackData | null {
  if (!doc || !isTrackScope(scope)) return null;
  return findTrack(doc, scope.track)?.track ?? null;
}

/**
 * Pretty-print a scope for log lines and UI fallbacks. Stable across
 * renders.
 */
export function describeScope(scope: EditorScope): string {
  switch (scope.kind) {
    case 'global':
      return 'global';
    case 'track':
      return `${scope.track.instrument}/${scope.track.difficulty}`;
    case 'vocals':
      return `vocals/${scope.part}`;
  }
}

/**
 * Useful when migrating a callsite that used to take an `Instrument` +
 * `Difficulty` directly: build the scope they want.
 */
export function trackScope(
  instrument: Instrument,
  difficulty: Difficulty,
): EditorScope {
  return {kind: 'track', track: {instrument, difficulty}};
}

/**
 * Pull the `TrackKey` out of a scope, or `undefined` when the scope
 * doesn't target a notes track (vocals / global). Callsites that
 * construct track-scoped commands pass the result straight through to
 * the command's optional `trackKey` argument.
 */
export function trackKeyFromScope(scope: EditorScope): TrackKey | undefined {
  return isTrackScope(scope) ? scope.track : undefined;
}

/**
 * Build an `EntityContext` from the active scope for `MoveEntitiesCommand`
 * and similar APIs that take the broader context. Handles both track
 * and vocals scopes.
 */
export function entityContextFromScope(scope: EditorScope): {
  trackKey?: TrackKey;
  partName?: string;
} {
  if (scope.kind === 'track') return {trackKey: scope.track};
  if (scope.kind === 'vocals') return {partName: scope.part};
  return {};
}
