'use client';

/**
 * Shared sidebar section chrome (plan 0074 Phase 7 task 7d), matching the
 * approved prototype's `.section` / `.sec-head` pair: a small uppercase
 * label above the section body, with the sections separated by a hairline.
 *
 * The heading stays an `<h3>` so section order is assertable by accessible
 * heading name, and `children` is the prototype's right-hand slot in the
 * heading row (the mixer's SOLO indicator).
 */

import type {ReactNode} from 'react';

/**
 * Root class for a sidebar section. The rule sits between sections, not
 * above the first one — which section is first depends on what the page's
 * capabilities render, so it is expressed as `first:` rather than picked by
 * hand. The gap between the rule and the section body reads the editor
 * density scope's token (`app/globals.css`), with the roomy `1rem` as the
 * no-scope fallback.
 */
export const SIDEBAR_SECTION_CLASS =
  'space-y-2 border-t pt-[var(--ed-gap-section,1rem)] first:border-t-0 first:pt-0';

export default function SectionHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {/* The `length:` hint is load-bearing. `text-*` is ambiguous in
       *  Tailwind (font size or text colour) and a bare `var()` carries no
       *  type, so Tailwind resolves `text-[var(--x)]` to the colour plugin
       *  and emits `color:` with no `font-size:` at all. The hint pins it to
       *  the font-size plugin. See the compiled-CSS assertions in
       *  `__tests__/sidebar-typography.test.tsx`. */}
      <h3 className="text-[length:var(--ed-text-label,0.75rem)] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}
