/**
 * Pulses on the music's drum hits.
 */
import {useVideoConfig} from 'remotion';
import {timing} from '../brand/tokens';
import type {TimelineApi} from '../music/api';
import type {HitKind} from '../music/contract';
import {useOptionalTimeline} from '../music/timeline';
import {useGlobalFrame} from './clock';
import {pulseAt} from './events';

const hitFramesOf = (tl: TimelineApi | null, kind: HitKind): number[] => {
  if (!tl) {
    throw new Error(
      `[clock] useHitPulse('${kind}') needs a <TimelineProvider> above it`,
    );
  }
  return tl.hitFrames[kind];
};

/**
 * 0..1 pulse on drum hits: 1 on each hit, decaying over `decaySec` (default
 * the `kickDecay` token). `useHitPulse('kick')` is the kick accent envelope;
 * multiply it by the accent size. A hit kind reads the timeline's
 * `hitFrames` (it needs a <TimelineProvider>); pass a sorted frame list for
 * any other events (`useHitPulse(tl.drumFrames({accent: true}), 0.2)`).
 */
export const useHitPulse = (
  kind: HitKind | readonly number[],
  decaySec: number = timing.kickDecay,
  power = 2,
): number => {
  const frame = useGlobalFrame();
  const {fps} = useVideoConfig();
  const tl = useOptionalTimeline();
  const frames = typeof kind === 'string' ? hitFramesOf(tl, kind) : kind;
  return pulseAt(frames, frame, decaySec * fps, power);
};
