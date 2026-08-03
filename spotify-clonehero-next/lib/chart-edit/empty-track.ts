/**
 * The canonical "a track with no events in it" shape.
 *
 * scan-chart's `ParsedTrackData` carries one array per event kind. Every
 * place that builds a fresh track or wipes an existing one has to name all
 * of them, and any place that forgets one silently ships a track missing a
 * container. Naming them once here means a scan-chart schema change is a
 * single edit rather than a hunt.
 */

import type {ParsedTrackData} from './types';
import type {TrackKey} from './find-track';

/** Every event container `ParsedTrackData` defines, empty. */
export function emptyTrackContents(): Omit<
  ParsedTrackData,
  'instrument' | 'difficulty'
> {
  return {
    noteEventGroups: [],
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    textEvents: [],
    versusPhrases: [],
    animations: [],
    unrecognizedMidiEvents: [],
  };
}

/** A complete, empty track for `key`'s instrument and difficulty. */
export function emptyTrack(key: TrackKey): ParsedTrackData {
  return {
    instrument: key.instrument,
    difficulty: key.difficulty,
    ...emptyTrackContents(),
  };
}

/** `track` with every event container emptied, keeping its identity and any
 *  other fields it carries. Used when a whole track is replaced by generated
 *  content: anything the generator didn't author must not survive from the
 *  track it replaced. */
export function clearTrackContents(track: ParsedTrackData): ParsedTrackData {
  return {...track, ...emptyTrackContents()};
}
