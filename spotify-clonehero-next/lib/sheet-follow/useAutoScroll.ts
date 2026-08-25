/**
 * Wires the microphone, the follow worker and the sheet-music page together.
 *
 * The page asks for one thing from this hook: a `getChartTimeSec` getter it can
 * hand to the playhead, exactly like the one `AudioManager` provides during
 * normal playback. Everything else — permissions, the audio graph, the worker —
 * stays in here.
 */

import {useCallback, useEffect, useRef, useState} from 'react';

import {CHROMA_SAMPLE_RATE} from './chroma';
import type {FollowWorkerRequest, FollowWorkerResponse} from './follow-worker';
import {buildReferenceAudio} from './reference';

export type AutoScrollStatus =
  | 'off'
  | 'preparing'
  | 'listening'
  | 'following'
  | 'error';

export interface AutoScrollState {
  status: AutoScrollStatus;
  /** 0 to 1. Low means the song repeats here and the match could not choose. */
  confidence: number;
  /** How fast the band is playing relative to the recording. */
  speed: number;
  error: string | null;
}

/**
 * Compensates for the delay between sound reaching the microphone and the page
 * moving: about a tenth of a second of block buffering, plus the worker hop.
 * Kept small deliberately — the playhead already centres itself, so the next
 * bar or two is on screen without biasing the estimate further.
 */
const LATENCY_LEAD_SEC = 0.3;

/** Where a song's converged speed is kept between plays. */
const SPEED_MEMORY_KEY = 'sheetMusic.autoScroll.speed.v1';

function readRememberedSpeed(songKey: string): number | undefined {
  if (typeof window === 'undefined' || !songKey) return undefined;
  try {
    const all = JSON.parse(localStorage.getItem(SPEED_MEMORY_KEY) || '{}');
    const speed = all[songKey];
    return typeof speed === 'number' && speed > 0 ? speed : undefined;
  } catch {
    return undefined;
  }
}

function rememberSpeed(songKey: string, speed: number) {
  if (typeof window === 'undefined' || !songKey) return;
  try {
    const all = JSON.parse(localStorage.getItem(SPEED_MEMORY_KEY) || '{}');
    all[songKey] = speed;
    localStorage.setItem(SPEED_MEMORY_KEY, JSON.stringify(all));
  } catch {
    // A full or unavailable localStorage costs a slower cold start next time,
    // nothing more.
  }
}

const OFF_STATE: AutoScrollState = {
  status: 'off',
  confidence: 0,
  speed: 1,
  error: null,
};

export function useAutoScroll({
  enabled,
  audioFiles,
  chartDelaySec,
  songKey,
}: {
  enabled: boolean;
  audioFiles: {fileName: string; data: Uint8Array}[];
  chartDelaySec: number;
  /** Identifies the song, so the speed this band plays it at can be reused
   *  next time. */
  songKey: string;
}): AutoScrollState & {getChartTimeSec: () => number | null} {
  const [state, setState] = useState<AutoScrollState>(OFF_STATE);

  // The position estimate is read every animation frame by the playhead, so it
  // lives in a ref: putting it in state would re-render the whole page at the
  // worker's update rate.
  const anchorRef = useRef<{
    refTimeSec: number;
    receivedAtMs: number;
    speed: number;
  } | null>(null);

  const getChartTimeSec = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor == null) return null;
    const elapsedSec = (performance.now() - anchor.receivedAtMs) / 1000;
    const refTimeSec =
      anchor.refTimeSec + elapsedSec * anchor.speed + LATENCY_LEAD_SEC;
    // The reference is the chart's own audio, so reference time is audio time,
    // and the sheet is drawn in chart time.
    return refTimeSec - chartDelaySec;
  }, [chartDelaySec]);

  useEffect(() => {
    // Switching off is reported by deriving the returned state below rather
    // than by setting it here, so the effect never triggers a cascading render.
    if (!enabled) {
      anchorRef.current = null;
      return;
    }

    let cancelled = false;
    let worker: Worker | null = null;
    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;

    const fail = (message: string) => {
      if (cancelled) return;
      anchorRef.current = null;
      setState({status: 'error', confidence: 0, speed: 1, error: message});
    };

    async function start() {
      setState({status: 'preparing', confidence: 0, speed: 1, error: null});

      // Decoding and mixing the song's stems takes seconds, and asking for the
      // microphone does not depend on it. Starting both together means the
      // permission prompt appears immediately rather than after the decode.
      //
      // Every one of these constraints must be off. Automatic gain control
      // pumps a loud room, and browser noise suppression is tuned to remove
      // exactly the non-speech signal the follower needs. Browsers honour them
      // inconsistently, so this is a request, not a guarantee.
      const referencePromise = buildReferenceAudio(audioFiles);
      const microphonePromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      // Neither rejection may go unhandled while the other is still running.
      referencePromise.catch(() => {});
      microphonePromise.catch(() => {});

      let referencePcm: Float32Array;
      try {
        referencePcm = await referencePromise;
      } catch (err) {
        fail((err as Error).message);
        void microphonePromise.then(s => s.getTracks().forEach(t => t.stop()));
        return;
      }
      if (cancelled) {
        void microphonePromise.then(s => s.getTracks().forEach(t => t.stop()));
        return;
      }

      worker = new Worker(new URL('./follow-worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<FollowWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'error') {
          fail(message.message);
          return;
        }
        if (message.type !== 'position') return;
        if (!message.playing) {
          anchorRef.current = null;
          setState(prev => ({...prev, status: 'listening', confidence: 0}));
          return;
        }
        anchorRef.current = {
          refTimeSec: message.refTimeSec,
          receivedAtMs: performance.now(),
          speed: message.speed,
        };
        // Only a confident lock is worth remembering; a speed learned while the
        // follower was guessing would poison the next play's cold start.
        if (message.phase === 'tracking' && message.confidence >= 0.5) {
          rememberSpeed(songKey, message.speed);
        }
        setState({
          status: 'following',
          confidence: message.confidence,
          speed: message.speed,
          error: null,
        });
      };
      const send = (message: FollowWorkerRequest, transfer?: Transferable[]) =>
        worker?.postMessage(message, transfer ?? []);
      send(
        {
          type: 'reference',
          pcm: referencePcm,
          rememberedSpeed: readRememberedSpeed(songKey),
        },
        [referencePcm.buffer],
      );

      try {
        stream = await microphonePromise;
      } catch (err) {
        const name = (err as DOMException)?.name;
        fail(
          name === 'NotAllowedError'
            ? 'Microphone access was refused. Allow it in the browser’s site settings to follow along.'
            : 'No microphone is available.',
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      try {
        // Asking the context for the chroma rate lets the browser resample, so
        // the worker never has to.
        context = new AudioContext({sampleRate: CHROMA_SAMPLE_RATE});
        await context.audioWorklet.addModule('/mic-capture-worklet.js');
      } catch (err) {
        fail(`Could not start audio capture: ${(err as Error).message}`);
        return;
      }
      if (cancelled) return;

      const source = context.createMediaStreamSource(stream);
      const capture = new AudioWorkletNode(context, 'mic-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const pcm = event.data;
        send({type: 'audio', pcm}, [pcm.buffer]);
      };
      source.connect(capture);
      // Autoplay policy can leave a fresh context suspended even for capture.
      if (context.state === 'suspended') await context.resume();

      if (!cancelled) {
        setState(prev => ({...prev, status: 'listening'}));
      }
    }

    void start();

    return () => {
      cancelled = true;
      anchorRef.current = null;
      worker?.terminate();
      stream?.getTracks().forEach(track => track.stop());
      void context?.close();
    };
  }, [enabled, audioFiles, songKey]);

  return {...(enabled ? state : OFF_STATE), getChartTimeSec};
}
