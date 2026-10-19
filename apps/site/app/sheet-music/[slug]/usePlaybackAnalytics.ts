import {useEffect, useRef} from 'react';
import {track} from '@/lib/analytics/track';
import type {AudioManager} from '@/lib/preview/audioManager';

/** Segments shorter than a second are a stray click, not playback. */
const MIN_SESSION_SEC = 1;

/** Part of a segment played on one AudioManager. */
type Span = {manager: AudioManager; startSec: number};

type Segment = {
  /** Seconds of spans that have closed. */
  bankedSec: number;
  /** The span that is playing now, if any. */
  open: Span | null;
};

/** Returns the seconds of the segment so far and starts it again from zero. */
function takeSeconds(segment: Segment): number {
  let seconds = segment.bankedSec;
  segment.bankedSec = 0;
  const span = segment.open;
  if (span != null) {
    const now = span.manager.renderedSeconds;
    seconds += Math.max(0, now - span.startSec);
    span.startSec = now;
  }
  return seconds;
}

function reportSession(segment: Segment): void {
  const seconds = takeSeconds(segment);
  if (seconds < MIN_SESSION_SEC) return;
  track({
    event: 'sheet_music_playback_session',
    playSeconds: Math.round(seconds),
  });
}

/**
 * Sends the sheet-music `play`, `pause` and `playback_session` events.
 *
 * A session is one play-to-pause segment. A segment also ends at `pagehide`
 * and at unmount while it plays. `playSeconds` comes from
 * `AudioManager.renderedSeconds`, not from the wall clock. The wall clock
 * continues while a laptop sleeps or the browser freezes the tab with the page
 * in its playing state, and one such segment can report days.
 *
 * One segment can span several managers. The page replaces its AudioManager
 * during playback (difficulty or click-voice change), and each new
 * AudioContext starts its clock at zero. When `audioManager` changes, the span
 * effect cleanup keeps the time of the old manager and the next run starts a
 * span on the new one.
 */
export function usePlaybackAnalytics(
  audioManager: AudioManager | null,
  isPlaying: boolean,
): void {
  const segmentRef = useRef<Segment>({bankedSec: 0, open: null});

  useEffect(() => {
    if (!isPlaying || audioManager == null) return;
    const segment = segmentRef.current;
    const span: Span = {
      manager: audioManager,
      startSec: audioManager.renderedSeconds,
    };
    segment.open = span;
    return () => {
      segment.bankedSec += Math.max(
        0,
        audioManager.renderedSeconds - span.startSec,
      );
      if (segment.open === span) segment.open = null;
    };
  }, [audioManager, isPlaying]);

  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (isPlaying) {
      wasPlayingRef.current = true;
      track({event: 'sheet_music_play'});
      return;
    }
    if (!wasPlayingRef.current) return;
    wasPlayingRef.current = false;
    track({event: 'sheet_music_pause'});
    reportSession(segmentRef.current);
  }, [isPlaying]);

  useEffect(() => {
    const segment = segmentRef.current;
    const flush = () => reportSession(segment);
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
    };
  }, []);
}
