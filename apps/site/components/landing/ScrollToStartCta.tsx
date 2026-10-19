'use client';

import {useCallback} from 'react';

import {Button} from '@/components/ui/button';

import {START_SECTION_ID} from './ToolEntrySection';

/**
 * The page's closing call to action: send the reader back up to the tool
 * entry they scrolled past.
 *
 * The label is a plain instruction, per `docs/landing-page-style-guide.md`
 * §2 ("Open the tool" as the button label, with no surrounding hype), so the
 * caller supplies the verb and nothing else.
 */
export function ScrollToStartCta({children}: {children: React.ReactNode}) {
  const scrollToStart = useCallback(() => {
    document
      .getElementById(START_SECTION_ID)
      ?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }, []);

  return (
    <div className="flex flex-col items-start border-t border-border pt-8">
      <Button onClick={scrollToStart}>{children}</Button>
    </div>
  );
}
