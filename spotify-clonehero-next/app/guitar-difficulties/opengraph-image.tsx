import {
  OgReductionCascade,
  type OgCascadeRow,
} from '@/lib/og/reduction-cascade';
import {createToolOgImage} from '@/lib/og/tool-og-image';
import {OG_LANES, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Generate guitar Hard, Medium, and Easy from Expert';
export const size = OG_SIZE;
export const contentType = 'image/png';

/**
 * The reduction cascade at card size, drawn for five-fret guitar: a still
 * frame of the route's hero canvas with all four rows written. One gem per
 * column, each tier a strict subset of the row above, and one mid-bar
 * sustain: held on Expert and Hard, a plain hit on Medium, dropped at
 * Easy. The strict subset is the picture's simplification, not a tool
 * invariant: the real decoder can land on a fret the Expert moment never
 * played. The pattern, kept slots, and sustain lengths restate `GUITAR_SPEC`
 * in
 * `components/difficulty-generation/landing/illustrations/ReductionCascadeCanvas.tsx`;
 * the gem and tail shapes come from `lib/og/reduction-cascade`, which pins
 * them to that canvas's drawing code.
 */

const G = OG_LANES.green;
const R = OG_LANES.red;
const Y = OG_LANES.yellow;
const B = OG_LANES.blue;
/** The orange fret: the kick lane color is the family's orange. */
const O = OG_LANES.kick;

/** Sixteen slots per row; `null` is an empty slot. `sustains` maps a slot
 *  to its tail length in slots. */
const ROWS: readonly OgCascadeRow[] = [
  {
    label: 'EXPERT',
    notes: [G, R, Y, B, O, B, Y, R, G, null, B, R, G, Y, B, R],
    sustains: {8: 1},
  },
  {
    label: 'HARD',
    notes: [
      G,
      R,
      null,
      B,
      O,
      null,
      Y,
      null,
      G,
      null,
      B,
      null,
      G,
      null,
      B,
      null,
    ],
    sustains: {8: 1},
  },
  {
    label: 'MEDIUM',
    notes: [
      G,
      null,
      null,
      null,
      null,
      null,
      Y,
      null,
      G,
      null,
      null,
      null,
      G,
      null,
      null,
      null,
    ],
  },
  {
    label: 'EASY',
    notes: [
      G,
      null,
      null,
      null,
      null,
      null,
      Y,
      null,
      null,
      null,
      null,
      null,
      G,
      null,
      null,
      null,
    ],
  },
];

export default function OpengraphImage() {
  return createToolOgImage({
    eyebrow: 'GUITAR DIFFICULTIES',
    title: 'Generate guitar Hard, Medium, and Easy from Expert',
    illustration: <OgReductionCascade rows={ROWS} />,
  });
}
