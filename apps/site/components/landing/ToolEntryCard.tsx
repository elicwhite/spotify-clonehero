import type {ReactNode} from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import {cn} from '@/lib/utils';

/**
 * The card a tool's entry controls sit in, inside a `ToolEntrySection`.
 *
 * Before this existed, `/tempo`, `/drum-transcription`, the difficulty
 * routes, and `/add-lyrics` each hand-built the same Card shape and drifted:
 * one dropped `w-full` (so its card rendered narrower than the others), one
 * dropped the header and had to hand-write `pt-6` to compensate for
 * `CardContent`'s header-assuming `p-6 pt-0`. This owns those decisions:
 *
 * - `description` is the one-or-two sentence statement of what the tool
 *   builds, rendered as the card header. Optional, because an entry whose
 *   section intro already says it (`/add-lyrics`) has nothing to add; the
 *   card then pads its own top instead of expecting a header above it.
 * - `footnote` is the trust footnote (style guide §7: stated, not
 *   decorated): what runs locally, what gets downloaded.
 */
export function ToolEntryCard({
  description,
  footnote,
  children,
}: {
  description?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="w-full">
      {description ? (
        <CardHeader>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      ) : null}
      <CardContent className={cn('space-y-4', !description && 'pt-6')}>
        {children}
        {footnote ? (
          <p className="text-xs text-muted-foreground">{footnote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
