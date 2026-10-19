/**
 * The reduction cascade as a social-card illustration: the still frame of the
 * difficulty pages' hero canvas that the drum and guitar difficulty cards
 * both draw. A route file supplies only its rows — which lanes at which
 * slots, plus any sustain lengths; the shape of a gem and a tail is defined
 * once here so the two cards agree with each other and with the page.
 *
 * `CASCADE_SHAPES` restates the drawing constants of
 * `components/difficulty-generation/landing/illustrations/ReductionCascadeCanvas.tsx`
 * (`drawGem`), whose sustain in turn mirrors the chart editor's
 * `paintFretSustain` in `components/chart-editor/piano-roll/draw.ts`. Satori
 * renders outside the DOM and cannot run that canvas code, so the values are
 * restated — the same arrangement as `OG_LANES` and the stylesheet. The
 * drift guard in `__tests__/og-routes.test.ts` pins each constant here to
 * the canvas's drawing code, and each card's `ROWS` to the canvas's
 * `DRUM_SPEC` / `GUITAR_SPEC` note patterns; change either side of the
 * canvas and the test names the copy to update.
 *
 * The canvas's pixel-valued shapes (the gem width cap, the corner radii) are
 * CSS px at the hero's desktop size, where a row is `baseRowHeight` px tall.
 * The card's rows are taller, so those values scale by
 * `rowHeight / baseRowHeight` — the card is the hero picture enlarged, not
 * redrawn with sharper corners.
 */
import {OG_COLORS, OG_TYPE} from './tokens';

export const CASCADE_SHAPES = {
  /** drawGem: `gemW = Math.min(slotW * 0.62, 15 * dpr)`. */
  gemWidthOfSlot: 0.62,
  gemWidthCap: 15,
  /** drawGem: `gemH = Math.max(5 * dpr, rowH * 0.34)`. */
  gemHeightOfRow: 0.34,
  gemHeightMin: 5,
  /** drawGem head: `roundRect(..., 2.5 * dpr)` — rounded, never a pill. */
  gemCornerRadius: 2.5,
  /** Tail: `tailH = gemH * 0.76`, as in `paintFretSustain`. */
  tailHeightOfGem: 0.76,
  /** Tail: `ctx.globalAlpha = 0.78 * ...` (the editor's unselected alpha). */
  tailAlpha: 0.78,
  /** Tail corner: `Math.min(3 * dpr, tailH / 3)`. */
  tailCornerCap: 3,
  tailCornerDivisor: 3,
  /**
   * One hero-canvas row in CSS px at the desktop size: the canvas is
   * `sm:h-44` (176px) over four rows. The px-valued shapes above read at
   * this scale.
   */
  baseRowHeight: 44,
} as const;

/** The card's cascade grid. Slots and label column match the canvas layout.
 *  The rows actually size by `flexGrow`; `rowHeight` is the nominal height
 *  the px-valued shapes scale from — the tool panel's inner height (300 −
 *  2·1 border − 2·16 panel padding − 2·8 cascade padding = 250) over the
 *  four rows, rounded up to a whole px. */
export const GRID = {
  labelWidth: 200,
  slots: 16,
  slotWidth: 50,
  rowHeight: 63,
} as const;

export interface OgCascadeRow {
  label: string;
  /** Sixteen slots; `null` is an empty slot, a string is the gem's lane
   *  color (an `OG_LANES` value). */
  notes: readonly (string | null)[];
  /** Slot index → sustain tail length in slots. */
  sustains?: Readonly<Record<number, number>>;
}

const scale = GRID.rowHeight / CASCADE_SHAPES.baseRowHeight;
const GEM_W = Math.min(
  GRID.slotWidth * CASCADE_SHAPES.gemWidthOfSlot,
  CASCADE_SHAPES.gemWidthCap * scale,
);
const GEM_H = Math.max(
  CASCADE_SHAPES.gemHeightMin * scale,
  GRID.rowHeight * CASCADE_SHAPES.gemHeightOfRow,
);
const GEM_RADIUS = CASCADE_SHAPES.gemCornerRadius * scale;
const TAIL_H = GEM_H * CASCADE_SHAPES.tailHeightOfGem;
const TAIL_RADIUS = Math.min(
  CASCADE_SHAPES.tailCornerCap * scale,
  TAIL_H / CASCADE_SHAPES.tailCornerDivisor,
);

function CascadeRowStrip({
  label,
  notes,
  sustains = {},
}: {
  label: string;
  notes: readonly (string | null)[];
  sustains?: Readonly<Record<number, number>> | undefined;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        flexGrow: 1,
      }}>
      <div
        style={{
          display: 'flex',
          width: GRID.labelWidth,
          flexShrink: 0,
          fontSize: OG_TYPE.illustrationSub,
          color: OG_COLORS.muted,
          fontFamily: 'monospace',
        }}>
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          position: 'relative',
          flexGrow: 1,
          height: GEM_H,
        }}>
        {notes.map((color, slot) => {
          if (color === null) return null;
          const gemLeft = slot * GRID.slotWidth + (GRID.slotWidth - GEM_W) / 2;
          const tail = sustains[slot] ?? 0;
          return [
            // Tail first, as the canvas paints it, so a head is never
            // covered by a tail.
            tail > 0 ? (
              <div
                key={`tail-${slot}`}
                style={{
                  display: 'flex',
                  position: 'absolute',
                  left: gemLeft + GEM_W,
                  top: (GEM_H - TAIL_H) / 2,
                  width: tail * GRID.slotWidth - GEM_W / 2,
                  height: TAIL_H,
                  // Flat against the head, rounded only at the far end. The
                  // canvas gives roundRect one radius, but at hero scale
                  // that is at most 3 CSS px flush against the head, so the
                  // butt edge reads flat; enlarging the corner with the
                  // card would draw a seam the page does not have.
                  borderRadius: `0 ${TAIL_RADIUS}px ${TAIL_RADIUS}px 0`,
                  background: color,
                  opacity: CASCADE_SHAPES.tailAlpha,
                }}
              />
            ) : null,
            <div
              key={`gem-${slot}`}
              style={{
                display: 'flex',
                position: 'absolute',
                left: gemLeft,
                top: 0,
                width: GEM_W,
                height: GEM_H,
                borderRadius: GEM_RADIUS,
                background: color,
              }}
            />,
          ];
        })}
      </div>
    </div>
  );
}

/** All four cascade rows, filling the standard tool-card panel. */
export function OgReductionCascade({rows}: {rows: readonly OgCascadeRow[]}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '8px 12px',
      }}>
      {rows.map(row => (
        <CascadeRowStrip
          key={row.label}
          label={row.label}
          notes={row.notes}
          sustains={row.sustains}
        />
      ))}
    </div>
  );
}
