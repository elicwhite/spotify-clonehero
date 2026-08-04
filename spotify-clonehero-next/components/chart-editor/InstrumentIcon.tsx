/**
 * Instrument icon (plan 0076 item 9): the chart editor's binding of the
 * app-wide `InstrumentImage` (`components/ChartInstruments.tsx`), which owns
 * the `/public/assets/instruments/*.png` art and renders it. This adds only
 * what the editor's icon call sites want on top: the instruments an editor
 * surface can name, a pixel size defaulted to the sidebar's scale, and
 * decorative-by-default alt text. Game-accurate art rather than a vector
 * glyph is the point — every instrument gets its own recognizable icon,
 * which a vector set can't offer (lucide has no bass glyph at all).
 *
 * Decorative by default (`alt=""`, `aria-hidden`): every call site in this
 * editor pairs the icon with adjacent visible text (a row label, a menu
 * item's own name, a card's own heading) that already carries the
 * accessible name, so the icon doesn't need to repeat it — matching the
 * lucide icons it replaces, which contributed nothing to the accessible
 * name either. Pass `alt` to give the icon its own accessible name for a
 * standalone use with no adjacent label.
 *
 * Exception (owner call): the Drum transcription assist card keeps its own
 * tool icon and does not use this component.
 */

import {InstrumentImage} from '@/components/ChartInstruments';
import type {SupportedTrackInstrument} from '@/lib/chart-editor-core';

/** Every instrument this component knows how to iconify. Superset of
 *  `SupportedTrackInstrument` so non-track instruments (vocals, for the
 *  Lyrics card) can use the same component. */
export type IconableInstrument = SupportedTrackInstrument | 'vocals';

export interface InstrumentIconProps {
  instrument: IconableInstrument;
  /** Square pixel size for both width and height. Matrix rows and menus use
   *  the default ~16-18px scale; a card's icon tile can pass a larger size. */
  size?: number;
  className?: string;
  /** Accessible name for a standalone icon with no adjacent visible label.
   *  Omitted (the default) renders a decorative `alt=""`. */
  alt?: string;
}

export default function InstrumentIcon({
  instrument,
  size = 16,
  className,
  alt,
}: InstrumentIconProps) {
  return (
    <InstrumentImage
      instrument={instrument}
      size={size}
      classNames={className}
      alt={alt ?? null}
    />
  );
}
