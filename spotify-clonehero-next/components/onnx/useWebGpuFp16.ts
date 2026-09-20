'use client';

/**
 * The fp16-on-WebGPU capability, as a React hook.
 *
 * `null` while the probe is in flight, so a caller can hold a control in its
 * normal state for the one frame it takes rather than flashing a disabled
 * one. The probe is async (`requestAdapter()` is a promise), which is why
 * this is state plus an effect and not a `useSyncExternalStore` snapshot.
 *
 * Run it ONCE per surface and pass the status down. The chart editor has
 * four controls that consult it — two Chart Assist cards, the Stems mixer
 * and the waveform menu — and four probes would ask the same unchanging
 * question four times.
 *
 * See `lib/onnx/webgpu-capability.ts` for what the statuses mean.
 */

import {useEffect, useState} from 'react';

import {
  probeWebGpuFp16,
  type WebGpuFp16Status,
} from '@/lib/onnx/webgpu-capability';
import type {WebGpuBlock} from './webgpu-block';

export function useWebGpuFp16(): WebGpuFp16Status | null {
  const [status, setStatus] = useState<WebGpuFp16Status | null>(null);
  useEffect(() => {
    let live = true;
    probeWebGpuFp16().then(result => {
      if (live) setStatus(result);
    });
    return () => {
      live = false;
    };
  }, []);
  return status;
}

/** The status as a blocking surface wants it: the reason to block, or null
 *  while the probe runs and when the device can run the models. Both mean
 *  "do not block yet", which is what keeps a control from flashing disabled
 *  for the frame before the probe answers. */
export function useWebGpuFp16Block(): WebGpuBlock {
  const status = useWebGpuFp16();
  return status === null || status === 'ok' ? null : status;
}
