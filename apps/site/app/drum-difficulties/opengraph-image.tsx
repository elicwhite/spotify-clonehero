import {
  OgReductionCascade,
  type OgCascadeRow,
} from '@/lib/og/reduction-cascade';
import {createToolOgImage} from '@/lib/og/tool-og-image';
import {OG_LANES, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Generate drum Hard, Medium, and Easy from Expert';
export const size = OG_SIZE;
export const contentType = 'image/png';

/**
 * The reduction cascade at card size: a still frame of the route's hero
 * canvas with all four rows written. One bar of Expert drums and the three
 * generated tiers under it, one gem per column, each tier a strict subset
 * of the row above, down to kick and snare at Easy. The strict subset is
 * the picture's simplification, not a tool invariant: the real decode also
 * relanes cymbals and toms. The pattern and kept
 * slots restate `DRUM_SPEC` in
 * `components/difficulty-generation/landing/illustrations/ReductionCascadeCanvas.tsx`;
 * the gem shapes come from `lib/og/reduction-cascade`, which pins them to
 * that canvas's drawing code.
 */

const K = OG_LANES.kick;
const R = OG_LANES.red;
const Y = OG_LANES.yellow;
const B = OG_LANES.blue;
const G = OG_LANES.green;

/** Sixteen slots per row; `null` is an empty slot. */
const ROWS: readonly OgCascadeRow[] = [
  {
    label: 'EXPERT',
    notes: [G, Y, Y, K, R, Y, K, Y, K, Y, B, K, R, Y, B, Y],
  },
  {
    label: 'HARD',
    notes: [
      G,
      null,
      Y,
      K,
      R,
      null,
      K,
      null,
      K,
      null,
      B,
      null,
      R,
      null,
      B,
      null,
    ],
  },
  {
    label: 'MEDIUM',
    notes: [
      G,
      null,
      null,
      null,
      R,
      null,
      null,
      null,
      K,
      null,
      null,
      null,
      R,
      null,
      null,
      null,
    ],
  },
  {
    label: 'EASY',
    notes: [
      null,
      null,
      null,
      null,
      R,
      null,
      null,
      null,
      K,
      null,
      null,
      null,
      R,
      null,
      null,
      null,
    ],
  },
];

export default function OpengraphImage() {
  return createToolOgImage({
    eyebrow: 'DRUM DIFFICULTIES',
    title: 'Generate drum Hard, Medium, and Easy from Expert',
    illustration: <OgReductionCascade rows={ROWS} />,
  });
}
