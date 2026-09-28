import {
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {cancelRender, useVideoConfig} from 'remotion';
import type {ChartDocument} from '@eliwhite/scan-chart';
import {buildTimedTempos} from '@product/lib/drum-transcription/timing';
import {trackLabel} from '@product/components/chart-editor/trackLabels';
import {useGlobalFrame} from '../clock';
import type {Segment} from '../music';
import {EXPERT_DRUMS} from './editing';
import {stageLayout} from './highwayGeometry';
import {
  paneKeyOf,
  useDrawHold,
  useHighwayPanes,
  useHighwayStage,
  useKaraokeReplay,
} from './stageHooks';
import {karaokeOf, pushPaneState, type HighwayPane} from './stageSync';

/**
 * The chart editor's highway, drawn by the app's own three.js renderer
 * (APP/lib/preview/highway/stage.ts, the stage the editor mounts) inside a
 * Remotion frame. Every pixel inside the canvas is the app's: its camera,
 * geometry, textures, fog, note sprites, hit flames, grid and karaoke line.
 * Frame the canvas from outside (the `style` prop: transforms, masks,
 * filters, blend modes); never restyle what it draws.
 *
 * Each frame is a pure function of the props and the song time, so frames
 * render in any order and in parallel tabs. The component sets the stage's
 * clock and calls `renderFrame`, which draws synchronously with every looping
 * gem texture on the frame it shows at that time. The karaoke line is the one
 * stateful part of the app's picture (its slide between lines depends on the
 * frames before), so before drawing a frame the component replays the app's
 * playback up to it (karaokeReplay.ts); see `playbackFromSec`.
 *
 * Anything that goes wrong fails the render (`cancelRender`): a stage that
 * cannot be built, a track the chart lacks, an app asset that did not load
 * (the app would draw a placeholder), an error inside the app's draw, or a
 * lost WebGL context.
 */

export interface ProductHighwayProps {
  /**
   * The chart document drawn this frame; null while it loads (the frame
   * waits). The stage is built from the first document it gets, the way the
   * editor builds it once; later documents must be edits of that one (see
   * `editHistory`), and the highway updates the way the editor's does. For a
   * different chart, mount a new ProductHighway (a new `key`).
   */
  chart: ChartDocument | null;
  /** Highways left to right, laid out the way the editor lays out its strip. Default: Expert drums. */
  panes?: readonly HighwayPane[];
  /**
   * Song (chart) second at the strikeline. Default: film time mapped
   * through `segments`, or film time itself when there are none.
   */
  songTimeSec?: number;
  /**
   * The film's edit of the song (the music timeline's segments): each plays
   * one stretch of the song, and film time maps to song time through them.
   */
  segments?: readonly Segment[];
  /** Pin the film-to-song mapping to one segment (for a shot that crosses a cut). */
  segmentIndex?: number;
  /**
   * Song second the app's playback started from, which is where it last
   * seeked. Each frame is drawn after replaying that playback up to it (only
   * the karaoke line depends on it): on the film's frames from the frame
   * that plays this second, or, with an explicit `songTimeSec`, at 1x on a
   * grid of the film's frame rate from it. Default: the first frame of the
   * segment playing (where the film cuts to it), or film frame 0 without
   * segments; with `songTimeSec`, that time itself (every frame a seek).
   */
  playbackFromSec?: number;
  /** Draw the chart's karaoke line, as the editor does. Default true. */
  showLyrics?: boolean;
  /**
   * The editor's label chip at the bottom of each pane (instrument and
   * difficulty). The editor draws it as a DOM element over the canvas, so
   * this rebuilds it from the editor's own label text and styles. Default false.
   */
  laneLabels?: boolean;
  /**
   * Box size in CSS pixels. Default: the composition size. Keep it constant
   * within a shot and animate with `style.transform`: a size change rebuilds
   * the layout and replays playback.
   */
  width?: number;
  height?: number;
  /**
   * The device pixel ratio the app renders at: 2 like a Retina display (the
   * app's own cap; it turns multisampling off there and renders at twice the
   * resolution instead), 1 like a standard display (multisampled, a quarter
   * of the pixels). Default 2.
   */
  pixelRatio?: 1 | 2;
  /**
   * Where the film serves the app's `public/assets`, relative to its public
   * dir. Default `PRODUCT_ASSETS_PATH` (assetsPath.ts).
   */
  assetsPath?: string;
  /** Outer box style: position, transforms, masks, filters, blend modes. */
  style?: CSSProperties;
  className?: string;
  /** Overlays drawn above the canvas, in the box's coordinates (see highwayGeometry.ts). */
  children?: ReactNode;
  /**
   * Called once per frame, in the same task as the draw, with the app's WebGL
   * canvas and the song second drawn. The canvas keeps no copy of its pixels
   * once the task ends (the app does not preserve its drawing buffer), so a
   * copy made here (`drawImage(canvas, ...)`) is this frame's picture. The
   * canvas is in device pixels: `pixelRatio` times the box size.
   */
  onDraw?: (canvas: HTMLCanvasElement, songSec: number) => void;
}

const DEFAULT_PANES: readonly HighwayPane[] = [{track: EXPERT_DRUMS}];

/**
 * `HighwayLane`'s pane chip (APP/components/chart-editor/highway/HighwayLane.tsx):
 * `bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[var(--ed-surface-hover)]
 * px-2 py-0.5 text-xs font-medium text-white/80 backdrop-blur-sm`, with
 * `--ed-surface-hover` from app/globals.css and Tailwind's default sans stack.
 * The editor draws it as DOM over the canvas, so it is not in the canvas's
 * pixels; place it at the bottom centre of a pane.
 */
const LANE_CHIP_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  whiteSpace: 'nowrap',
  borderRadius: 9999,
  background: 'rgb(255 255 255 / 0.1)',
  padding: '2px 8px',
  fontFamily:
    'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 500,
  color: 'rgb(255 255 255 / 0.8)',
  backdropFilter: 'blur(4px)',
};

export const ProductHighway: React.FC<ProductHighwayProps> = ({
  chart,
  panes = DEFAULT_PANES,
  songTimeSec,
  segments,
  segmentIndex,
  playbackFromSec,
  showLyrics = true,
  laneLabels = false,
  width,
  height,
  pixelRatio = 2,
  assetsPath,
  style,
  className,
  children,
  onDraw,
}) => {
  const video = useVideoConfig();
  const boxWidth = width ?? video.width;
  const boxHeight = height ?? video.height;
  const frame = useGlobalFrame();

  // The stage and each highway are built from the first document, the way the
  // editor builds them once and then streams edits through the reconciler.
  const baseDocRef = useRef<ChartDocument | null>(null);
  baseDocRef.current ??= chart;
  const baseDoc = baseDocRef.current;

  const hostRef = useRef<HTMLDivElement>(null);
  const {hold, release} = useDrawHold();
  const {built, isLive} = useHighwayStage(
    hostRef,
    baseDoc,
    pixelRatio,
    assetsPath,
  );
  const layout = useMemo(
    () => stageLayout({width: boxWidth, height: boxHeight}, panes.length),
    [boxWidth, boxHeight, panes.length],
  );
  const mounted = useHighwayPanes(built, isLive, baseDoc, panes, layout);
  const timedTempos = useMemo(
    () =>
      chart
        ? buildTimedTempos(
            chart.parsedChart.tempos,
            chart.parsedChart.resolution,
          )
        : [],
    [chart],
  );
  const vocalTracks = chart?.parsedChart.vocalTracks;
  const karaoke = useMemo(
    () => karaokeOf(chart, showLyrics),
    // The lines come from the vocal tracks alone.
    [vocalTracks, showLyrics],
  );
  const drawReplayed = useKaraokeReplay();

  // Draw this frame. No dependency list: every render is a new frame.
  useLayoutEffect(() => {
    if (!built || !isLive(built.stage) || !mounted || !chart) {
      hold(
        chart
          ? `Building the highway stage and its panes ${paneKeyOf(panes)}`
          : 'Waiting for the chart document',
      );
      return;
    }
    const {stage, clock} = built;
    try {
      panes.forEach((pane, i) => {
        const on = mounted.panes[i];
        if (!on) throw new Error(`[highway] pane ${i} is not mounted`);
        pushPaneState(on, pane, chart, timedTempos);
      });
      const songSec = drawReplayed(
        {
          setKaraoke: k => stage.setLyricsData(k.lyrics, k.phrases),
          draw: sec => {
            clock.chartTime = sec;
            stage.renderFrame(sec * 1000);
          },
        },
        mounted,
        karaoke,
        {
          frame,
          fps: video.fps,
          songTimeSec,
          segments,
          segmentIndex,
          playbackFromSec,
        },
      );
      const canvas = hostRef.current?.querySelector('canvas');
      if (onDraw && canvas) onDraw(canvas, songSec);
    } catch (error) {
      cancelRender(error);
      return;
    }
    release();
  });

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: boxWidth,
        height: boxHeight,
        overflow: 'hidden',
        ...style,
      }}>
      <div ref={hostRef} style={{position: 'absolute', inset: 0}} />
      {laneLabels
        ? panes.map((pane, i) => {
            const rect = layout.highways[i];
            return rect ? (
              <div
                key={`${pane.track.instrument}-${pane.track.difficulty}`}
                style={{
                  position: 'absolute',
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  overflow: 'hidden',
                }}>
                <div style={LANE_CHIP_STYLE}>{trackLabel(pane.track)}</div>
              </div>
            ) : null;
          })
        : null}
      {children ? (
        <div style={{position: 'absolute', inset: 0}}>{children}</div>
      ) : null}
    </div>
  );
};
