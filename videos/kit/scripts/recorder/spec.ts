/**
 * Take specs: one module per take, its default export the spec. The spec
 * format for any web page (record.mjs) is below; an app adapter documents
 * the fields it adds (apps/chart-editor/README.md).
 *
 * ```js
 * export default {
 *   id: 'example',                       // the take's folder name; the file is usually <id>.spec.mjs
 *   description: 'What the take shows.',  // for the manifest
 *   url: 'http://127.0.0.1:4173/',        // the page (the CLI's --app-url wins)
 *   viewport: {width: 1920, height: 1080, scale: 2},  // the default
 *   colorScheme: 'dark',                  // prefers-color-scheme; omit to keep the browser's
 *   fps: 60,                              // the frame rate without a timeline (with one, the timeline's)
 *   // Where the take sits in the film, one of:
 *   frames: {from: 0, to: 119},           // film frames captured, inclusive
 *   scene: 'intro', window: {bars: 2},    // a storyboard scene (--timeline and --storyboard)
 *   songBar: 12,                          // optional: fail unless the scene opens on this song bar
 *   followsSong: true,                    // the page plays the film's song (pin it): the manifest
 *                                         // records each frame's song time for the edit check
 *   components: {window: null, card: '.card', header: {x: 0, y: 0, width: 1920, height: 64}},
 *                                         // null = the whole viewport, a CSS selector (measured
 *                                         // after the clock stops) or a CSS px box
 *   live: {elements: {button: 'button.primary'}},  // boxes read on frames whose steps need targets
 *   ready: 'document.fonts.status === "loaded"',   // page expression to wait for after loading
 *   async prepare(page, ctx) {},          // before the clock stops (real time)
 *   async begin(page, ctx) {},            // after the clock stops, before the pre-roll
 *   pin(f, ctx) { return '...' },         // page statements pinning the app's own clock on frame f
 *   read: '({...})',                      // page expression read after every captured frame
 *   frameData(value, ctx) { return {} },  // fields for the frame's record, from `read` (ctx plus {f, page, cursor})
 *   assertSync(value, f) {},              // throw when the app is out of step with the film
 *   plan(ctx) { return new Plan({fps: ctx.fps}) },  // scripted input (gestures.mjs)
 * };
 * ```
 *
 * `ctx` is the hook context, one object every hook gets (record-cli.mjs
 * builds it): {log, fps, start, from, to, viewport} and, with a timeline,
 * {tl, beat}. `start` is the first frame played (the pre-roll's),
 * `tl.songAt(f)` the song second and segment a frame plays, and
 * `beat(bar, beat)` the film frame of a bar and beat counted from the
 * scene's first bar. Place every frame by the music (beat, or
 * tl.frameOfSong) or relative to `from`, never by a typed film frame.
 */
import {importExport} from '../lib/cli';
import type {SceneBeat} from '../../src/clock/storyboard';
import type {FilmTimeline, TakePlacementSpec} from './film-time';

export const DEFAULT_VIEWPORT = {width: 1920, height: 1080, scale: 2};

/** The fields every spec has; the rest are the recorder's or an adapter's. */
export interface TakeSpec extends TakePlacementSpec {
  description: string;
  frames?: {from: number; to: number};
  fps?: number;
  [field: string]: unknown;
}

/** Import a spec module and check the fields every spec needs. */
export const loadSpec = async (file: string): Promise<TakeSpec> => {
  const spec = (await importExport(file, 'default')) as
    | Partial<TakeSpec>
    | undefined;
  if (!spec || typeof spec !== 'object')
    throw new Error(`${file}: the default export is not a spec`);
  if (typeof spec.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(spec.id))
    throw new Error(
      `${file}: \`id\` must be a folder-safe name (letters, digits, . _ -)`,
    );
  if (typeof spec.description !== 'string')
    throw new Error(`${file}: \`description\` is missing`);
  return spec as TakeSpec;
};

export interface TakeFrames {
  /** The first frame played: the pre-roll starts here. */
  start: number;
  /** The first and last frames captured, inclusive. */
  from: number;
  to: number;
  /** The scene's beats, for a take placed by scene. */
  beat: SceneBeat | null;
}

/**
 * The frames a take covers, from the spec's `frames` or its scene, with
 * `preroll` frames played before the first. `override` ([from, to], the
 * CLI's --frames) records only part of it.
 */
export const takeFrames = (
  spec: TakeSpec,
  {
    tl = null,
    preroll,
    override,
  }: {
    tl?: FilmTimeline | null;
    preroll: number;
    override?: readonly [number, number];
  },
): TakeFrames => {
  let placed: {from: number; to: number; beat?: SceneBeat};
  if (spec.frames) placed = {from: spec.frames.from, to: spec.frames.to};
  else if (spec.scene) {
    if (!tl) throw new Error(`${spec.id} is placed by scene: pass --timeline`);
    placed = tl.place(spec);
  } else
    throw new Error(`${spec.id} needs \`frames\` or \`scene\` to place it`);
  const [from, to] = override ?? [placed.from, placed.to];
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from)
    throw new Error(`${spec.id}: bad frame range ${from}-${to}`);
  return {start: from - preroll, from, to, beat: placed.beat ?? null};
};
