/**
 * Worker for the sheet-music auto-scroll follower.
 *
 * Owns everything expensive: the reference chromagram, the live chroma stream,
 * and the position search. The main thread only forwards microphone blocks and
 * receives positions, so a match running long can never stall the VexFlow
 * render.
 *
 * It also decides when a song starts and stops, from the level of the incoming
 * audio. That decision needs an absolute floor and not just an adaptive one:
 * with a purely relative threshold a quiet room full of people setting up
 * reports several onsets a second and the follower starts chasing a song nobody
 * is playing.
 */

import {CHROMA_SAMPLE_RATE, ChromaStream, chromagram} from './chroma';
import {ScoreFollower} from './follower';
import {PlayingGate} from './playing-gate';

/** Seconds of new audio between position searches. */
const UPDATE_INTERVAL_SEC = 0.5;
/**
 * How much microphone audio to keep for saving, in seconds.
 *
 * Development-only, and the reason it exists: every threshold in this feature
 * was measured on audio recorded with ffmpeg, while the browser captures the
 * same room about 14 dB hotter and more clipped. The gate's decisive ratio is
 * claimed to be gain-invariant, which is a prediction. Saving exactly the PCM
 * the follower saw is the only way to replay the real capture path through the
 * offline harness and check it. Ten minutes covers a song plus the run-up.
 */
const RECORDING_KEEP_SEC = 600;

export type FollowWorkerRequest =
  | {type: 'reference'; pcm: Float32Array; rememberedSpeed?: number | undefined}
  | {type: 'audio'; pcm: Float32Array}
  | {type: 'save-recording'}
  | {type: 'reset'};

export type FollowWorkerResponse =
  | {type: 'ready'; durationSec: number}
  | {
      type: 'recording';
      pcm: Float32Array;
      sampleRate: number;
      /** Wall-clock seconds the worker was actually receiving audio, against
       *  the sample count it received. If these disagree, the capture dropped
       *  or duplicated audio and every timing measured from the file is wrong —
       *  which is exactly the ambiguity two disagreeing recordings of one
       *  performance leave behind. */
      wallClockSec: number;
    }
  | {type: 'error'; message: string}
  | {
      type: 'position';
      phase: 'idle' | 'bootstrapping' | 'tracking';
      /** Position in the reference recording, seconds. */
      refTimeSec: number;
      /** Worker stream time the estimate belongs to, seconds. */
      atStreamSec: number;
      speed: number;
      confidence: number;
      playing: boolean;
    };

let follower: ScoreFollower | null = null;
const stream = new ChromaStream();
const gate = new PlayingGate(CHROMA_SAMPLE_RATE);

/** Rolling buffer of the microphone audio the follower actually received. */
let recording: Float32Array[] = [];
let recordedSamples = 0;

/** Wall clock at the first audio block, for the timebase check above. */
let firstBlockAtMs: number | null = null;

let streamSamples = 0;
/** Stream position where the current chroma stream started, so frame indices
 *  reported by ChromaStream can be turned back into absolute stream time. */
let captureStartSamples = 0;
let sinceUpdateSec = 0;

function post(message: FollowWorkerResponse) {
  (self as unknown as Worker).postMessage(message);
}

function handleReference(pcm: Float32Array, rememberedSpeed?: number) {
  const {frames, frameCount} = chromagram(pcm);
  follower = new ScoreFollower(
    frames,
    frameCount,
    rememberedSpeed ? {rememberedSpeed} : {},
  );
  post({type: 'ready', durationSec: pcm.length / CHROMA_SAMPLE_RATE});
}

function remember(pcm: Float32Array) {
  recording.push(pcm.slice());
  recordedSamples += pcm.length;
  const keep = RECORDING_KEEP_SEC * CHROMA_SAMPLE_RATE;
  while (recordedSamples - recording[0].length > keep) {
    recordedSamples -= recording.shift()!.length;
  }
}

function handleAudio(pcm: Float32Array) {
  if (!follower) return;
  firstBlockAtMs ??= Date.now();
  remember(pcm);

  const blockSec = pcm.length / CHROMA_SAMPLE_RATE;
  streamSamples += pcm.length;
  const streamSec = streamSamples / CHROMA_SAMPLE_RATE;

  const event = gate.push(pcm);

  if (event.startedSecondsAgo != null) {
    stream.reset();
    captureStartSamples = streamSamples - pcm.length;
    follower.beginSong(streamSec - event.startedSecondsAgo);
  } else if (event.justStopped) {
    follower.reset();
    stream.reset();
    post({
      type: 'position',
      phase: 'idle',
      refTimeSec: 0,
      atStreamSec: streamSec,
      speed: 1,
      confidence: 0,
      playing: false,
    });
    return;
  }

  if (!gate.playing) return;

  for (const frame of stream.push(pcm)) {
    follower.pushFrame(
      frame.chroma,
      (captureStartSamples + frame.endSampleIndex) / CHROMA_SAMPLE_RATE,
    );
  }

  sinceUpdateSec += blockSec;
  if (sinceUpdateSec < UPDATE_INTERVAL_SEC) return;
  sinceUpdateSec = 0;

  // A partial window returns no match yet. Report the coasted estimate anyway,
  // so the page still moves while the first window fills.
  try {
    follower.update();
  } catch (err) {
    post({type: 'error', message: (err as Error).message});
    return;
  }

  const snapshot = follower.snapshot(streamSec);
  post({
    type: 'position',
    phase: snapshot.phase,
    refTimeSec: snapshot.refTimeSec,
    atStreamSec: snapshot.atStreamSec,
    speed: snapshot.speed,
    confidence: snapshot.confidence,
    playing: true,
  });
}

self.onmessage = (event: MessageEvent<FollowWorkerRequest>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'reference':
        handleReference(message.pcm, message.rememberedSpeed);
        break;
      case 'audio':
        handleAudio(message.pcm);
        break;
      case 'save-recording': {
        const pcm = new Float32Array(recordedSamples);
        let at = 0;
        for (const chunk of recording) {
          pcm.set(chunk, at);
          at += chunk.length;
        }
        (self as unknown as Worker).postMessage(
          {
            type: 'recording',
            pcm,
            sampleRate: CHROMA_SAMPLE_RATE,
            wallClockSec:
              firstBlockAtMs === null
                ? 0
                : (Date.now() - firstBlockAtMs) / 1000,
          },
          [pcm.buffer],
        );
        break;
      }
      case 'reset':
        follower?.reset();
        stream.reset();
        gate.reset();
        recording = [];
        recordedSamples = 0;
        firstBlockAtMs = null;
        break;
    }
  } catch (err) {
    post({type: 'error', message: (err as Error).message});
  }
};
