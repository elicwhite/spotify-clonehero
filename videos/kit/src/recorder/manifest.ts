/**
 * The recorder's manifests (`<root>/<id>/manifest.json`, written by
 * scripts/recorder) and their loaders. This is the part every recording
 * shares, whatever app it shows; an app adapter adds its own per-frame data
 * on top (chartEditor.ts for the chart editor). See README.md.
 */
import {loadJson} from '../load';
import type {Rect} from '../motion';

export interface RecordedComponent {
  /** Where the component was on screen (CSS px of the recorded viewport). */
  box: Rect;
  /** The device-pixel crop the video holds (rounded out to even pixels). */
  crop: Rect;
  /** Video file, relative to the recording's folder. */
  file: string;
  width: number;
  height: number;
}

export interface RecordedCursor {
  /** Viewport CSS px of the real input. */
  x: number;
  y: number;
  /** A button is held. */
  down: boolean;
  /** False while parked off the app (hide your cursor). */
  visible: boolean;
  /** The smallest component under the pointer ('window' when none). */
  over: string | null;
  /** Input sent on this frame: move, press, release, wheel, park, call, key:<mods>+<key>. */
  events?: string[];
}

/** One recorded film frame. App adapters extend it with their own data. */
export interface RecordedFrame {
  /** Film frame. */
  f: number;
  cursor: RecordedCursor;
  /** Song seconds the app showed, for a take that follows a song. */
  songSec?: number;
}

export interface Interaction {
  from: number;
  to: number;
  kind: string;
  description: string;
}

/** Song seconds per film frame, one range per segment of the film's edit. */
export interface SongTimeMap {
  formula: string;
  ranges: {
    segment: number;
    /**
     * The take held this segment's mapping past its ends (a take pinned to
     * one segment plays on through a splice instead of seeking); false: the
     * range follows the edit.
     */
    pinned: boolean;
    fromFrame: number;
    toFrame: number;
    songSecAtFromFrame: number;
  }[];
}

export interface RecordingManifest<
  Frame extends RecordedFrame = RecordedFrame,
> {
  version: 1;
  id: string;
  /** Which recorder wrote it: 'web' (any page) or an app adapter's name. */
  app: string;
  description: string;
  fps: number;
  viewport: {width: number; height: number; deviceScaleFactor: number};
  /** Video frame i shows film frame `from + i`. */
  range: {from: number; to: number; count: number};
  /** For a take that follows a song: the song time it recorded on each frame. */
  songTime?: SongTimeMap;
  components: Record<string, RecordedComponent>;
  interactions: Interaction[];
  frames: Frame[];
  encoding: {
    codec: string;
    crf: number;
    preset: string;
    pixFmt: string;
    colorspace: string;
  } | null;
  pageErrors: string[];
  recordedAt: string;
}

/**
 * Where a film keeps a take: `root` is the folder of takes under the film's
 * public dir (e.g. `generated/rec`), `id` the take's folder in it. Films name
 * their own ids.
 */
export interface RecordingRef {
  root: string;
  id: string;
  /** The command that records the take, named when it is missing. */
  writtenBy?: string;
}

/**
 * A file in a take's folder, as a path in the film's public dir (for
 * `loadJson`, or `publicUrl` for a src).
 */
export const recordingPath = (ref: RecordingRef, file: string): string =>
  `${ref.root}/${ref.id}/${file}`;

/** Fetch a take's manifest. */
export const loadRecording = <M extends RecordingManifest = RecordingManifest>(
  ref: RecordingRef,
): Promise<M> =>
  loadJson<M>(recordingPath(ref, 'manifest.json'), {writtenBy: ref.writtenBy});

/** The recorded frame record nearest a film frame, clamped to the take. */
export const recordedFrameAt = <M extends RecordingManifest>(
  m: M,
  filmFrame: number,
): M['frames'][number] => {
  const i = Math.min(
    m.range.count - 1,
    Math.max(0, Math.round(filmFrame) - m.range.from),
  );
  const frame = m.frames[i];
  if (!frame) throw new Error(`${m.id} has no frame records`);
  return frame;
};

/** A recorded component by name; a take without it fails the render. */
export const recordedComponent = (
  m: RecordingManifest,
  name: string,
): RecordedComponent => {
  const component = m.components[name];
  if (!component) {
    throw new Error(
      `${m.id} has no "${name}" component (it has ${Object.keys(m.components).join(', ')})`,
    );
  }
  return component;
};

/** The take's first interaction of `kind`; a take without one fails the render. */
export const recordedInteraction = (
  m: RecordingManifest,
  kind: string,
): Interaction => {
  const hit = m.interactions.find(i => i.kind === kind);
  if (!hit) throw new Error(`${m.id} has no "${kind}" interaction`);
  return hit;
};
