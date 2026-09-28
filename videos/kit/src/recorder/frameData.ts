/**
 * Per-frame data of a take, and the real pointer as a cursor script.
 */
import {useGlobalFrame} from '../clock';
import {toFrames} from '../format';
import {linear} from '../motion';
import type {CursorKey, CursorScript, CursorWindow} from '../ui/cursor';
import {
  recordedFrameAt,
  type RecordingManifest,
  type RecordingRef,
} from './manifest';
import {useRecording} from './useRecording';

export interface RecordedFrameData<
  M extends RecordingManifest = RecordingManifest,
> {
  manifest: M;
  /** The film frame described (clamped into the take). */
  filmFrame: number;
  /** Whether the requested film frame lies inside the take. */
  inside: boolean;
  /** The frame's record: song time, pointer, and the app adapter's data. */
  frame: M['frames'][number];
}

/** Everything a take knows about one film frame. */
export const recordedFrameData = <M extends RecordingManifest>(
  manifest: M,
  filmFrame: number,
): RecordedFrameData<M> => {
  const frame: M['frames'][number] = recordedFrameAt(manifest, filmFrame);
  const f = Math.round(filmFrame);
  return {
    manifest,
    filmFrame: frame.f,
    inside: f >= manifest.range.from && f <= manifest.range.to,
    frame,
  };
};

/** `recordedFrameData` for a film frame (default: the current one); null while the take loads. */
export const useRecordedFrame = <
  M extends RecordingManifest = RecordingManifest,
>(
  ref: RecordingRef,
  frame?: number,
): RecordedFrameData<M> | null => {
  const global = useGlobalFrame();
  const manifest = useRecording<M>(ref);
  return manifest ? recordedFrameData(manifest, frame ?? global) : null;
};

/** The longest press that reads as a click; a longer one is a drag. */
const CLICK_MAX_SEC = 0.15;

/**
 * The real pointer over [from, to] as a cursor script for the ui area's
 * `<Cursor>`: one key per recorded frame the pointer moved (linear, no arc,
 * so it retraces the input exactly), presses up to `clickFrames` long (by
 * default 0.15 s) as clicks and longer ones as drags, and a visibility
 * window for every time it appeared (a take parks the pointer off the app
 * between gestures). Positions are viewport CSS px; map them the way the
 * recorded layers are mapped (`<Cursor project>`).
 */
export const recordedCursorPath = (
  manifest: RecordingManifest,
  {
    from = manifest.range.from,
    to = manifest.range.to,
    clickFrames = Math.round(toFrames(CLICK_MAX_SEC, manifest.fps)),
  }: {from?: number; to?: number; clickFrames?: number} = {},
): Required<CursorScript> => {
  const path: CursorKey[] = [];
  const clicks: number[] = [];
  const drags: [number, number][] = [];
  const visible: CursorWindow[] = [];
  let shown: CursorWindow | null = null;
  let pressAt: number | null = null;
  let last: {x: number; y: number} | null = null;
  for (const r of manifest.frames) {
    if (r.f < from || r.f > to) continue;
    const c = r.cursor;
    if (c.visible && !shown) {
      shown = {appearAt: r.f};
      visible.push(shown);
    } else if (!c.visible && shown) {
      shown.hideAt = r.f;
      shown = null;
    }
    if (c.visible && (!last || last.x !== c.x || last.y !== c.y)) {
      path.push({at: r.f, x: c.x, y: c.y, ease: linear, arc: 0});
      last = {x: c.x, y: c.y};
    }
    for (const e of c.events ?? []) {
      if (e === 'press') pressAt = r.f;
      if (e === 'release' && pressAt !== null) {
        if (r.f - pressAt <= clickFrames) clicks.push(pressAt);
        else drags.push([pressAt, r.f]);
        pressAt = null;
      }
    }
  }
  return {path, clicks, drags, visible};
};
