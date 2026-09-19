'use client';

/**
 * The notice a tool's landing page shows in place of its entry controls when
 * this computer cannot run the tool's models.
 *
 * It goes in the landing page's `toolEntry` slot rather than replacing the
 * page. A blocked visitor is the reader who most needs to know what the tool
 * does — it is how they decide whether it is worth finding another computer —
 * and the notice belongs exactly where the action they cannot take would be.
 *
 * Nothing here is styled as an error. A requirement that is not met is not a
 * failure: no warning icon, no destructive tint, and no instruction to buy a
 * graphics card. The feature name appears once, as a detail line someone can
 * copy into a search or a bug report, and never in the prose above it.
 */

import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {
  WEBGPU_CARD_GUIDANCE,
  WEBGPU_FEATURE_DETAIL,
  type WebGpuFp16Status,
} from '@/lib/onnx/webgpu-capability';

/** A browser feature this tool needs and this browser does not have. */
export interface MissingBrowserCapability {
  name: string;
  reason: string;
}

export interface WebGpuRequirementNoticeProps {
  /** Why the graphics card cannot run the models, or null when it can. */
  status: Exclude<WebGpuFp16Status, 'ok'> | null;
  /** The tool's name, as a sentence subject — "Drum transcription". */
  feature: string;
  /**
   * What the tool needs the graphics card for, for the `no-shader-f16` case.
   * Each tool words this differently: transcription separates the drums as
   * its first step, tempo mapping separates them to find the beat.
   */
  shaderF16Description: string;
  /** Browser features this tool also needs and this browser lacks. */
  otherMissing?: readonly MissingBrowserCapability[] | undefined;
}

export default function WebGpuRequirementNotice({
  status,
  feature,
  shaderF16Description,
  otherMissing = [],
}: WebGpuRequirementNoticeProps) {
  // A graphics card that cannot run one model is a single fact, best said in
  // prose. Anything else is a browser that is missing features, which is a
  // list — and once the browser is short of something, that is what the
  // reader has to fix first, so the list form covers the card too.
  const cardOnly = status === 'no-shader-f16' && otherMissing.length === 0;
  const adapterOnly = status === 'no-adapter' && otherMissing.length === 0;

  if (cardOnly) {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{feature} can’t run on this computer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{shaderF16Description}</p>
          <p>{WEBGPU_CARD_GUIDANCE}</p>
          <p className="text-xs">{WEBGPU_FEATURE_DETAIL}</p>
        </CardContent>
      </Card>
    );
  }

  if (adapterOnly) {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{feature} can’t reach the graphics card</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Check that hardware acceleration is on in the browser’s settings,
            then reload the page.
          </p>
        </CardContent>
      </Card>
    );
  }

  const missing: MissingBrowserCapability[] = [
    ...(status === 'no-webgpu'
      ? [
          {
            name: 'WebGPU',
            reason: 'runs the models on the graphics card',
          },
        ]
      : []),
    ...(status === 'no-shader-f16'
      ? [
          {
            name: '16-bit shaders',
            reason: 'lets the graphics card run the separation model',
          },
        ]
      : []),
    ...otherMissing,
  ];

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>This browser can’t run {feature.toLowerCase()}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>{feature} needs features this browser doesn’t have.</p>
        <ul className="space-y-1">
          {missing.map(cap => (
            <li key={cap.name}>
              <span className="font-medium text-foreground">{cap.name}</span> —{' '}
              {cap.reason}.
            </li>
          ))}
        </ul>
        <p>Use a recent version of Chrome or Edge on a desktop or laptop.</p>
        {status === 'no-shader-f16' && (
          <p className="text-xs">{WEBGPU_FEATURE_DETAIL}</p>
        )}
      </CardContent>
    </Card>
  );
}
