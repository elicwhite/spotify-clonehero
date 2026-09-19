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
  webGpuFp16Message,
  type WebGpuFp16Status,
} from '@/lib/onnx/webgpu-capability';

/** A browser feature this tool needs and this browser does not have. */
export interface MissingBrowserCapability {
  name: string;
  reason: string;
}

/** Which cards have the feature. It names only the case we have evidence
 *  for, and makes no claim about AMD, Intel or Apple. */
const CARD_GUIDANCE =
  'Older cards are often missing it, NVIDIA’s GTX 10-series among them; newer cards generally have it. The rest of Music Charts Tools works on this computer, including the chart editor and lyric alignment.';

/** The one place the feature is named for a user: a line they can copy into
 *  a search or a bug report. The prose above it says "16-bit shader feature"
 *  instead. */
const FEATURE_DETAIL = 'Missing WebGPU feature: shader-f16';

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

interface NoticeContent {
  title: string;
  /** Prose above the list. */
  body: string[];
  bullets: MissingBrowserCapability[];
  /** The closing line, below the list. */
  footer?: string;
  /** Whether to print the copyable feature name. Only a missing graphics-card
   *  feature has one to print. */
  detail: boolean;
}

/**
 * What the notice says, as data.
 *
 * A graphics card that cannot run one model is a single fact, best said in
 * prose. Anything else is a browser that is missing features, which is a
 * list — and once the browser is short of something, that is what the reader
 * has to fix first, so the list form covers the card too.
 */
function noticeContent(
  status: Exclude<WebGpuFp16Status, 'ok'> | null,
  feature: string,
  shaderF16Description: string,
  otherMissing: readonly MissingBrowserCapability[],
): NoticeContent {
  if (otherMissing.length === 0 && status === 'no-shader-f16') {
    return {
      title: `${feature} can’t run on this computer`,
      body: [shaderF16Description, CARD_GUIDANCE],
      bullets: [],
      detail: true,
    };
  }
  if (otherMissing.length === 0 && status === 'no-adapter') {
    return {
      title: `${feature} can’t reach the graphics card`,
      body: [webGpuFp16Message(status, feature)],
      bullets: [],
      detail: false,
    };
  }
  return {
    title: `This browser can’t run ${feature.toLowerCase()}`,
    body: [`${feature} needs features this browser doesn’t have.`],
    footer: 'Use a recent version of Chrome or Edge on a desktop or laptop.',
    bullets: [
      ...(status === 'no-webgpu'
        ? [{name: 'WebGPU', reason: 'runs the models on the graphics card'}]
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
    ],
    detail: status === 'no-shader-f16',
  };
}

export default function WebGpuRequirementNotice({
  status,
  feature,
  shaderF16Description,
  otherMissing = [],
}: WebGpuRequirementNoticeProps) {
  if (status === null && otherMissing.length === 0) return null;

  const {title, body, bullets, footer, detail} = noticeContent(
    status,
    feature,
    shaderF16Description,
    otherMissing,
  );

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        {body.map(text => (
          <p key={text}>{text}</p>
        ))}
        {bullets.length > 0 && (
          <ul className="space-y-1">
            {bullets.map(cap => (
              <li key={cap.name}>
                <span className="font-medium text-foreground">{cap.name}</span>{' '}
                — {cap.reason}.
              </li>
            ))}
          </ul>
        )}
        {footer !== undefined && <p>{footer}</p>}
        {detail && <p className="text-xs">{FEATURE_DETAIL}</p>}
      </CardContent>
    </Card>
  );
}
