/**
 * How a control says it cannot run the models on this computer.
 *
 * The capability itself is `lib/onnx/webgpu-capability.ts`. This is the one
 * place that decides what a blocked control tells the user, so the Chart
 * Assist cards, the Stems mixer and the waveform menu cannot answer the same
 * question differently.
 */

import type {WebGpuFp16Status} from '@/lib/onnx/webgpu-capability';

/** A device that cannot run the fp16 models, or null when it can (and while
 *  the probe is still in flight). */
export type WebGpuBlock = Exclude<WebGpuFp16Status, 'ok'> | null;

/**
 * How the sentence refers to the control it is attached to. A card with one
 * action says "it"; a control with a working sibling says "this one", so the
 * user can tell which of the two the message is about.
 */
type Subject = 'it' | 'this one';

function tooltip(
  status: Exclude<WebGpuFp16Status, 'ok'>,
  subject: Subject,
): string {
  switch (status) {
    case 'no-webgpu':
      return 'This browser doesn’t have WebGPU.';
    case 'no-adapter':
      return 'Can’t reach the graphics card. Check hardware acceleration and reload.';
    case 'no-shader-f16':
      return `This computer’s graphics card can’t run ${subject}.`;
  }
}

/**
 * Why a control is disabled, or undefined when it can run.
 *
 * `hostReason` is the caller's own transient reason (an audio rebuild in
 * flight, ...). A capability limit outranks it: waiting will clear a rebuild
 * but never a graphics card, so a control that will not work after the wait
 * must not tell the user to wait.
 */
export function blockedControlReason(
  blocked: WebGpuBlock,
  hostReason?: string | undefined,
  subject: Subject = 'it',
): string | undefined {
  if (blocked !== null) return tooltip(blocked, subject);
  return hostReason;
}

/**
 * The visible note for a blocked card, or null when the card has to word it
 * itself.
 *
 * A browser-level limit reads the same on every card, so it is shared and no
 * card can drift from its neighbour. What a card needs the graphics card FOR
 * differs — transcription separates the drums as its first step, tempo
 * mapping separates them to find the beat — so `no-shader-f16` gets null and
 * the card supplies its own sentence.
 */
export function sharedBlockedNote(
  status: Exclude<WebGpuFp16Status, 'ok'>,
): string | null {
  switch (status) {
    case 'no-webgpu':
      return 'Can’t run in this browser: it needs WebGPU. Use a recent Chrome or Edge on a desktop or laptop.';
    case 'no-adapter':
      return 'Can’t reach the graphics card. Check that hardware acceleration is on in the browser’s settings, then reload the page.';
    case 'no-shader-f16':
      return null;
  }
}
