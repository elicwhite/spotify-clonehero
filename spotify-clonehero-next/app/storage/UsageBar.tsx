'use client';

import {formatBytes} from '@/lib/sng/file-utils';

/** Share of the quota at which the browser is close enough to matter. */
const NEARLY_FULL_RATIO = 0.7;

export interface UsageSegment {
  key: string;
  label: string;
  bytes: number;
  /** Tailwind background class. Ordered dark to light in the bar. */
  swatch: string;
}

/**
 * What is taking the room, as one bar split into its parts.
 *
 * The segments are shares of what is stored, not of the quota. Drawn against
 * the quota they are sub-pixel until a browser is nearly full — 11 MB of a
 * 10 GB allowance is a bar that reads as empty — and "which of these is big"
 * is the question this page exists to answer. How close the browser is to
 * full is one sentence, and a warning when it is close enough to matter.
 *
 * A stacked bar rather than four more numbers, because the thing a reader has
 * to understand first is containment: the total is not a fifth figure beside
 * the others, it is the others.
 */
export function UsageBar({
  segments,
  quotaBytes,
}: {
  segments: UsageSegment[];
  quotaBytes: number;
}) {
  const used = segments.reduce((sum, segment) => sum + segment.bytes, 0);
  const ratio = quotaBytes > 0 ? used / quotaBytes : 0;

  return (
    <div className="space-y-4">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={segments
          .filter(segment => segment.bytes > 0)
          .map(segment => `${segment.label}: ${formatBytes(segment.bytes)}`)
          .join(', ')}>
        {used > 0 &&
          segments.map(segment =>
            segment.bytes > 0 ? (
              <div
                key={segment.key}
                className={segment.swatch}
                style={{width: `${(segment.bytes / used) * 100}%`}}
              />
            ) : null,
          )}
      </div>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {segments.map(segment => (
          <div key={segment.key} className="flex items-baseline gap-2">
            <span
              className={`size-2 shrink-0 rounded-full ring-1 ring-border ${segment.swatch}`}
              aria-hidden="true"
            />
            <dt className="text-sm text-foreground/70">{segment.label}</dt>
            <dd className="ml-auto font-mono text-sm text-foreground">
              {formatBytes(segment.bytes)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-sm text-foreground/70">
        {quotaBytes > 0
          ? `${formatBytes(used)} stored, of about ${formatBytes(
              quotaBytes,
            )} this browser allows.`
          : `${formatBytes(used)} stored. This browser does not say how much it allows.`}
      </p>

      {ratio >= NEARLY_FULL_RATIO ? (
        <p className="text-sm font-medium text-foreground">
          This browser is nearly full. Free what you can below, or it may start
          deleting for you.
        </p>
      ) : null}
    </div>
  );
}
