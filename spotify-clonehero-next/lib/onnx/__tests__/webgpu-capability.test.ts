/**
 * The probe that decides whether WebGPU can run this app's fp16 models.
 *
 * The case that matters is `no-shader-f16`: an adapter exists, so every
 * check this app had before said "WebGPU works", but the fp16 shaders do not
 * compile on it. See lib/onnx/webgpu-capability.ts.
 */

import {
  assertWebGpuFp16,
  isWebGpuFp16Available,
  probeWebGpuFp16,
  webGpuFp16Message,
} from '../webgpu-capability';
import {
  blockedControlReason,
  sharedBlockedNote,
} from '@/components/onnx/webgpu-block';

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

describe('assertWebGpuFp16', () => {
  it('does not throw when the adapter has shader-f16', async () => {
    setGpu(adapterWith('shader-f16'));
    await expect(assertWebGpuFp16('Stem separation')).resolves.toBeUndefined();
  });

  it('throws a message that names the feature and what it needs', async () => {
    setGpu(adapterWith());
    await expect(assertWebGpuFp16('Stem separation')).rejects.toThrow(
      /Stem separation needs a 16-bit shader feature \(WebGPU shader-f16\)/,
    );
  });
});

describe('copy', () => {
  it('blames the card, not the browser, for a missing shader-f16', () => {
    // Sending this user to update their browser wastes their time: the
    // browser is fine and there is no setting behind it.
    const message = webGpuFp16Message('no-shader-f16', 'Tempo mapping');
    expect(message).toMatch(/graphics card/);
    expect(message).toMatch(/not a browser setting/);
    expect(message).not.toMatch(/Chrome|Edge|update/);
  });

  it('blames the browser when the browser is the problem', () => {
    expect(webGpuFp16Message('no-webgpu', 'Tempo mapping')).toMatch(
      /this browser/,
    );
  });

  it('keeps the feature name off controls', () => {
    // `shader-f16` belongs where it can be copied, not in a tooltip.
    for (const status of [
      'no-webgpu',
      'no-adapter',
      'no-shader-f16',
    ] as const) {
      expect(blockedControlReason(status)).not.toMatch(/shader-f16/);
    }
  });

  it('names which control is blocked when a sibling still works', () => {
    // The stems mixer keeps a working Demucs button beside the blocked one.
    expect(
      blockedControlReason('no-shader-f16', undefined, 'this one'),
    ).toMatch(/can’t run this one/);
    expect(blockedControlReason('no-shader-f16')).toMatch(/can’t run it/);
  });

  it('never tells the user to buy a graphics card', () => {
    const all = [
      webGpuFp16Message('no-shader-f16', 'Tempo mapping'),
      blockedControlReason('no-shader-f16'),
      sharedBlockedNote('no-webgpu'),
    ];
    for (const copy of all) {
      expect(copy).not.toMatch(/buy|purchase|upgrade|newer graphics card/i);
    }
  });
});

describe('blockedControlReason', () => {
  it('lets a control run when nothing blocks it', () => {
    expect(blockedControlReason(null)).toBeUndefined();
  });

  it('passes the host’s own reason through when the device is fine', () => {
    expect(blockedControlReason(null, 'Rebuilding audio')).toBe(
      'Rebuilding audio',
    );
  });

  it('puts the capability ahead of a reason that will clear', () => {
    // Waiting clears an audio rebuild but never a graphics card, so a
    // control that will not work after the wait must not ask the user to
    // wait. Both cards and the stems mixer read this one rule.
    expect(blockedControlReason('no-shader-f16', 'Rebuilding audio')).toMatch(
      /graphics card/,
    );
  });
});

describe('sharedBlockedNote', () => {
  it('shares one sentence for the browser-level cases', () => {
    expect(sharedBlockedNote('no-webgpu')).toMatch(/needs WebGPU/);
    expect(sharedBlockedNote('no-adapter')).toMatch(/hardware acceleration/);
  });

  it('gives no sentence for a missing card feature, so the card writes it', () => {
    // What a card needs the graphics card FOR differs per card, so there is
    // nothing shared to say.
    expect(sharedBlockedNote('no-shader-f16')).toBeNull();
  });
});
