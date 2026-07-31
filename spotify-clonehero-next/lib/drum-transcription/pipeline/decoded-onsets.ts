/**
 * Decoded-onset retention (plan 0061 §3a).
 *
 * The ML transcriber's pre-snap onset times (`RawDrumEvent[]`) are the input
 * a tempo-map structural correction (class (b), RE-PREDICT) must re-snap
 * from — the already-snapped note `msTime`s carry the old lattice's
 * quantization baked in, so they are NOT a substitute. The pipeline runner
 * persists them to `decoded-onsets.json` at every site that writes
 * `confidence.json`; this module owns the file's name, its construction from
 * `RawDrumEvent[]`, and the read side for the editor.
 */

import type {DecodedOnsetsFile, RawDrumEvent} from '../ml/types';
import {DRUM_CLASSES} from '../ml/types';
import {projectFileExists, readProjectJSON} from '../storage/opfs';

/** Filename for the persisted decoded onsets. Exported so the runner's
 * write sites and `REGENERATED_ARTIFACT_FILES` share one string. */
export const DECODED_ONSETS_FILE = 'decoded-onsets.json';

const VALID_FLOWS: ReadonlyArray<DecodedOnsetsFile['flow']> = [
  'audio',
  'chart',
];

/**
 * Build the persistable `DecodedOnsetsFile` from the transcriber's raw
 * events. Fields are picked explicitly so future additions to
 * `RawDrumEvent` never leak into the persisted schema unversioned.
 */
export function buildDecodedOnsetsFile(
  events: readonly RawDrumEvent[],
  flow: DecodedOnsetsFile['flow'],
): DecodedOnsetsFile {
  return {
    version: 1,
    flow,
    onsets: events.map(e => ({
      timeSeconds: e.timeSeconds,
      drumClass: e.drumClass,
      midiPitch: e.midiPitch,
      confidence: e.confidence,
    })),
  };
}

/** Class names the current model emits. An onset naming anything else was
 * written by an older model lineage (the 9-lane head had a crash-2 class);
 * such onsets are dropped on load rather than handed to the class->chart
 * table, which has no entry for them. */
const KNOWN_CLASSES: ReadonlySet<string> = new Set(
  DRUM_CLASSES.map(c => c.name),
);

function isValidDecodedOnsetsFile(data: unknown): data is DecodedOnsetsFile {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d['version'] === 1 &&
    VALID_FLOWS.includes(d['flow'] as DecodedOnsetsFile['flow']) &&
    Array.isArray(d['onsets'])
  );
}

/**
 * Load a project's retained decoded onsets.
 *
 * Returns `null` when the file doesn't exist — meaning this project was
 * never transcribed by this app (hand-authored, or imported with a
 * hand-written drum track) and class-(b) tempo corrections must fall back
 * to RESNAP — and also when the file is unreadable or fails the version
 * check (an incompatible/stale schema is discarded, never misinterpreted).
 *
 * Onsets naming a class the current model doesn't emit are dropped — see
 * {@link KNOWN_CLASSES}.
 */
export async function loadDecodedOnsets(
  projectId: string,
): Promise<DecodedOnsetsFile | null> {
  if (!(await projectFileExists(projectId, DECODED_ONSETS_FILE))) {
    return null;
  }
  let data: unknown;
  try {
    data = await readProjectJSON<unknown>(projectId, DECODED_ONSETS_FILE);
  } catch {
    return null;
  }
  if (!isValidDecodedOnsetsFile(data)) return null;
  return {
    ...data,
    onsets: data.onsets.filter(o => KNOWN_CLASSES.has(o.drumClass)),
  };
}
