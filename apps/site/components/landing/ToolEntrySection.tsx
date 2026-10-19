import type {ReactNode} from 'react';

import {LandingSection} from './Section';

/**
 * The id the tool-entry section carries and the footer CTA scrolls to. Both
 * sides import it so the coupling is one constant rather than two string
 * literals that can drift apart.
 */
export const START_SECTION_ID = 'start';

/**
 * The working screen, promoted to the top of the page.
 *
 * A tool page's job is to open the tool, so the entry sits above the
 * explanation rather than behind it. The entry itself is passed in, because
 * the pipeline it drives belongs to the page's client component, not to the
 * marketing layout.
 */
export function ToolEntrySection({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  /** The tool's own entry screen (upload, picker, drop zone). */
  children: ReactNode;
}) {
  return (
    <LandingSection id={START_SECTION_ID} title={title} intro={intro}>
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6">
        {children}
      </div>
    </LandingSection>
  );
}
