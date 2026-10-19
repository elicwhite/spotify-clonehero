/**
 * Pure placement math for {@link ContextMenuPopover}: given where the pointer
 * opened the menu, the menu's measured size, and the viewport size, decide
 * which direction to open in and whether the menu needs to be clamped.
 *
 * Kept independent of React and of the component's two coordinate spaces
 * (`anchor: 'fixed'` is viewport-relative already; `anchor: 'absolute'` is
 * relative to the positioned ancestor) — the component converts into
 * viewport space before calling this, and back out afterward.
 */

/** The outcome of fitting the menu along a single axis. */
interface AxisFit {
  /** Final position along the axis, in the same space as `pointer`. */
  position: number;
  /** Set only when the menu fits in neither direction and had to be clamped
   *  to the viewport — the caller should cap the matching CSS dimension and
   *  let the content scroll rather than let it hang off the screen. */
  clampedSize?: number;
}

/**
 * Places a `menuSize`-long span starting at `pointer`, preferring to grow
 * forward (right/down). Flips to grow backward (left/up) if it wouldn't fit
 * forward but would fit backward. Clamps to the viewport, flagging the size
 * that fits, if it fits in neither direction.
 */
function fitAxis(
  pointer: number,
  menuSize: number,
  viewportSize: number,
  margin: number,
): AxisFit {
  if (pointer + menuSize <= viewportSize - margin) {
    return {position: pointer};
  }
  if (pointer - menuSize >= margin) {
    return {position: pointer - menuSize};
  }
  return {
    position: margin,
    clampedSize: Math.max(0, viewportSize - margin * 2),
  };
}

export interface ContextMenuPlacementInput {
  /** Pointer/anchor origin, in viewport coordinates. */
  pointerX: number;
  pointerY: number;
  /** The menu's measured size. */
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Minimum gap kept from the edge of the viewport. Default `4`. */
  margin?: number;
}

export interface ContextMenuPlacement {
  /** Final origin, in the same viewport coordinates as the input pointer. */
  x: number;
  y: number;
  /** Set only when the menu is taller than the viewport can fit in either
   *  direction — the caller should apply this as a CSS `max-height` (with
   *  `overflow-y: auto`) instead of letting the menu overflow the screen. */
  maxHeight?: number;
}

export function computeContextMenuPlacement({
  pointerX,
  pointerY,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  margin = 4,
}: ContextMenuPlacementInput): ContextMenuPlacement {
  const horizontal = fitAxis(pointerX, menuWidth, viewportWidth, margin);
  const vertical = fitAxis(pointerY, menuHeight, viewportHeight, margin);
  return {
    x: horizontal.position,
    y: vertical.position,
    ...(vertical.clampedSize === undefined
      ? {}
      : {maxHeight: vertical.clampedSize}),
  };
}
