/**
 * On-screen UI pieces: the cursor, callouts, chips, slates, playheads, beat
 * markers and waveforms. Every timing prop is a film frame. See README.md.
 */
export {BeatMarker, type BeatMarkerProps} from './BeatMarker';
export {Callout, Leader, type CalloutProps, type LeaderProps} from './Callout';
export {ChapterSlate, type ChapterSlateProps} from './ChapterSlate';
export {Chip, type ChipProps} from './Chip';
export {ClickRing, type ClickRingProps} from './ClickRing';
export {
  Cursor,
  CURSOR_EASE,
  cursorAt,
  cursorVisibility,
  type CursorKey,
  type CursorProps,
  type CursorScript,
  type CursorWindow,
} from './cursor';
export {Eyebrow, type EyebrowProps} from './Eyebrow';
export {
  PlaneFlash,
  PlaneRing,
  type PlaneFlashProps,
  type PlaneRingProps,
} from './planeMarks';
export {Playhead, type PlayheadProps} from './Playhead';
export {
  chapterSlateTiming,
  EYEBROW_TIMING,
  eyebrowGone,
  eyebrowLabelTiming,
  SLATE_EXITS,
  SLATE_SCRIM_OUT_SEC,
  type EyebrowEnter,
  type EyebrowTiming,
  type SlateExit,
  type SlateTiming,
  type SlateTimingProps,
} from './slateTiming';
export {
  clipPeaks,
  peakMax,
  Waveform,
  waveformBars,
  type WaveBar,
  type WaveformProps,
} from './Waveform';
