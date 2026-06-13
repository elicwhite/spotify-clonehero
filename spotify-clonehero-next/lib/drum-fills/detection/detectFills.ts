/**
 * Fill detection (v1 heuristic).
 *
 * A fill is a short (0.5-2 bar) departure from the established groove, usually
 * tom-heavy and/or density-spiking, often terminating on a crash at a downbeat
 * or section boundary. This module finds candidate fill bars, merges adjacent
 * ones into spans, scores them, and emits `DetectedFill`s.
 */

import type {ParsedChart, ParsedTrackData} from '@/lib/chart-edit/types';
import {tickToMs} from '@/lib/chart-utils/tickToMs';
import {
  buildFingerprints,
  fingerprintSimilarity,
  inferLocalGroove,
} from './grooveModel';
import {
  type BarFingerprint,
  type DetectedFill,
  type DetectionOptions,
  type FillFeatures,
  type DrumVoice,
  DEFAULT_DETECTION_OPTIONS,
} from './types';

/** Find the Expert drums track in a parsed chart, if present. */
export function getExpertDrumsTrack(
  chart: ParsedChart,
): ParsedTrackData | null {
  return (
    chart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    ) ?? null
  );
}

interface BarStats {
  fingerprint: BarFingerprint;
  /** voice-onset count (each voice at each onset counts once). */
  voiceOnsets: number;
  /** distinct onset positions. */
  onsetCount: number;
  tomOnsets: number;
  snareOnsets: number;
  kickOnsets: number;
  crashOnsets: number;
  hatOnsets: number;
  /** onsets that include a tom or snare (the "hand work" that fills add). */
  handOnsets: number;
  durationMs: number;
}

function barStats(chart: ParsedChart, fp: BarFingerprint): BarStats {
  let voiceOnsets = 0;
  let tomOnsets = 0;
  let snareOnsets = 0;
  let kickOnsets = 0;
  let crashOnsets = 0;
  let hatOnsets = 0;
  let handOnsets = 0;
  for (const onset of fp.onsets) {
    voiceOnsets += onset.voices.size;
    const hasTom = onset.voices.has('tom');
    const hasSnare = onset.voices.has('snare');
    if (hasTom) tomOnsets++;
    if (hasSnare) snareOnsets++;
    if (onset.voices.has('kick')) kickOnsets++;
    if (onset.voices.has('crash')) crashOnsets++;
    if (onset.voices.has('hat')) hatOnsets++;
    if (hasTom || hasSnare) handOnsets++;
  }
  const durationMs = Math.max(
    1,
    tickToMs(chart, fp.endTick) - tickToMs(chart, fp.startTick),
  );
  return {
    fingerprint: fp,
    voiceOnsets,
    onsetCount: fp.onsets.length,
    tomOnsets,
    snareOnsets,
    kickOnsets,
    crashOnsets,
    hatOnsets,
    handOnsets,
    durationMs,
  };
}

function tempoAt(chart: ParsedChart, tick: number): number {
  let bpm = chart.tempos[0]?.beatsPerMinute ?? 120;
  for (const t of chart.tempos) {
    if (t.tick <= tick) bpm = t.beatsPerMinute;
    else break;
  }
  return bpm;
}

/** True if a section boundary lands within `tolTicks` ticks at/after `tick`. */
function sectionNear(
  chart: ParsedChart,
  tick: number,
  tolTicks: number,
): boolean {
  for (const s of chart.sections) {
    if (Math.abs(s.tick - tick) <= tolTicks) return true;
  }
  return false;
}

/**
 * Detect fills in a parsed chart's Expert drums track.
 *
 * Returns an empty array if there is no Expert drums track or it has no notes.
 */
export function detectFills(
  chart: ParsedChart,
  options: Partial<DetectionOptions> = {},
): DetectedFill[] {
  const opts = {...DEFAULT_DETECTION_OPTIONS, ...options};
  const track = getExpertDrumsTrack(chart);
  if (!track) return [];

  const fingerprints = buildFingerprints(chart, track);
  if (fingerprints.length === 0) return [];

  const stats = fingerprints.map(fp => barStats(chart, fp));

  // Per-bar eligibility: a bar is fill-eligible if it deviates strongly from
  // the inferred local groove AND shows at least one fill signal (tom-heavy or
  // density spike), and is non-trivially dense.
  const eligible: boolean[] = new Array(fingerprints.length).fill(false);
  const grooveOf: (BarFingerprint | null)[] = new Array(
    fingerprints.length,
  ).fill(null);

  for (let i = 0; i < fingerprints.length; i++) {
    const groove = inferLocalGroove(fingerprints, i, {
      window: opts.grooveWindow,
      minCount: opts.minGrooveBars,
      similarity: opts.grooveSimilarity,
    });
    grooveOf[i] = groove;
    if (!groove) continue;

    const fp = fingerprints[i];
    if (fp.onsets.length < 2) continue;

    const dissimilarity = 1 - fingerprintSimilarity(fp, groove);
    if (dissimilarity < opts.minDissimilarity) continue;

    const grooveStats = barStats(chart, groove);
    const s = stats[i];

    const tomFraction = s.onsetCount > 0 ? s.tomOnsets / s.onsetCount : 0;

    // "Hand work" density: toms + snare onsets per bar. Fills add hand work;
    // ride/hat double-time grooves don't, so comparing hand density (not total
    // density) avoids flagging busy-cymbal grooves as fills.
    const grooveHand = Math.max(1, grooveStats.handOnsets);
    const handRatio = s.handOnsets / grooveHand;

    const tomHeavy = tomFraction >= opts.tomHeavy && s.tomOnsets >= 3;
    // A density-spike fill must (a) clearly out-pace the groove's hand work,
    // (b) add real absolute hand work (a roll), and (c) not be a plain
    // backbeat with a couple of extra kicks (require >= 6 hand onsets/bar).
    const handSpike =
      handRatio >= opts.densitySpike &&
      s.handOnsets >= grooveStats.handOnsets + 3 &&
      s.handOnsets >= 6;

    if (tomHeavy || handSpike) {
      eligible[i] = true;
    }
  }

  // Merge adjacent eligible bars into spans (cap at 2 bars).
  const spans: {startBar: number; endBar: number}[] = [];
  let i = 0;
  while (i < eligible.length) {
    if (!eligible[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < eligible.length && eligible[j + 1] && j - i < 1) {
      j++;
    }
    spans.push({startBar: i, endBar: j});
    i = j + 1;
  }

  const fills: DetectedFill[] = [];

  for (const span of spans) {
    const groove = grooveOf[span.startBar];
    if (!groove) continue;

    const startFp = fingerprints[span.startBar];
    const endFp = fingerprints[span.endBar];
    const startTick = startFp.startTick;
    const endTick = endFp.endTick;

    // Aggregate stats over span.
    let voiceOnsets = 0;
    let onsetCount = 0;
    let tomOnsets = 0;
    let snareOnsets = 0;
    let kickOnsets = 0;
    const voices = new Set<DrumVoice>();
    let lastCrash = false;
    for (let b = span.startBar; b <= span.endBar; b++) {
      const s = stats[b];
      voiceOnsets += s.voiceOnsets;
      onsetCount += s.onsetCount;
      tomOnsets += s.tomOnsets;
      snareOnsets += s.snareOnsets;
      kickOnsets += s.kickOnsets;
      for (const o of fingerprints[b].onsets) {
        for (const v of o.voices) voices.add(v);
      }
    }

    // Crash-end: last onset of the final bar contains a crash near its end OR a
    // crash lands on the downbeat of the bar following the fill.
    const finalOnsets = endFp.onsets;
    if (finalOnsets.length > 0) {
      const last = finalOnsets[finalOnsets.length - 1];
      if (last.voices.has('crash')) lastCrash = true;
    }
    // Crash on the landing downbeat (first onset of the next bar).
    const nextBar = fingerprints[span.endBar + 1];
    if (nextBar && nextBar.onsets.length > 0) {
      const first = nextBar.onsets[0];
      if (first.slot <= 2 && first.voices.has('crash')) lastCrash = true;
    }

    // --- Substance gate (plan 0045 §5) ----------------------------------
    // Reject degenerate "fills" that are really one-shot accents/pushes: a lone
    // crash on a downbeat, a crash+kick push, or a single flam. A real fill has
    // genuine rhythmic content, not just a landing hit. Require:
    //   (a) >= 3 distinct onsets in the span,
    //   (b) >= 2 onsets strictly before the final landing onset (the resolving
    //       crash/downbeat hit) — so "two setup notes + crash" is the minimum,
    //   (c) the deviating onsets span >= a quarter bar in ticks, so a cluster of
    //       grace notes right on the downbeat doesn't qualify.
    const spanOnsetTicks: number[] = [];
    for (let b = span.startBar; b <= span.endBar; b++) {
      for (const o of fingerprints[b].onsets) spanOnsetTicks.push(o.tick);
    }
    spanOnsetTicks.sort((a, b) => a - b);

    if (opts.substanceGate) {
      if (spanOnsetTicks.length < 3) continue;

      // The "final landing" is the last onset of the span (the resolving hit,
      // typically a crash on/near the downbeat). Onsets before it are the
      // fill's actual rhythmic work.
      const landingTick = spanOnsetTicks[spanOnsetTicks.length - 1];
      const onsetsBeforeLanding = spanOnsetTicks.filter(
        t => t < landingTick,
      ).length;
      if (onsetsBeforeLanding < 2) continue;

      // Deviation span: tick distance from the first to the last onset. Must
      // cover at least a quarter of the fill's first bar.
      const firstBarTicks =
        fingerprints[span.startBar].endTick -
        fingerprints[span.startBar].startTick;
      const quarterBarTicks = firstBarTicks / 4;
      const deviationSpanTicks =
        spanOnsetTicks[spanOnsetTicks.length - 1] - spanOnsetTicks[0];
      if (deviationSpanTicks < quarterBarTicks) continue;
    }
    // --------------------------------------------------------------------

    const grooveStats = barStats(chart, groove);
    const spanDurationMs = Math.max(
      1,
      tickToMs(chart, endTick) - tickToMs(chart, startTick),
    );
    const grooveNps = grooveStats.voiceOnsets / (grooveStats.durationMs / 1000);
    const nps = voiceOnsets / (spanDurationMs / 1000);
    // Cap the ratio: a near-silent groove baseline shouldn't yield a huge,
    // meaningless multiplier.
    const densityRatio = grooveNps > 0 ? Math.min(4, nps / grooveNps) : 1;
    const tomFraction = onsetCount > 0 ? tomOnsets / onsetCount : 0;
    const snareFraction = onsetCount > 0 ? snareOnsets / onsetCount : 0;
    const kickFraction = onsetCount > 0 ? kickOnsets / onsetCount : 0;

    // Dissimilarity averaged over the span's bars.
    let dissimSum = 0;
    for (let b = span.startBar; b <= span.endBar; b++) {
      dissimSum += 1 - fingerprintSimilarity(fingerprints[b], groove);
    }
    const grooveDissimilarity = dissimSum / (span.endBar - span.startBar + 1);

    const resolution = chart.resolution;
    const endsAtSection = sectionNear(chart, endTick, resolution / 2);

    const features: FillFeatures = {
      onsetCount,
      notesPerSecond: nps,
      grooveNotesPerSecond: grooveNps,
      densityRatio,
      tomFraction,
      snareFraction,
      kickFraction,
      grooveDissimilarity,
      endsOnCrash: lastCrash,
      endsAtSection,
      voiceCount: voices.size,
    };

    const confidence = scoreFill(features);
    if (confidence < opts.minConfidence) continue;

    // Groove span = up to 2 preceding bars.
    const grooveStartBar = Math.max(0, span.startBar - 2);
    const grooveStartTick = fingerprints[grooveStartBar].startTick;

    fills.push({
      startTick,
      endTick,
      grooveStartTick,
      grooveEndTick: startTick,
      tempoBpm: tempoAt(chart, startTick),
      confidence,
      features,
    });
  }

  return fills;
}

/**
 * Heuristic confidence score for a candidate fill, in [0, 1].
 *
 * Combines groove departure, density spike, tom emphasis, and a crash-end
 * bonus. Tuned against the real library spot-check.
 */
export function scoreFill(features: FillFeatures): number {
  const dissim = clamp01(features.grooveDissimilarity);

  // Density: map ratio [1, 2.5] -> [0, 1].
  const density = clamp01((features.densityRatio - 1) / 1.5);

  // Tom emphasis: fraction [0, 0.6] -> [0, 1].
  const tom = clamp01(features.tomFraction / 0.6);

  let score =
    0.4 * dissim + 0.3 * density + 0.2 * tom + (features.endsOnCrash ? 0.1 : 0);

  if (features.endsAtSection) score += 0.05;

  // Require some real departure: dampen if dissimilarity is low.
  if (dissim < 0.3) score *= 0.6;

  return clamp01(score);
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
