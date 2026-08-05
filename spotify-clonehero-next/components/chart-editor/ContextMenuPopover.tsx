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
  type CSSProperties,
  type ReactNode,
} from 'react';

import {cn} from '@/lib/utils';
import {computeContextMenuPlacement} from './contextMenuPlacement';

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

/**
 * Row height for a menu item, on the editor's compact control scale.
 *
 * `--ed-control-h-sm` is the same token the sidebar's small controls and the
 * `xs` button variant spend, so a menu row lines up with the chrome it was
 * opened from. It resolves to 24px under `data-density="compact"` — which the
 * editor always sets while it is mounted, and which reaches this popover
 * because the scope lives on the document root. The 1.75rem fallback is the
 * unscoped size, so the component stays usable outside an editor.
 */
const ITEM_HEIGHT = 'h-[var(--ed-control-h-sm,1.75rem)]';

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
  minWidthPx = 140,
  items,
  children,
  onAfterSelect,
  'data-testid': testId,
}: ContextMenuPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Rendered position/size, and whether it has been placed yet. Starts
  // unplaced at the raw pointer coordinates and hidden, so the very first
  // paint (a menu taller than the viewport, say) never flashes in the wrong
  // spot before the layout effect below corrects it.
  const [placed, setPlaced] = useState(false);
  const [style, setStyle] = useState<{
    left: number;
    top: number;
    maxHeight?: number;
  }>({left: x, top: y});

  // Flip-to-fit (plan 0079 §3): measure the rendered menu, then pick the open
  // direction from the space actually available, rather than always opening
  // below-right and letting it run off the screen.
  //
  // `anchor: 'fixed'` coordinates are already viewport space. `anchor:
  // 'absolute'` coordinates are local to the nearest positioned ancestor (the
  // piano roll's canvas wrapper), so they're converted to viewport space via
  // that ancestor's own bounding rect before being handed to the placement
  // math, and the result converted back before it's used as `left`/`top` —
  // comparing container-local coordinates against the viewport directly would
  // flip a menu inside a short scrolled container for the wrong reason.
  //
  // jsdom always reports a zero-size rect for the (unstyled, unlaid-out)
  // menu, which would otherwise collapse every menu to the top-left corner;
  // treated as "can't measure yet" and left at the raw pointer coordinates,
  // matching the pre-flip-to-fit behaviour.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const {width, height} = element.getBoundingClientRect();
    if (width === 0 || height === 0) {
      setStyle({left: x, top: y});
      setPlaced(true);
      return;
    }

    const containerRect =
      anchor === 'absolute'
        ? (element.offsetParent as HTMLElement | null)?.getBoundingClientRect()
        : undefined;
    const containerLeft = containerRect?.left ?? 0;
    const containerTop = containerRect?.top ?? 0;

    const placement = computeContextMenuPlacement({
      pointerX: x + containerLeft,
      pointerY: y + containerTop,
      menuWidth: width,
      menuHeight: height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });

    setStyle({
      left: placement.x - containerLeft,
      top: placement.y - containerTop,
      ...(placement.maxHeight === undefined
        ? {}
        : {maxHeight: placement.maxHeight}),
    });
    setPlaced(true);
  }, [anchor, x, y, items, children]);

  const positionStyle: CSSProperties = {
    left: style.left,
    top: style.top,
    minWidth: minWidthPx,
    maxHeight: style.maxHeight,
    overflowY: style.maxHeight !== undefined ? 'auto' : undefined,
    visibility: placed ? 'visible' : 'hidden',
  };

  return (
    <div
      ref={ref}
      data-testid={testId}
      className={cn(
        'z-50 rounded-sm border border-border bg-popover py-0.5 text-[11.5px] text-popover-foreground shadow-md',
        anchor === 'fixed' ? 'fixed' : 'absolute',
      )}
      style={positionStyle}
      onPointerDown={e => e.stopPropagation()}>
      {children ??
        items?.map((item, i) => (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            className={cn(
              'flex w-full items-center whitespace-nowrap px-2 text-left hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
              ITEM_HEIGHT,
              item.danger && DANGER_TEXT,
            )}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onAfterSelect?.();
            }}>
            {item.checked !== undefined && (
              // Fixed-width and never shrinking, so labels start at the same
              // x whether or not their row is the checked one.
              <span className="mr-1 w-2.5 shrink-0 text-center text-accent-foreground">
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
