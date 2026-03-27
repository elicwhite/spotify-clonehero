/**
 * Pre-write validation for ChartDocument (chart-edit version).
 *
 * Errors are thrown. Warnings are collected and returned.
 * The returned document may differ from the input (auto-corrections applied).
 */

import type { ChartDocument } from '@/lib/chart-edit';
import { getDrumNotes } from '@/lib/chart-edit';
import type { ValidationResult } from './chart-types';

/**
 * Validate a ChartDocument before serialization.
 *
 * Auto-fixes:
 *   - Missing tempo at tick 0 -> inserts 120 BPM
 *   - Missing time signature at tick 0 -> inserts 4/4
 *   - Unsorted trackEvents -> sorts by tick
 *   - Duplicate trackEvents (same type+tick) -> deduplicates
 *
 * Errors (throws):
 *   - Zero or negative BPM
 *   - Zero numerator or denominator
 *   - Denominator not a power of 2
 *   - Resolution not a positive integer
 *   - Negative tick values
 */
export function validateChart(doc: ChartDocument): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Deep copy to avoid mutating the original
  const result: ChartDocument = {
    ...doc,
    tempos: doc.tempos.map((t) => ({ ...t })),
    timeSignatures: doc.timeSignatures.map((ts) => ({ ...ts })),
    sections: doc.sections.map((s) => ({ ...s })),
    endEvents: doc.endEvents.map((e) => ({ ...e })),
    lyrics: doc.lyrics.map((l) => ({ ...l })),
    vocalPhrases: doc.vocalPhrases.map((p) => ({ ...p })),
    trackData: doc.trackData.map((t) => ({
      ...t,
      trackEvents: t.trackEvents.map((e) => ({ ...e })),
      starPowerSections: t.starPowerSections.map((sp) => ({ ...sp })),
      rejectedStarPowerSections: t.rejectedStarPowerSections.map((sp) => ({
        ...sp,
      })),
      soloSections: t.soloSections.map((s) => ({ ...s })),
      flexLanes: t.flexLanes.map((f) => ({ ...f })),
      drumFreestyleSections: t.drumFreestyleSections.map((fs) => ({ ...fs })),
    })),
    metadata: { ...doc.metadata },
    assets: [...doc.assets],
  };

  // --- Resolution ---
  if (
    !Number.isInteger(result.chartTicksPerBeat) ||
    result.chartTicksPerBeat <= 0
  ) {
    errors.push(
      `Resolution must be a positive integer, got ${result.chartTicksPerBeat}`,
    );
  }

  // --- Tempos ---
  for (const tempo of result.tempos) {
    if (tempo.tick < 0) {
      errors.push(`Negative tick value in tempo: ${tempo.tick}`);
    }
    if (tempo.beatsPerMinute <= 0) {
      errors.push(
        `Zero or negative BPM: ${tempo.beatsPerMinute} at tick ${tempo.tick}`,
      );
    }
  }

  // Auto-fix: ensure tempo at tick 0
  if (!result.tempos.some((t) => t.tick === 0)) {
    result.tempos.unshift({ tick: 0, beatsPerMinute: 120 });
    warnings.push('No tempo at tick 0; inserted default 120 BPM');
  }

  result.tempos.sort((a, b) => a.tick - b.tick);

  // Warn on extreme BPM values
  for (const tempo of result.tempos) {
    if (tempo.beatsPerMinute > 300) {
      warnings.push(
        `Very high BPM (${tempo.beatsPerMinute}) at tick ${tempo.tick}; likely an error`,
      );
    }
    if (tempo.beatsPerMinute > 0 && tempo.beatsPerMinute < 20) {
      warnings.push(
        `Very low BPM (${tempo.beatsPerMinute}) at tick ${tempo.tick}; likely an error`,
      );
    }
  }

  // --- Time Signatures ---
  for (const ts of result.timeSignatures) {
    if (ts.tick < 0) {
      errors.push(`Negative tick value in time signature: ${ts.tick}`);
    }
    if (ts.numerator <= 0) {
      errors.push(
        `Zero or negative numerator: ${ts.numerator} at tick ${ts.tick}`,
      );
    }
    if (ts.denominator <= 0) {
      errors.push(
        `Zero or negative denominator: ${ts.denominator} at tick ${ts.tick}`,
      );
    }
    if (
      ts.denominator > 0 &&
      !Number.isInteger(Math.log2(ts.denominator))
    ) {
      errors.push(
        `Denominator must be a power of 2: ${ts.denominator} at tick ${ts.tick}`,
      );
    }
  }

  if (!result.timeSignatures.some((ts) => ts.tick === 0)) {
    result.timeSignatures.unshift({
      tick: 0,
      numerator: 4,
      denominator: 4,
    });
    warnings.push('No time signature at tick 0; inserted default 4/4');
  }

  result.timeSignatures.sort((a, b) => a.tick - b.tick);

  // --- Sections ---
  result.sections.sort((a, b) => a.tick - b.tick);

  if (result.sections.length === 0) {
    warnings.push('No section markers in chart');
  }

  // --- Default BPM warning ---
  if (
    result.tempos.length === 1 &&
    result.tempos[0].beatsPerMinute === 120 &&
    result.timeSignatures.length === 1 &&
    result.timeSignatures[0].numerator === 4 &&
    result.timeSignatures[0].denominator === 4
  ) {
    warnings.push(
      'Only one 120 BPM marker and 4/4 time sig (probably untempo-mapped)',
    );
  }

  // --- Tracks ---
  let hasAnyNotes = false;

  for (const track of result.trackData) {
    if (track.instrument !== 'drums') continue;

    // Check for negative ticks
    for (const ev of track.trackEvents) {
      if (ev.tick < 0) {
        errors.push(
          `Negative tick value in track event: ${ev.tick} (type ${ev.type})`,
        );
      }
    }

    // Auto-sort trackEvents by tick
    const wasSorted = track.trackEvents.every(
      (e, i) => i === 0 || e.tick >= track.trackEvents[i - 1].tick,
    );
    if (!wasSorted) {
      track.trackEvents.sort((a, b) => a.tick - b.tick);
      warnings.push(
        `Track events not sorted by tick in ${track.difficulty} ${track.instrument}; auto-sorted`,
      );
    }

    // Deduplicate trackEvents (same type at same tick)
    const seen = new Set<string>();
    const deduped: typeof track.trackEvents = [];
    for (const ev of track.trackEvents) {
      const key = `${ev.tick}:${ev.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(ev);
      }
    }
    if (deduped.length < track.trackEvents.length) {
      warnings.push(
        `Duplicate events removed in ${track.difficulty} ${track.instrument}: ${track.trackEvents.length - deduped.length} duplicates`,
      );
      track.trackEvents = deduped;
    }

    if (track.trackEvents.length > 0) {
      hasAnyNotes = true;
    }

    // Use getDrumNotes for typed checks
    const drumNotes = getDrumNotes(track);

    // Warn: cymbal on red
    for (const note of drumNotes) {
      if (note.type === 'redDrum' && note.flags.cymbal) {
        warnings.push(
          `Cymbal flag on red drum at tick ${note.tick}; red has no cymbal marker (flag will be ignored)`,
        );
      }
    }

    // Warn: double kick on non-Expert
    if (track.difficulty !== 'expert') {
      for (const note of drumNotes) {
        if (note.type === 'kick' && note.flags.doubleKick) {
          warnings.push(
            `Double kick on ${track.difficulty} difficulty at tick ${note.tick}; should only appear on Expert`,
          );
        }
      }
    }
  }

  if (!hasAnyNotes) {
    warnings.push('No notes in any track');
  }

  if (errors.length > 0) {
    throw new Error(
      `Chart validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }

  return { errors, warnings, document: result };
}
