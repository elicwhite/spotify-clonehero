/**
 * WebGPU capability probe for the fp16 ONNX models this app runs.
 *
 * An adapter is not sufficient. The two models with fp16 weights —
 * BS-Roformer (`bs_roformer_sw_6stem_fp16.onnx`, a mixed-precision graph)
 * and wav2vec2 — make ONNX Runtime generate WGSL that uses the `f16` type,
 * and `f16` is legal only when the device enables the `shader-f16`
 * extension. ORT asks for that extension only if the adapter has it
 * (`requireFeatureIfAvailable('shader-f16')` in its WebGPU backend), and it
 * does not refuse the model when the adapter does not. The shader then fails
 * to compile with `'f16' type used without 'f16' extension enabled`.
 *
 * In the configuration this app runs, a try/catch around
 * `InferenceSession.create()` does not catch that. `createShaderModule()`
 * and `createComputePipeline()` never throw — WebGPU reports shader and
 * pipeline errors asynchronously, and ORT's handler writes them to the
 * console and continues. ORT does have a mode that turns them into a
 * rejection (`ort.env.debug = true` makes it wrap every kernel in a
 * validation error scope and throw from `run()`), but nothing here sets it,
 * and it would report the fault only after the 336 MB download and a first
 * inference pass. So session creation resolves, `run()` resolves, and the
 * run dispatches invalid pipelines and reads back buffers that nothing
 * wrote.
 *
 * The user therefore sees tens of thousands of console errors, and either a
 * dead tab or a silent (all-zero) stem. The silent stem is the worse half:
 * `lib/audio-pipeline/separate-stems.ts` caches stems by the fingerprint of
 * the mix, and every page reads that cache, so one bad run would poison it
 * for the drum transcription, tempo and chart-editor paths together. The
 * capability must be tested before WebGPU is selected, not after it fails.
 *
 * Adapters that report no `shader-f16` are not rare: Chrome on Windows is
 * reported not to expose it for NVIDIA Pascal cards (GTX 10-series), which
 * have no usable native 16-bit shader math.
 *
 * Models in fp32 or int8 are not affected. Use {@link isWebGPUAdapterAvailable}
 * for those.
 */

/** Why an adapter cannot run an fp16 model on WebGPU, or `'ok'` if it can. */
export type WebGpuFp16Status =
  /** The adapter is present and has `shader-f16`. */
  | 'ok'
  /** The browser has no WebGPU at all (`navigator.gpu` is absent). */
  | 'no-webgpu'
  /** WebGPU is present, but it gave no adapter. */
  | 'no-adapter'
  /** There is an adapter, but it does not have the `shader-f16` feature. */
  | 'no-shader-f16';

function getGpu(): GPU | undefined {
  // Workers get `navigator` too, and both the page and the inference workers
  // call this.
  return typeof navigator === 'undefined' ? undefined : navigator.gpu;
}

/**
 * Tests whether this device can run the fp16 models on WebGPU.
 *
 * The result is not cached: the probe runs a handful of times per session
 * (a page gate, then each worker), and `requestAdapter()` is cheap.
 */
export async function probeWebGpuFp16(): Promise<WebGpuFp16Status> {
  const gpu = getGpu();
  if (!gpu) return 'no-webgpu';
  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    // `requestAdapter()` rejects on some blocklisted drivers instead of
    // giving null. Either way there is no adapter to use.
    return 'no-adapter';
  }
  if (!adapter) return 'no-adapter';
  return adapter.features.has('shader-f16') ? 'ok' : 'no-shader-f16';
}

/** Convenience form of {@link probeWebGpuFp16} for a boolean gate. */
export async function isWebGpuFp16Available(): Promise<boolean> {
  return (await probeWebGpuFp16()) === 'ok';
}

/**
 * Tests only whether a WebGPU adapter exists, for fp32 and int8 models,
 * which do not need `shader-f16`.
 */
export async function isWebGPUAdapterAvailable(): Promise<boolean> {
  const gpu = getGpu();
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

/**
 * The long-form sentence for a device that cannot run an fp16 model.
 *
 * This is the backstop, not the experience. The pages and the editor test the
 * capability before they offer the action, so a user should meet the copy at
 * those surfaces instead. This string is what a worker's own assertion says
 * if it ever fires after a probe has passed.
 *
 * `feature` names the part of the app that stopped, so the message tells the
 * user what they cannot do as well as why.
 */
export function webGpuFp16Message(
  status: Exclude<WebGpuFp16Status, 'ok'>,
  feature: string,
): string {
  switch (status) {
    case 'no-webgpu':
      return `${feature} needs WebGPU, which this browser doesn’t have. Use a recent version of Chrome or Edge on a desktop or laptop.`;
    case 'no-adapter':
      return `${feature} needs WebGPU, but this browser couldn’t reach the graphics card. Check that hardware acceleration is on in the browser’s settings, then reload the page.`;
    case 'no-shader-f16':
      return `${feature} needs a 16-bit shader feature (WebGPU shader-f16) that this computer’s graphics card doesn’t have. It’s the card itself, not a browser setting.`;
  }
}

/**
 * The tooltip on a control this device cannot run.
 *
 * Short enough for a tooltip, and it never names `shader-f16`: the feature
 * name belongs where someone can copy it (see {@link WEBGPU_FEATURE_DETAIL}),
 * not on a control.
 *
 * `subject` is how the sentence refers to the blocked action — `'it'` for a
 * card with one action, `'this one'` where a sibling control still works and
 * the tooltip has to say which is which.
 */
export function webGpuFp16Tooltip(
  status: Exclude<WebGpuFp16Status, 'ok'>,
  subject: 'it' | 'this one' = 'it',
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
 * The visible note on a blocked Chart Assist card.
 *
 * Only the `no-shader-f16` sentence changes between cards — it names what
 * that card needs the graphics card for — so the caller supplies it and the
 * two browser-level cases are shared.
 */
export function webGpuFp16Note(
  status: Exclude<WebGpuFp16Status, 'ok'>,
  shaderF16Note: string,
): string {
  switch (status) {
    case 'no-webgpu':
      return 'Can’t run in this browser: it needs WebGPU. Use a recent Chrome or Edge on a desktop or laptop.';
    case 'no-adapter':
      return 'Can’t reach the graphics card. Check that hardware acceleration is on in the browser’s settings, then reload the page.';
    case 'no-shader-f16':
      return shaderF16Note;
  }
}

/** The one place the feature is named for a user: a detail line they can
 *  copy into a search or a bug report. Prose and controls say "16-bit shader
 *  feature" instead. */
export const WEBGPU_FEATURE_DETAIL = 'Missing WebGPU feature: shader-f16';

/** Which cards have the feature, for the blocked pages. It names only the
 *  case we have evidence for, and makes no claim about AMD, Intel or Apple. */
export const WEBGPU_CARD_GUIDANCE =
  'Older cards are often missing it, NVIDIA’s GTX 10-series among them; newer cards generally have it. The rest of Music Charts Tools works on this computer, including the chart editor and lyric alignment.';

/**
 * Throws {@link webGpuFp16Message} unless this device can run the fp16
 * models on WebGPU.
 *
 * Call this before the model download. The BS-Roformer file is about
 * 336 MB, so a device that cannot run it must find out first, not after a
 * long download.
 */
export async function assertWebGpuFp16(feature: string): Promise<void> {
  const status = await probeWebGpuFp16();
  if (status !== 'ok') {
    throw new Error(webGpuFp16Message(status, feature));
  }
}
