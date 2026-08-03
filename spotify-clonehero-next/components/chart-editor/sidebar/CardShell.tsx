'use client';

/**
 * Chrome shared by every Chart Assist card (plan 0074 Phase 2): the bordered
 * block with an icon, name, one-line explanation, optional attention note,
 * and a "Learn more" link — plus the action button the card puts inside it.
 */

import {useId} from 'react';

import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';

import type {LearnKey} from './learn-copy';

export interface CardShellProps {
  icon: React.ElementType;
  name: string;
  status?: string | undefined;
  explanation: string;
  note?: string | undefined;
  attn?: boolean | undefined;
  learnKey: LearnKey;
  onLearnMore: (key: LearnKey) => void;
  children?: React.ReactNode;
}

export function CardShell({
  icon: Icon,
  name,
  status,
  explanation,
  note,
  attn,
  learnKey,
  onLearnMore,
  children,
}: CardShellProps) {
  return (
    // `role="group"` + the card's name is what makes a card addressable by
    // accessible name — both for screen readers scanning the section and for
    // tests that need "the Learn more button in the Drum transcription card"
    // without reaching for a CSS class.
    <div
      role="group"
      aria-label={name}
      className={cn(
        'rounded-lg border p-3 space-y-1.5',
        attn &&
          'border-amber-400/60 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-500/40',
      )}>
      <div className="flex items-start gap-2">
        <div
          className={cn(
            'h-6 w-6 rounded-md bg-muted flex items-center justify-center shrink-0',
            attn && 'bg-amber-100 dark:bg-amber-900/40',
          )}>
          <Icon
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground',
              attn && 'text-amber-700 dark:text-amber-300',
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold">{name}</div>
          {status && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {status}
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{explanation}</p>
      {note && (
        <p className="text-[11px] text-amber-800 dark:text-amber-300">{note}</p>
      )}
      {children}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground"
          onClick={() => onLearnMore(learnKey)}>
          Learn more
        </Button>
      </div>
    </div>
  );
}

export interface CardActionProps {
  /**
   * Why the action can't run: a transient host state (audio rebuilding), or
   * a standing limit of this surface (a host that can't pad its audio, or
   * has no separated-stem pipeline behind it). The first kind clears on its
   * own; the second is why a card can still be worth rendering with a dead
   * button, when its status and recommendation are useful on their own.
   */
  disabledReason?: string | undefined;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  variant?: 'default' | 'outline' | 'ghost' | undefined;
}

export function CardAction({
  disabledReason,
  onClick,
  icon: Icon,
  label,
  variant = 'outline',
}: CardActionProps) {
  const reasonId = useId();
  const button = (
    <Button
      variant={variant}
      size="sm"
      className="h-7 gap-1.5"
      disabled={disabledReason !== undefined}
      aria-describedby={disabledReason === undefined ? undefined : reasonId}
      onClick={onClick}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
  if (disabledReason === undefined) return button;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">{button}</span>
        </TooltipTrigger>
        <TooltipContent side="right">{disabledReason}</TooltipContent>
      </Tooltip>
      {/* The tooltip is the sighted user's route to the reason, and a
       *  disabled button can't be focused to open it — so the same sentence
       *  is also the button's accessible description, always present. */}
      <span id={reasonId} className="sr-only">
        {disabledReason}
      </span>
    </>
  );
}
