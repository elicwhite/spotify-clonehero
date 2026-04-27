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

export type {TrackKey};

export type EditorScope =
  | {kind: 'global'}
  | {kind: 'track'; track: TrackKey}
  | {kind: 'vocals'; part: string};

export const DEFAULT_DRUMS_EXPERT_SCOPE: EditorScope = {
  kind: 'track',
  track: {instrument: 'drums', difficulty: 'expert'},
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
