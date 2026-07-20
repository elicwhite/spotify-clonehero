import {noteTypes} from '@eliwhite/scan-chart';
import {schemaForInstrument} from '../../chart-edit/instruments';
import type {ChartElement} from './SceneReconciler';
import type {NoteElementData} from './NoteRenderer';
import {resolveNoteGeometry} from './notePlacement';
import type {Track} from './types';

// ---------------------------------------------------------------------------
// NoteType -> name, for element key generation (e.g. 'note:480:redDrum')
// ---------------------------------------------------------------------------

const NOTE_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(noteTypes).map(([name, value]) => [value, name]),
);

// ---------------------------------------------------------------------------
// trackToElements
// ---------------------------------------------------------------------------

/**
 * Cache of previously created NoteElementData objects, keyed by
 * `tick:typeName:flags:msTime`. If a note hasn't changed between calls,
 * the cached data object is returned -- enabling reference equality
 * short-circuit in SceneReconciler.dataEqual().
 */
const dataCache = new Map<string, NoteElementData>();

/** Shallow equality check for NoteElementData (skipping the `note` object). */
function dataShallowEqual(a: NoteElementData, b: NoteElementData): boolean {
  return (
    a.xPosition === b.xPosition &&
    a.inStarPower === b.inStarPower &&
    a.isKick === b.isKick &&
    a.isOpen === b.isOpen &&
    a.lane === b.lane &&
    a.msLength === b.msLength &&
    a.note.type === b.note.type &&
    a.note.flags === b.note.flags &&
    a.note.msTime === b.note.msTime
  );
}

/**
 * Converts a scan-chart Track to an array of ChartElement[] suitable for
 * the SceneReconciler.
 *
 * Each note becomes a ChartElement with:
 * - key: 'note:{tick}:{typeName}' (e.g., 'note:2880:yellowDrum')
 * - kind: 'note'
 * - msTime: note's time in ms
 * - data: NoteElementData for the NoteRenderer
 *
 * NoteElementData objects are memoized per note identity (tick + type + flags + msTime)
 * so unchanged notes return the same object reference, letting the reconciler's
 * dataEqual() short-circuit on `a.data === b.data`.
 */
export function trackToElements(track: Track): ChartElement[] {
  const schema = schemaForInstrument(track.instrument);
  const supportsSustain = schema?.supportsSustain ?? false;
  const starPowerSections = track.starPowerSections;

  // Build sorted SP sections for binary search
  const spStarts = starPowerSections.map(s => s.msTime);
  const spEnds = starPowerSections.map(s => s.msTime + s.msLength);

  function inStarPowerSection(time: number): boolean {
    let lo = 0;
    let hi = spStarts.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (spStarts[mid] <= time) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return idx >= 0 && time <= spEnds[idx];
  }

  const newCache = new Map<string, NoteElementData>();

  function cachedData(
    cacheKey: string,
    data: NoteElementData,
  ): NoteElementData {
    const existing = dataCache.get(cacheKey);
    if (existing && dataShallowEqual(existing, data)) {
      newCache.set(cacheKey, existing);
      return existing;
    }
    newCache.set(cacheKey, data);
    return data;
  }

  const elements: ChartElement[] = [];

  for (const group of track.noteEventGroups) {
    const time = group[0].msTime;
    const starPower = inStarPowerSection(time);

    for (const note of group) {
      const tick = note.tick ?? 0;
      const typeName = NOTE_TYPE_NAMES[note.type];
      if (!typeName) continue;

      const geometry = resolveNoteGeometry(track.instrument, note);
      if (!geometry) continue;

      const key = `note:${tick}:${typeName}`;
      const data = cachedData(key, {
        note,
        xPosition: geometry.xPosition,
        inStarPower: starPower,
        isKick: geometry.isKick,
        isOpen: geometry.isOpen,
        lane: geometry.lane,
        msLength: supportsSustain ? note.msLength : 0,
      });
      elements.push({key, kind: 'note', msTime: note.msTime, data});
    }
  }

  // Swap cache: old entries not in newCache are freed
  dataCache.clear();
  for (const [k, v] of newCache) {
    dataCache.set(k, v);
  }

  return elements;
}
