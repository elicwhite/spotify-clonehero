'use client';

/**
 * The editor's right-click popover: a small list of labelled actions anchored
 * at the pointer, dismissed by Escape or the next click elsewhere.
 *
 * Two surfaces open one — the piano roll's note/tempo lanes and the sidebar's
 * Chart Matrix — and they share this component rather than each carrying their
 * own markup and dismissal lifecycle, so a change to how a menu looks or how
 * it closes lands in both at once.
 *
 * `anchor` is the one real difference between the two call sites: the piano
 * roll positions inside its own relatively-positioned canvas wrapper from
 * canvas-local coordinates, the sidebar positions in the viewport from
 * `clientX`/`clientY`.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {cn} from '@/lib/utils';

/**
 * Destructive item colour.
 *
 * Not `text-destructive`: that token is `0 62.8% 30.6%` in dark mode, a deep
 * maroon that lands at 1.79:1 on the `0 0% 9%` popover surface and is
 * unreadable. `--destructive` is a *fill* colour in this theme (white text on
 * a red button), so it cannot double as a foreground on the popover. These two
 * reds clear 4.5:1 against `--popover` and against `--accent` (the hover fill)
 * in their respective themes; `context-menu-danger-contrast.test.tsx` computes
 * the ratios from the compiled stylesheet.
 *
 * The hover repeats are load-bearing: the base class list sets
 * `hover:text-accent-foreground`, and both are `text-*` colour utilities, so
 * only an explicit hover spelling here keeps a danger item red under the
 * cursor.
 */
const DANGER_TEXT =
  'text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400';

/** One entry in a right-click context menu. */
export interface ContextMenuItem {
  label: string;
  disabled?: boolean;
  /** Renders in the destructive (red) style. */
  danger?: boolean;
  /** Radio-style checkmark (the waveform source picker). */
  checked?: boolean;
  onSelect: () => void;
}

export interface ContextMenuPopoverProps {
  /** Menu origin, in whatever space `anchor` implies. */
  x: number;
  y: number;
  /** `'absolute'` positions within the nearest positioned ancestor;
   *  `'fixed'` positions in the viewport. Default `'absolute'`. */
  anchor?: 'absolute' | 'fixed';
  minWidthPx?: number;
  items?: ContextMenuItem[];
  /**
   * Rendered instead of `items` — for a step that replaces the list in the
   * same popover, such as an inline confirm.
   */
  children?: ReactNode;
  /** Run after an item's `onSelect`. Omit when selecting an item is meant to
   *  keep the popover open (the Chart Matrix's confirm step). */
  onAfterSelect?: () => void;
  'data-testid'?: string;
}

export default function ContextMenuPopover({
  x,
  y,
  anchor = 'absolute',
  minWidthPx = 160,
  items,
  children,
  onAfterSelect,
  'data-testid': testId,
}: ContextMenuPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [nudge, setNudge] = useState({x: 0, y: 0});

  // A menu opened near the right or bottom edge would otherwise render partly
  // offscreen. Measured after layout and applied as an offset, so the menu
  // still opens at the pointer everywhere it fits. Viewport-relative, so this
  // only applies to the `fixed` anchor; jsdom reports a zero-size rect, which
  // yields no offset.
  //
  // The overflow is computed from `x`/`y` plus the measured SIZE, never from
  // the measured position: the element being measured is already carrying the
  // previous offset, so reading its right/bottom edge would find the overflow
  // gone and reset the offset to zero, then find it again on the next pass.
  useLayoutEffect(() => {
    if (anchor !== 'fixed') return;
    const element = ref.current;
    if (!element) return;
    const {width, height} = element.getBoundingClientRect();
    const overflowX = Math.max(0, x + width - window.innerWidth + 4);
    const overflowY = Math.max(0, y + height - window.innerHeight + 4);
    setNudge(current =>
      current.x === -overflowX && current.y === -overflowY
        ? current
        : {x: -overflowX, y: -overflowY},
    );
  }, [anchor, x, y, items, children]);

  return (
    <div
      ref={ref}
      data-testid={testId}
      className={cn(
        'z-50 rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md',
        anchor === 'fixed' ? 'fixed' : 'absolute',
      )}
      style={{left: x + nudge.x, top: y + nudge.y, minWidth: minWidthPx}}
      onPointerDown={e => e.stopPropagation()}>
      {children ??
        items?.map((item, i) => (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            className={cn(
              'block w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
              item.danger && DANGER_TEXT,
            )}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onAfterSelect?.();
            }}>
            {item.checked !== undefined && (
              <span className="mr-1.5 inline-block w-2 text-accent-foreground">
                {item.checked ? '✓' : ''}
              </span>
            )}
            {item.label}
          </button>
        ))}
    </div>
  );
}

/**
 * Dismiss on the next pointerdown outside the popover.
 *
 * The listener attaches on a deferred timer: the right-click that opens a menu
 * is still propagating when the menu first renders, so an immediately-attached
 * listener would close it on the very gesture that asked for it.
 * `ContextMenuPopover` stops propagation of its own pointerdown, which is what
 * makes "anything still reaching `window`" mean "outside".
 */
export function useDismissOnOutsidePointerDown(
  open: boolean,
  dismiss: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = () => dismiss();
    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown, {once: true});
    }, 0);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.clearTimeout(timer);
    };
  }, [open, dismiss]);
}

/**
 * Dismiss on Escape. For a surface where Escape means more than one thing
 * (the piano roll also cancels an in-flight gesture with it), own the key
 * there instead of using this.
 */
export function useDismissOnEscape(open: boolean, dismiss: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dismiss]);
}
