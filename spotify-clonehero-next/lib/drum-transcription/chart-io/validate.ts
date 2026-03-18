/**
 * Pre-write validation for ChartDocument.
 *
 * Errors are thrown (or auto-fixed). Warnings are collected and returned.
 * The returned document may differ from the input (auto-corrections applied).
 */

import type {ChartDocument, ValidationResult} from './types';

/**
 * Validate a ChartDocument before serialization.
 *
 * Auto-fixes:
 *   - Missing tempo at tick 0 -> inserts 120 BPM
 *   - Missing time signature at tick 0 -> inserts 4/4
 *   - Unsorted notes -> sorts by tick
 *   - Duplicate notes (same type+tick) -> deduplicates
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
    resolution: doc.resolution,
    metadata: {...doc.metadata},
    tempos: doc.tempos.map(t => ({...t})),
    timeSignatures: doc.timeSignatures.map(ts => ({...ts})),
    sections: doc.sections.map(s => ({...s})),
    endEvents: doc.endEvents.map(e => ({...e})),
    tracks: doc.tracks.map(t => ({
      ...t,
      notes: t.notes.map(n => ({...n, flags: {...n.flags}})),
      starPower: t.starPower?.map(sp => ({...sp})),
      activationLanes: t.activationLanes?.map(al => ({...al})),
    })),
  };

  // --- Resolution ---
  if (
    !Number.isInteger(result.resolution) ||
    result.resolution <= 0
  ) {
    errors.push(
      `Resolution must be a positive integer, got ${result.resolution}`,
    );
  }

  // --- Tempos ---
  // Check for negative ticks
  for (const tempo of result.tempos) {
    if (tempo.tick < 0) {
      errors.push(`Negative tick value in tempo: ${tempo.tick}`);
    }
  }

  // Check for zero/negative BPM
  for (const tempo of result.tempos) {
    if (tempo.bpm <= 0) {
      errors.push(`Zero or negative BPM: ${tempo.bpm} at tick ${tempo.tick}`);
    }
  }

  // Auto-fix: ensure tempo at tick 0
  if (!result.tempos.some(t => t.tick === 0)) {
    result.tempos.unshift({tick: 0, bpm: 120});
    warnings.push('No tempo at tick 0; inserted default 120 BPM');
  }

  // Sort tempos by tick
  result.tempos.sort((a, b) => a.tick - b.tick);

  // Warn on extreme BPM values
  for (const tempo of result.tempos) {
    if (tempo.bpm > 300) {
      warnings.push(
        `Very high BPM (${tempo.bpm}) at tick ${tempo.tick}; likely an error`,
      );
    }
    if (tempo.bpm > 0 && tempo.bpm < 20) {
      warnings.push(
        `Very low BPM (${tempo.bpm}) at tick ${tempo.tick}; likely an error`,
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
    if (ts.denominator > 0 && !Number.isInteger(Math.log2(ts.denominator))) {
      errors.push(
        `Denominator must be a power of 2: ${ts.denominator} at tick ${ts.tick}`,
      );
    }
  }

  // Auto-fix: ensure time signature at tick 0
  if (!result.timeSignatures.some(ts => ts.tick === 0)) {
    result.timeSignatures.unshift({tick: 0, numerator: 4, denominator: 4});
    warnings.push('No time signature at tick 0; inserted default 4/4');
  }

  // Sort time signatures by tick
  result.timeSignatures.sort((a, b) => a.tick - b.tick);

  // --- Sections ---
  // Sort sections by tick
  result.sections.sort((a, b) => a.tick - b.tick);

  if (result.sections.length === 0) {
    warnings.push('No section markers in chart');
  }

  // --- isDefaultBPM warning ---
  if (
    result.tempos.length === 1 &&
    result.tempos[0].bpm === 120 &&
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

  for (const track of result.tracks) {
    // Check for negative ticks in notes
    for (const note of track.notes) {
      if (note.tick < 0) {
        errors.push(
          `Negative tick value in note: ${note.tick} (${note.type})`,
        );
      }
    }

    // Auto-sort notes by tick
    const wasSorted = track.notes.every(
      (n, i) => i === 0 || n.tick >= track.notes[i - 1].tick,
    );
    if (!wasSorted) {
      track.notes.sort((a, b) => a.tick - b.tick);
      warnings.push(
        `Notes not sorted by tick in ${track.difficulty} ${track.instrument}; auto-sorted`,
      );
    }

    // Deduplicate notes (same type at same tick)
    const seen = new Set<string>();
    const deduped: typeof track.notes = [];
    for (const note of track.notes) {
      const key = `${note.tick}:${note.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(note);
      }
    }
    if (deduped.length < track.notes.length) {
      warnings.push(
        `Duplicate notes removed in ${track.difficulty} ${track.instrument}: ${track.notes.length - deduped.length} duplicates`,
      );
      track.notes = deduped;
    }

    if (track.notes.length > 0) {
      hasAnyNotes = true;
    }

    // Warn: cymbal on red
    for (const note of track.notes) {
      if (note.type === 'red' && note.flags.cymbal) {
        warnings.push(
          `Cymbal flag on red drum at tick ${note.tick}; red has no cymbal marker (flag will be ignored)`,
        );
      }
    }

    // Warn: double kick on non-Expert
    if (track.difficulty !== 'expert') {
      for (const note of track.notes) {
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
      `Chart validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`,
    );
  }

  return {errors, warnings, document: result};
}
