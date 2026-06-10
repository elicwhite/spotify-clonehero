/**
 * WASM libsoxr resampler.
 *
 * Web Audio's built-in resampler is too lossy for Beat This! (its 48k→22.05k
 * path costs ~5% of the dynamic range and compounds through six transformer
 * layers into ~1 logit unit of drift). libsoxr matches Python soxr to ~3e-8
 * mean abs error.
 *
 * Loads `wasm-audio-resampler@2.0.0` from unpkg at runtime. The package is
 * shipped as CommonJS, so we shim a `module/exports/require` triple around
 * each file and stitch them into ES modules via Blob URLs. Works on the main
 * thread and inside module workers (both support dynamic import of blob URLs).
 */

const UNPKG_BASE = 'https://unpkg.com/wasm-audio-resampler@2.0.0/app/';

interface SoxrModules {
  SoxrResampler: any;
  SoxrWasmFactory: any;
  utils: any;
}

let modulesPromise: Promise<SoxrModules> | null = null;

function loadSoxrModules(): Promise<SoxrModules> {
  if (modulesPromise) return modulesPromise;
  modulesPromise = (async () => {
    const [utilsText, wasmText, resamplerText] = await Promise.all([
      fetch(UNPKG_BASE + 'utils.js').then(r => r.text()),
      fetch(UNPKG_BASE + 'soxr_wasm.js').then(r => r.text()),
      fetch(UNPKG_BASE + 'soxr_resampler.js').then(r => r.text()),
    ]);

    // Turn a CJS file (uses module/exports/require) into an ESM module we can
    // `import`. `requireFn` maps relative-path requires to already-loaded
    // modules; it's exposed via globalThis because Blob URL imports load in
    // their own scope.
    function cjsToEsm(
      cjsText: string,
      requireFn: (id: string) => unknown,
    ): Promise<any> {
      const handlerId = `__cjs_require_${Math.random().toString(36).slice(2)}`;
      (globalThis as any)[handlerId] = requireFn;
      const wrapped = `
const module = {exports: {}};
const exports = module.exports;
const require = globalThis['${handlerId}'];
${cjsText}
export default module.exports.default || module.exports;
export const __cjsExports = module.exports;
`;
      const blob = new Blob([wrapped], {type: 'application/javascript'});
      const url = URL.createObjectURL(blob);
      // webpackIgnore: the blob URL only exists at runtime.
      return import(/* webpackIgnore: true */ url).then(mod => {
        URL.revokeObjectURL(url);
        delete (globalThis as any)[handlerId];
        return mod;
      });
    }

    const utilsMod = await cjsToEsm(utilsText, () => {
      throw new Error('soxr utils.js should have no requires');
    });
    const utils = utilsMod.__cjsExports;

    // soxr_wasm has Node-only require("path")/require("fs") calls guarded by
    // `process.versions.node`; in the browser those branches don't fire.
    const wasmMod = await cjsToEsm(wasmText, id => {
      throw new Error(`soxr_wasm: unexpected require(${id})`);
    });
    const SoxrWasmFactory = wasmMod.default;

    const resamplerMod = await cjsToEsm(resamplerText, id => {
      if (id === './utils') return utils;
      if (id === './soxr_wasm')
        return {default: SoxrWasmFactory, __esModule: true};
      throw new Error(`soxr_resampler: unexpected require(${id})`);
    });
    const SoxrResampler = resamplerMod.default;

    return {SoxrResampler, SoxrWasmFactory, utils};
  })();
  return modulesPromise;
}

/** Pre-warm the WASM load outside the hot path. Optional. */
export async function initSoxr(): Promise<void> {
  await loadSoxrModules();
}

/**
 * Resample a mono Float32 PCM signal from `inRate` → `outRate` Hz using
 * soxr's SOXR_HQ recipe (matches python `soxr.resample` default).
 *
 * A fresh SoxrResampler instance is created per call — caching them across
 * calls breaks because the library's flush (`processChunk(null)`) leaves the
 * WASM state in end-of-stream mode, which silently produces zero samples on
 * the next call. The WASM module itself is cached, so per-call allocation is
 * cheap.
 */
export async function resampleSoxr(
  signal: Float32Array,
  inRate: number,
  outRate: number,
): Promise<Float32Array> {
  if (inRate === outRate) return signal.slice();
  const {SoxrResampler, SoxrWasmFactory, utils} = await loadSoxrModules();
  const resampler = new SoxrResampler(
    1,
    inRate,
    outRate,
    utils.SoxrDatatype.SOXR_FLOAT32,
    utils.SoxrDatatype.SOXR_FLOAT32,
    utils.SoxrQuality.SOXR_HQ,
  );
  await resampler.init(SoxrWasmFactory, {
    locateFile: (path: string) =>
      path.endsWith('.wasm') ? UNPKG_BASE + 'soxr_wasm.wasm' : path,
  });

  const inBytes = new Uint8Array(
    signal.buffer,
    signal.byteOffset,
    signal.byteLength,
  );
  const outBytes = resampler.processChunk(inBytes);
  const flushBytes = resampler.processChunk(null);

  const total = outBytes.length + (flushBytes ? flushBytes.length : 0);
  const owned = new ArrayBuffer(total);
  const u8 = new Uint8Array(owned);
  u8.set(outBytes, 0);
  if (flushBytes) u8.set(flushBytes, outBytes.length);
  return new Float32Array(owned);
}
