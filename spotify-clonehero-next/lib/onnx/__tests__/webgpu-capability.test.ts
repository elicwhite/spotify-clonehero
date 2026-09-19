/**
 * The probe that decides whether WebGPU can run this app's fp16 models.
 *
 * The case that matters is `no-shader-f16`: an adapter exists, so every
 * check this app had before said "WebGPU works", but the fp16 shaders do not
 * compile on it. See lib/onnx/webgpu-capability.ts.
 */

import {
  assertWebGpuFp16,
  isWebGPUAdapterAvailable,
  isWebGpuFp16Available,
  probeWebGpuFp16,
  webGpuFp16Message,
} from '../webgpu-capability';

type FakeAdapter = {features: ReadonlySet<string>};

/** Replaces `navigator.gpu` for one test. */
function setGpu(
  gpu: {requestAdapter: () => Promise<FakeAdapter | null>} | undefined,
) {
  Object.defineProperty(navigator, 'gpu', {value: gpu, configurable: true});
}

function adapterWith(...features: string[]) {
  return {
    requestAdapter: async () => ({features: new Set(features)}),
  };
}

afterEach(() => {
  setGpu(undefined);
});

describe('probeWebGpuFp16', () => {
  it('reports ok when the adapter has shader-f16', async () => {
    setGpu(adapterWith('shader-f16', 'subgroups'));
    expect(await probeWebGpuFp16()).toBe('ok');
    expect(await isWebGpuFp16Available()).toBe(true);
  });

  it('reports no-shader-f16 when an adapter exists without the feature', async () => {
    // A GTX 1080 Ti on Chrome/Windows: a real adapter, no 16-bit shaders.
    setGpu(adapterWith('timestamp-query'));
    expect(await probeWebGpuFp16()).toBe('no-shader-f16');
    expect(await isWebGpuFp16Available()).toBe(false);
  });

  it('reports no-webgpu when the browser has no navigator.gpu', async () => {
    setGpu(undefined);
    expect(await probeWebGpuFp16()).toBe('no-webgpu');
  });

  it('reports no-adapter when requestAdapter gives null', async () => {
    setGpu({requestAdapter: async () => null});
    expect(await probeWebGpuFp16()).toBe('no-adapter');
  });

  it('reports no-adapter when requestAdapter rejects', async () => {
    setGpu({
      requestAdapter: async () => {
        throw new Error('blocklisted driver');
      },
    });
    expect(await probeWebGpuFp16()).toBe('no-adapter');
  });
});

describe('isWebGPUAdapterAvailable', () => {
  it('accepts an adapter without shader-f16, for the fp32 and int8 models', async () => {
    setGpu(adapterWith());
    expect(await isWebGPUAdapterAvailable()).toBe(true);
  });

  it('rejects a browser with no WebGPU', async () => {
    setGpu(undefined);
    expect(await isWebGPUAdapterAvailable()).toBe(false);
  });
});

describe('assertWebGpuFp16', () => {
  it('does not throw when the adapter has shader-f16', async () => {
    setGpu(adapterWith('shader-f16'));
    await expect(assertWebGpuFp16('Stem separation')).resolves.toBeUndefined();
  });

  it('throws a message that names the feature and the missing extension', async () => {
    setGpu(adapterWith());
    await expect(assertWebGpuFp16('Stem separation')).rejects.toThrow(
      /Stem separation needs the WebGPU shader-f16 feature/,
    );
  });

  it('separates the no-WebGPU case from the no-shader-f16 case', async () => {
    // The two need different advice: one is the browser, one is the card.
    expect(webGpuFp16Message('no-webgpu', 'Tempo mapping')).toMatch(/browser/);
    expect(webGpuFp16Message('no-shader-f16', 'Tempo mapping')).toMatch(
      /graphics card/,
    );
  });
});
