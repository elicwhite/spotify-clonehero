/**
 * The contract check: what a timeline must hold for the API to mean
 * anything. Pure; a writer can run it before saving.
 */
import type {Timeline, TimelineVersion} from './contract';

/** The contract version this kit writes and reads. */
export const TIMELINE_VERSION: TimelineVersion = 2;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const isNumberArray = (v: unknown): boolean =>
  Array.isArray(v) && v.every(x => typeof x === 'number');

/** Every way `value` breaks the timeline contract (empty when it holds). */
export const timelineProblems = (value: unknown): string[] => {
  if (!isObject(value)) return ['not an object'];
  const tl = value as Partial<Timeline> & Record<string, unknown>;
  const problems: string[] = [];
  if (tl.version !== TIMELINE_VERSION) {
    problems.push(
      `version is ${String(tl.version)}, expected ${TIMELINE_VERSION}`,
    );
  }
  if (typeof tl.fps !== 'number' || !(tl.fps > 0)) problems.push('no fps');
  if (typeof tl.durationSec !== 'number') problems.push('no durationSec');
  if (!isObject(tl.meta) || typeof tl.meta.title !== 'string') {
    problems.push('missing meta.title');
  }
  if (!isObject(tl.meta) || typeof tl.meta.artist !== 'string') {
    problems.push('missing meta.artist');
  }
  if (
    !isObject(tl.tempo) ||
    !(tl.tempo.beatSec > 0) ||
    !(tl.tempo.barSec > 0)
  ) {
    problems.push('missing tempo.beatSec / tempo.barSec');
  }
  if (!Array.isArray(tl.beats) || tl.beats.length === 0)
    problems.push('no beats');
  if (!Array.isArray(tl.bars) || tl.bars.length === 0) problems.push('no bars');
  if (!Array.isArray(tl.segments) || tl.segments.length === 0) {
    problems.push('no segments');
  }
  if (!isObject(tl.notes) || !Array.isArray(tl.notes.drums)) {
    problems.push('missing notes.drums');
  }
  if (!isObject(tl.notes) || !Array.isArray(tl.notes.guitar)) {
    problems.push('missing notes.guitar');
  }
  if (!isObject(tl.vocals) || !Array.isArray(tl.vocals.syllables)) {
    problems.push('missing vocals.syllables');
  }
  if (!isObject(tl.vocals) || !Array.isArray(tl.vocals.phrases)) {
    problems.push('missing vocals.phrases');
  }
  const hits = tl.hits;
  for (const kind of ['kick', 'snare', 'crash', 'any'] as const) {
    if (!isObject(hits) || !isNumberArray(hits[kind])) {
      problems.push(`missing hits.${kind}`);
    }
  }
  return problems;
};

/** `value` as a Timeline, or an error naming every problem and `source`. */
export const assertTimeline = (value: unknown, source: string): Timeline => {
  const problems = timelineProblems(value);
  if (problems.length > 0) {
    throw new Error(
      `${source} breaks the timeline contract: ${problems.join('; ')}. Regenerate it.`,
    );
  }
  return value as Timeline;
};
