/**
 * A smoke check of the product highway, against the film's clock. On every
 * frame it draws the chart three times at the song second the film's clock
 * gives the frame:
 *
 * - the highway under test, karaoke line on (so it replays playback, as a
 *   film's highway does);
 * - the same without one probe note: the two pictures differ exactly where
 *   the app drew the probe, so the centroid of the difference is the probe;
 * - a twin with no history: karaoke off, so nothing is replayed and the
 *   frame is drawn from its song time alone.
 *
 * It fails the render when the frame is black; when the probe is drawn more
 * than half a frame of travel from where the film's clock puts its gem
 * (the app's own camera and sprite geometry, `gemCentre`), checked while the
 * probe is on the near half of the floor and clear of the strikeline; when
 * the twin differs from the highway by a single pixel below the karaoke band
 * (a stale clock, or a frame drawn from another frame's state); and, on
 * `hitFrame`, when the drawn song second is not the probe's. The readout in
 * the frame shows what was measured.
 *
 * `skewFrames` draws every highway that many frames off the film's clock:
 * the check's own test. A skew of a frame fails it.
 */
import {useMemo, useRef} from 'react';
import {AbsoluteFill, cancelRender, useVideoConfig} from 'remotion';
import type {ChartDocument} from '@eliwhite/scan-chart';
import {CANVAS_CSS_HEIGHT} from '@product/lib/preview/highway/LyricsOverlay';
import {useGlobalFrame} from '../clock';
import type {Segment} from '../music';
import type {Point, Rect} from '../motion';
import {deleteNotes, type TrackRef} from './editing';
import {highwayInstrumentOf, noteWorldY, STRIKELINE_Y} from './floor';
import {
  GEM_HEIGHT,
  gemCentre,
  type DrumPad,
  type HighwayBox,
} from './highwayGeometry';
import {ProductHighway, type ProductHighwayProps} from './ProductHighway';
import {differenceOf, litFraction, mismatchOf, readPixels} from './smokeCheck';
import {songPositionAt, type SongPositionInput} from './songPosition';

export interface SmokeProbe {
  track: TrackRef;
  /** The note's editor id (`noteIdOf`). */
  noteId: string;
  /** The lane it draws in (`laneOfNoteType`): a gem, in a pad or fret lane. */
  lane: DrumPad | number;
  /** Its song second. */
  atSec: number;
}

/** The film's clock, as ProductHighway takes it. */
type Clock = Pick<
  ProductHighwayProps,
  'songTimeSec' | 'segments' | 'segmentIndex' | 'playbackFromSec'
>;

export interface HighwaySmokeProps
  extends Clock,
    Pick<ProductHighwayProps, 'pixelRatio' | 'width' | 'height'> {
  chart: ChartDocument;
  probe: SmokeProbe;
  /** Least fraction of lit pixels a frame may have. Default 0.05. */
  minLit?: number;
  /**
   * The film frame on which the probe should reach the strikeline: on that
   * frame the highway must draw the probe's own song second (to half a
   * frame), which ties the film's clock to the song. Optional.
   */
  hitFrame?: number;
  /**
   * Draw every highway this many frames off the film's clock: the check's
   * own test (a skew of a frame must fail it). Default 0.
   */
  skewFrames?: number;
  /** Fail the render when a check fails (default true); false only reports. */
  failOnError?: boolean;
}

/** Fewest differing pixels (device px) that count as the probe note being drawn. */
const MIN_NOTE_PIXELS = 40;

/** The most the probe may sit from its place along its travel, in frames. */
const MAX_OFF_FRAMES = 0.5;

/**
 * The probe's timing is checked while its anchor is on the near half of the
 * floor (world Y 0 and below, where the gem is large) and a gem's height
 * clear of the strikeline (before the strikeline clips it and its hit
 * flame starts).
 */
const CHECK_FROM_Y = 0;
const CHECK_TO_Y = STRIKELINE_Y + GEM_HEIGHT;

/** The clock moved `skewSec` on: every song second it gives is that much later. */
const skewedClock = (clock: Clock, skewSec: number): Clock => {
  if (skewSec === 0) return clock;
  const playbackFromSec =
    clock.playbackFromSec === undefined
      ? undefined
      : clock.playbackFromSec + skewSec;
  if (clock.songTimeSec !== undefined)
    return {
      ...clock,
      songTimeSec: clock.songTimeSec + skewSec,
      playbackFromSec,
    };
  // Without an edit, film time is song time: one segment from film second 0.
  const segments: readonly Segment[] = clock.segments ?? [
    {
      videoStart: 0,
      videoEnd: Number.MAX_VALUE,
      songStart: 0,
      songEnd: Number.MAX_VALUE,
    },
  ];
  return {
    ...clock,
    segments: segments.map(s => ({
      ...s,
      songStart: s.songStart + skewSec,
      songEnd: s.songEnd + skewSec,
    })),
    playbackFromSec,
  };
};

/** What one highway's draw of a frame gave the check. */
interface Sample {
  songSec: number;
  lit: number | null;
  /** Around the probe's place, when its timing is checked. */
  probe: ImageData | null;
  /** Below the karaoke band, for the twin. */
  body: ImageData | null;
}

export const HighwaySmoke: React.FC<HighwaySmokeProps> = ({
  chart,
  probe,
  minLit = 0.05,
  hitFrame,
  skewFrames = 0,
  failOnError = true,
  pixelRatio = 2,
  width,
  height,
  songTimeSec,
  segments,
  segmentIndex,
  playbackFromSec,
}) => {
  const video = useVideoConfig();
  const frame = useGlobalFrame();
  const box: HighwayBox = {
    width: width ?? video.width,
    height: height ?? video.height,
  };
  const clock: Clock = {songTimeSec, segments, segmentIndex, playbackFromSec};
  const input: SongPositionInput = {frame, fps: video.fps, ...clock};
  // What the film's clock says this frame shows; the highways draw it (or,
  // skewed, `skewFrames` frames off it).
  const expectedSec = songPositionAt(input).songSec;
  const drawn = skewedClock(clock, skewFrames / video.fps);

  const without = useMemo(
    () => deleteNotes(chart, probe.track, [probe.noteId]),
    [chart, probe.track, probe.noteId],
  );
  const instrument = highwayInstrumentOf(probe.track);
  const readout = useRef<HTMLDivElement>(null);
  const pending = useRef<{
    frame: number;
    full?: Sample;
    bare?: Sample;
    twin?: Sample;
  } | null>(null);

  const centreAt = (nowSec: number): Point =>
    gemCentre({
      box,
      instrument,
      lane: probe.lane,
      atSec: probe.atSec,
      nowSec,
    });
  const probeChecked =
    noteWorldY(probe.atSec, expectedSec) <= CHECK_FROM_Y &&
    noteWorldY(probe.atSec, expectedSec) >= CHECK_TO_Y;
  /** The canvas region (device px) the probe is looked for in. */
  const probeRegion = (): Rect => {
    const p = centreAt(expectedSec);
    const size = 0.16 * box.height;
    return {
      x: (p.x - size / 2) * pixelRatio,
      y: (p.y - size / 2) * pixelRatio,
      width: size * pixelRatio,
      height: size * pixelRatio,
    };
  };
  /** Everything below the karaoke band, the one part the twin draws differently. */
  const bodyRegion = (canvas: HTMLCanvasElement): Rect => {
    const top = Math.ceil(CANVAS_CSS_HEIGHT * pixelRatio);
    return {x: 0, y: top, width: canvas.width, height: canvas.height - top};
  };

  /**
   * How far the probe is drawn from its gem's place along its travel, in
   * frames of that travel (+: further on, as if drawn later in the song);
   * null when it is not drawn near its place at all.
   */
  const probeOffFrames = (full: ImageData, bare: ImageData): number | null => {
    const found = differenceOf(full, bare);
    if (!found || found.count < MIN_NOTE_PIXELS) return null;
    const region = probeRegion();
    const at = {
      x: (Math.max(0, Math.floor(region.x)) + found.x) / pixelRatio,
      y: (Math.max(0, Math.floor(region.y)) + found.y) / pixelRatio,
    };
    const here = centreAt(expectedSec);
    const next = centreAt(expectedSec + 1 / video.fps);
    const step = {x: next.x - here.x, y: next.y - here.y};
    return (
      ((at.x - here.x) * step.x + (at.y - here.y) * step.y) /
      (step.x * step.x + step.y * step.y)
    );
  };

  const evaluate = (full: Sample, bare: Sample, twin: Sample) => {
    const notes = [`song ${full.songSec.toFixed(3)} s`];
    const problems: string[] = [];
    if (
      frame === hitFrame &&
      Math.abs(full.songSec - probe.atSec) > 0.5 / video.fps
    )
      problems.push(
        `film frame ${frame} draws song ${full.songSec.toFixed(3)} s, but the probe (song ${probe.atSec.toFixed(3)} s) should be on the strikeline`,
      );
    if (full.lit !== null) {
      notes.push(`lit ${(full.lit * 100).toFixed(1)}%`);
      if (full.lit < minLit)
        problems.push(
          `the highway is black: ${(full.lit * 100).toFixed(1)}% of the frame is lit (at least ${(minLit * 100).toFixed(1)}% expected)`,
        );
    }
    if (full.probe && bare.probe) {
      const off = probeOffFrames(full.probe, bare.probe);
      if (off === null) {
        const here = centreAt(expectedSec);
        problems.push(
          `the probe note is not drawn near (${here.x.toFixed(1)}, ${here.y.toFixed(1)}) at song ${expectedSec.toFixed(3)} s`,
        );
      } else {
        notes.push(
          `probe ${off >= 0 ? '+' : ''}${off.toFixed(2)} frames from its place (${MAX_OFF_FRAMES} allowed)`,
        );
        if (Math.abs(off) > MAX_OFF_FRAMES)
          problems.push(
            `the probe note is drawn ${off.toFixed(2)} frames from where the film's clock puts it at song ${expectedSec.toFixed(3)} s (${MAX_OFF_FRAMES} allowed)`,
          );
      }
    } else notes.push('probe off the checked stretch');
    if (full.body && twin.body) {
      const mismatch = mismatchOf(full.body, twin.body);
      notes.push(`twin ${mismatch.count === 0 ? 'identical' : 'differs'}`);
      if (mismatch.count > 0)
        problems.push(
          `the highway and its twin with no history differ in ${mismatch.count} pixels (first at ${mismatch.first?.x}, ${(mismatch.first?.y ?? 0) + Math.ceil(CANVAS_CSS_HEIGHT * pixelRatio)} device px) at song ${full.songSec.toFixed(3)} s`,
        );
    }
    if (readout.current) {
      readout.current.textContent = problems.length
        ? `FAIL: ${problems.join('; ')}`
        : `ok: ${notes.join(' · ')}`;
      readout.current.style.color = problems.length ? '#ff6b6b' : '#8ef0a8';
    }
    if (problems.length && failOnError)
      cancelRender(new Error(`[highway smoke] ${problems.join('; ')}`));
  };

  const sample =
    (which: 'full' | 'bare' | 'twin') =>
    (canvas: HTMLCanvasElement, songSec: number) => {
      const s: Sample = {
        songSec,
        lit: which === 'full' ? litFraction(readPixels(canvas)) : null,
        probe:
          which !== 'twin' && probeChecked
            ? readPixels(canvas, probeRegion())
            : null,
        body: which !== 'bare' ? readPixels(canvas, bodyRegion(canvas)) : null,
      };
      let p = pending.current;
      if (!p || p.frame !== frame) p = pending.current = {frame};
      p[which] = s;
      if (p.full && p.bare && p.twin) {
        pending.current = null;
        evaluate(p.full, p.bare, p.twin);
      }
    };

  const shared = {...drawn, pixelRatio, width: box.width, height: box.height};
  const hidden = {position: 'absolute', left: 0, top: 0, opacity: 0} as const;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <ProductHighway
        {...shared}
        chart={chart}
        panes={[{track: probe.track}]}
        onDraw={sample('full')}
      />
      <ProductHighway
        {...shared}
        chart={without}
        panes={[{track: probe.track}]}
        onDraw={sample('bare')}
        style={hidden}
      />
      <ProductHighway
        {...shared}
        chart={chart}
        panes={[{track: probe.track}]}
        showLyrics={false}
        onDraw={sample('twin')}
        style={hidden}
      />
      <div
        ref={readout}
        style={{
          position: 'absolute',
          left: 24,
          top: 20,
          font: '600 22px ui-monospace, monospace',
          whiteSpace: 'pre-wrap',
          maxWidth: box.width - 48,
          textShadow: '0 1px 3px #000',
        }}
      />
    </AbsoluteFill>
  );
};
