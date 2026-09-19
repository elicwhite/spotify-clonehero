'use client';

/**
 * The editor's on-demand stem separation, as the two surfaces that offer it
 * see it (plan 0123): the Stems mixer section and the piano roll's
 * waveform-row context menu.
 *
 * The wiring is one host-supplied object rather than a context, because both
 * surfaces are rendered directly by `ChartEditor` — and it is optional for
 * the same reason a Chart Assist card is: a host with no runner and no audio
 * loader behind it has nothing to offer, so it passes nothing and neither
 * surface draws an affordance.
 *
 * The option copy lives here, once, so the sidebar buttons and the menu
 * entries cannot describe the same run differently.
 */

import type {AssistStore} from '@/lib/assist/assist-store';
import type {StemSeparationModel} from '@/lib/assist/tasks/separate-stems';
import type {StemSeparationOffer} from './hooks/useSeparatedStems';

export interface StemSeparationOption {
  model: StemSeparationModel;
  /** Sidebar button label. */
  label: string;
  /** Context-menu label, which has no surrounding heading to lean on. */
  menuLabel: string;
  /** What the choice actually buys, for the button's tooltip. */
  description: string;
}

export const STEM_SEPARATION_OPTIONS: readonly StemSeparationOption[] = [
  {
    model: 'demucs',
    label: 'Good and fast',
    menuLabel: 'Separate stems: good and fast',
    description:
      'Splits the song into drums and vocals with Demucs. Quicker, and a ' +
      'smaller download the first time, but a rougher split.',
  },
  {
    model: 'roformer',
    label: 'Great and slow',
    menuLabel: 'Separate stems: great and slow',
    description:
      'Splits the song into drums and vocals with BS-Roformer. The cleanest ' +
      'split this app can make, and the slowest.',
  },
];

/** Which surface asked for a run. Reported as the assist run's entrypoint,
 *  so the two affordances can be told apart in the funnel. */
export type StemSeparationEntrypoint = 'stems-mixer' | 'waveform-menu';

/** One request to separate. An object rather than two positional arguments
 *  so each call site spells its entrypoint out as a named literal — which is
 *  what `components/assist/__tests__/run-entrypoints.test.ts` reads to hold
 *  every run-starting surface accountable for the one it reports. */
export interface StemSeparationRequest {
  model: StemSeparationModel;
  entrypoint: StemSeparationEntrypoint;
}

export interface StemSeparationHostProps {
  /** Which options would still add a stem this project does not have. Both
   *  false means the section draws nothing. */
  offer: StemSeparationOffer;
  /** True while a separation run is in flight. */
  running: boolean;
  /**
   * Why this model cannot be run right now, or undefined when it can.
   *
   * Per model, not per surface: the two options do not have the same
   * requirements. BS-Roformer has fp16 weights and needs a graphics card
   * with `shader-f16`; Demucs is fp32 and runs on any adapter, falling back
   * to the CPU when there is none. So a card that cannot run one can still
   * run the other, and a single shared reason would disable a button that
   * works.
   */
  disabledReasonFor: (model: StemSeparationModel) => string | undefined;
  /** Starts a run. */
  onSeparate: (request: StemSeparationRequest) => void;
  /** The shared run store, for the inline progress card the mixer renders. */
  store: AssistStore;
  onCancel: () => void;
  onDismiss: () => void;
}

/** The options this project should actually be offered. */
export function offeredStemSeparations(
  offer: StemSeparationOffer,
): readonly StemSeparationOption[] {
  return STEM_SEPARATION_OPTIONS.filter(option => offer[option.model]);
}
