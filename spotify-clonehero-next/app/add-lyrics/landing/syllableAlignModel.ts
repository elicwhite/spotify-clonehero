/**
 * The data behind the /add-lyrics syllable-alignment picture, shared by the
 * animated hero canvas (`SyllableAlignCanvas.tsx`), the route's social
 * card (`app/add-lyrics/opengraph-image.tsx`), which draws the canvas's
 * settled frame, and the /chart page's syllable strip
 * (`app/chart/illustrations/LyricSyllables.tsx`). One source, so an edited
 * syllable time changes all three.
 *
 * The line is the opening of "The Wellerman", a traditional sea shanty in
 * the public domain.
 */

export interface Syllable {
  text: string;
  time: string;
  /** Onset as a fraction of the strip width — where the burst is sung. */
  at: number;
  /** Burst length in strip-width fractions. */
  dur: number;
  /** Relative loudness of the burst. */
  amp: number;
}

export const SYLLABLES: readonly Syllable[] = [
  {text: 'Soon', time: '0:02.10', at: 0.055, dur: 0.055, amp: 0.9},
  {text: 'may', time: '0:02.45', at: 0.22, dur: 0.05, amp: 0.7},
  {text: 'the', time: '0:02.78', at: 0.36, dur: 0.04, amp: 0.55},
  {text: 'Wel', time: '0:03.12', at: 0.49, dur: 0.06, amp: 1},
  {text: 'ler', time: '0:03.42', at: 0.615, dur: 0.055, amp: 0.85},
  {text: 'man', time: '0:03.74', at: 0.745, dur: 0.06, amp: 0.9},
  {text: 'come', time: '0:04.08', at: 0.9, dur: 0.12, amp: 0.95},
];

/**
 * The syllable the picture corrects, and where the model first proposed it.
 * The offset is small on purpose: a visible miss, not a wild one.
 */
export const CORRECTED_INDEX = 4;
export const PROPOSED_AT = 0.585;

/** Deterministic pseudo-noise, so the waveform is the same on every render. */
function wobble(i: number) {
  return (Math.sin(i * 12.9898) * 43758.5453) % 1;
}

/**
 * Envelope height at position `t` in [0,1]: a burst per syllable with a fast
 * attack and a decay across its duration, over a quiet noise bed. The burst
 * for the corrected syllable sits at its true position — the model's error
 * is a mispredicted placement, not a misplaced vocal.
 */
export function envelope(t: number) {
  let v = 0.06 + 0.03 * Math.abs(wobble(Math.floor(t * 90)));
  for (const syl of SYLLABLES) {
    const phase = (t - syl.at) / syl.dur;
    if (phase >= 0 && phase < 1.6) {
      const attack = Math.min(1, phase / 0.12);
      const decay = Math.exp(-Math.max(0, phase - 0.12) * 2.6);
      v +=
        syl.amp *
        attack *
        decay *
        (0.8 + 0.2 * Math.abs(wobble(syl.at * 97 + Math.floor(t * 220))));
    }
  }
  return Math.min(1, v);
}
