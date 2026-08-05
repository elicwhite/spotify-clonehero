'use client';

/**
 * Chrome shared by every Chart Assist card (plan 0074 Phase 2): the bordered
 * block with an icon, name, one-line explanation, optional attention note,
 * and a "Learn more" link — plus the action button the card puts inside it.
 */

import {useId} from 'react';
import type {ReactNode} from 'react';
import {Sparkles} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';

import type {LearnKey} from './learn-copy';

export interface CardShellProps {
  /**
   * The card's icon-tile glyph (a lucide icon like `<Clock />`, or
   * `<InstrumentIcon instrument="guitar" />` for a card that represents an
   * instrument, plan 0076 item 9). The tile sizes and colours whatever it
   * renders through descendant selectors, so a lucide `svg` and
   * `InstrumentIcon`'s `next/image` both land at the same size with no
   * cooperation from the glyph itself.
   */
  icon: ReactNode;
  name: string;
  status?: string | undefined;
  /**
   * Provenance badge shown ahead of `status` (e.g. "AI-transcribed"), drawn
   * in the accent colour with a sparkle — the approved prototype's
   * `.ai-badge`. Omitted when the card's subject has no AI origin to claim.
   */
  aiLabel?: string | undefined;
  explanation: string;
  note?: string | undefined;
  attn?: boolean | undefined;
  learnKey: LearnKey;
  onLearnMore: (key: LearnKey) => void;
  /**
   * The card's own buttons (the prototype's `.card-actions`). They get a row
   * to themselves, above the "Learn more" row; the row is omitted entirely
   * when a card has no actions to offer (e.g. while its run is in flight).
   */
  actions?: React.ReactNode;
  /** Block content between the copy and the actions row — the inline run
   *  card while a task is running, and any dialogs the card owns. */
  children?: React.ReactNode;
}

export function CardShell({
  icon,
  name,
  status,
  aiLabel,
  explanation,
  note,
  attn,
  learnKey,
  onLearnMore,
  actions,
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
      // Padding reads the editor density scope's card token
      // (`app/globals.css`, plan 0074 Phase 7 task 7c); the `0.75rem`
      // fallback is the card's look with no scope applied.
      className={cn(
        'rounded-lg border p-[var(--ed-pad-card,0.75rem)] space-y-1.5 transition-colors',
        attn &&
          'border-amber-400/60 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-500/40',
      )}>
      <div className="flex items-start gap-2">
        <div
          className={cn(
            // 22px tile, the prototype's `.card-icon`, sizing its glyph to
            // 14px whether that is an svg or an img.
            'h-[1.375rem] w-[1.375rem] rounded-md bg-muted flex items-center justify-center shrink-0',
            '[&_svg]:size-3.5 [&_img]:size-3.5 [&_img]:object-contain',
            'text-muted-foreground',
            attn &&
              'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
          )}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{name}</div>
          {(status || aiLabel) && (
            <div className="text-[12px] text-muted-foreground mt-0.5">
              {aiLabel && (
                <>
                  <span className="inline-flex items-center gap-0.5 font-semibold text-primary">
                    <Sparkles className="h-2.5 w-2.5" />
                    {aiLabel}
                  </span>
                  {status && ' · '}
                </>
              )}
              {status}
            </div>
          )}
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">{explanation}</p>
      {note && (
        <p className="text-[12px] text-amber-800 dark:text-amber-300">{note}</p>
      )}
      {children}
      {actions && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {actions}
        </div>
      )}
      {/* "Learn more" gets its own row on EVERY card, unconditionally. Sharing
       *  the actions row means the layout depends on the CTA's label length —
       *  "Add leading silence" and "Generate tempo map" wrap it to a second
       *  line at the 290px rail while "Transcribe" doesn't — and cards with
       *  three actions (re-generate / keep / delete) can never fit it at all.
       *  A dedicated row is the one arrangement that is identical everywhere.
       *  Flush left (`px-0`) so it lines up with the card's copy rather than
       *  the buttons above it. */}
      <div className="pt-0.5">
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0 text-muted-foreground"
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
      // `xs` is the card-action scale (`components/ui/button.tsx`): the
      // prototype's `.btn.sm`, one step below shadcn's `sm`, and the only
      // size that also drops type and icon scale.
      size="xs"
      disabled={disabledReason !== undefined}
      aria-describedby={disabledReason === undefined ? undefined : reasonId}
      onClick={onClick}>
      <Icon />
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
        {/* `max-w` + `text-balance` (plan 0076 item 16): a disabled reason is
         *  a short phrase, and this wraps it onto two balanced lines in the
         *  narrow sidebar instead of one very wide line. Scoped to the assist
         *  CTAs rather than applied to every tooltip in the app. */}
        <TooltipContent side="right" className="max-w-[220px] text-balance">
          {disabledReason}
        </TooltipContent>
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
