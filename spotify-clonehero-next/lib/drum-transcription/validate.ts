/**
 * Pre-write validation for ChartDocument (chart-edit version).
 *
 * Errors are thrown. Warnings are collected and returned.
 * The returned document may differ from the input (auto-corrections applied).
 */

import type {ChartDocument} from '@/lib/chart-edit';
import {getDrumNotes} from '@/lib/chart-edit';
import type {ValidationResult} from './chart-types';

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

  // Deep copy to avoid mutating the original. Parsed-chart fields live on
  // `.parsedChart`; clone that subtree explicitly so the validator can
  // mutate without touching the input doc.
  const chart = doc.parsedChart;
  const result: ChartDocument = {
    parsedChart: {
      ...chart,
      metadata: {...chart.metadata},
      tempos: chart.tempos.map(t => ({...t})),
      timeSignatures: chart.timeSignatures.map(ts => ({...ts})),
      sections: chart.sections.map(s => ({...s})),
      endEvents: chart.endEvents.map(e => ({...e})),
      trackData: chart.trackData.map(t => ({
        ...t,
        noteEventGroups: t.noteEventGroups.map(g => g.map(n => ({...n}))),
        starPowerSections: t.starPowerSections.map(sp => ({...sp})),
        rejectedStarPowerSections: t.rejectedStarPowerSections.map(sp => ({
          ...sp,
        })),
        soloSections: t.soloSections.map(s => ({...s})),
        flexLanes: t.flexLanes.map(f => ({...f})),
        drumFreestyleSections: t.drumFreestyleSections.map(fs => ({...fs})),
      })),
    },
    assets: [...doc.assets],
  };

  // --- Resolution ---
  if (
    !Number.isInteger(result.parsedChart.resolution) ||
    result.parsedChart.resolution <= 0
  ) {
    errors.push(
      `Resolution must be a positive integer, got ${result.parsedChart.resolution}`,
    );
  }

  // --- Tempos ---
  for (const tempo of result.parsedChart.tempos) {
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
  if (!result.parsedChart.tempos.some(t => t.tick === 0)) {
    result.parsedChart.tempos.unshift({
      tick: 0,
      beatsPerMinute: 120,
      msTime: 0,
    });
    warnings.push('No tempo at tick 0; inserted default 120 BPM');
  }

  result.parsedChart.tempos.sort((a, b) => a.tick - b.tick);

  // Warn on extreme BPM values
  for (const tempo of result.parsedChart.tempos) {
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
  for (const ts of result.parsedChart.timeSignatures) {
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

  if (!result.parsedChart.timeSignatures.some(ts => ts.tick === 0)) {
    result.parsedChart.timeSignatures.unshift({
      tick: 0,
      numerator: 4,
      denominator: 4,
      msTime: 0,
      msLength: 0,
    });
    warnings.push('No time signature at tick 0; inserted default 4/4');
  }

  result.parsedChart.timeSignatures.sort((a, b) => a.tick - b.tick);

  // --- Sections ---
  result.parsedChart.sections.sort((a, b) => a.tick - b.tick);

  if (result.parsedChart.sections.length === 0) {
    warnings.push('No section markers in chart');
  }

  // --- Default BPM warning ---
  if (
    result.parsedChart.tempos.length === 1 &&
    result.parsedChart.tempos[0].beatsPerMinute === 120 &&
    result.parsedChart.timeSignatures.length === 1 &&
    result.parsedChart.timeSignatures[0].numerator === 4 &&
    result.parsedChart.timeSignatures[0].denominator === 4
  ) {
    warnings.push(
      'Only one 120 BPM marker and 4/4 time sig (probably untempo-mapped)',
    );
  }

  // --- Tracks ---
  let hasAnyNotes = false;

  for (const track of result.parsedChart.trackData) {
    if (track.instrument !== 'drums') continue;

    // Check for negative ticks
    for (const group of track.noteEventGroups) {
      for (const ev of group) {
        if (ev.tick < 0) {
          errors.push(
            `Negative tick value in track event: ${ev.tick} (type ${ev.type})`,
          );
        }
      }
    }

    // Auto-sort noteEventGroups by the group's leading tick
    const wasSorted = track.noteEventGroups.every(
      (g, i) =>
        i === 0 ||
        (g[0]?.tick ?? 0) >= (track.noteEventGroups[i - 1][0]?.tick ?? 0),
    );
    if (!wasSorted) {
      track.noteEventGroups.sort(
        (a, b) => (a[0]?.tick ?? 0) - (b[0]?.tick ?? 0),
      );
      warnings.push(
        `Track events not sorted by tick in ${track.difficulty} ${track.instrument}; auto-sorted`,
      );
    }

    // Deduplicate notes (same type at same tick) across all groups on this track.
    // Collapses duplicate groups and duplicate events-within-groups.
    const seen = new Set<string>();
    let totalNotesBefore = 0;
    let totalNotesAfter = 0;
    const dedupedGroups: typeof track.noteEventGroups = [];
    for (const group of track.noteEventGroups) {
      totalNotesBefore += group.length;
      const dedupedGroup: typeof group = [];
      for (const ev of group) {
        const key = `${ev.tick}:${ev.type}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedupedGroup.push(ev);
        }
      }
      totalNotesAfter += dedupedGroup.length;
      if (dedupedGroup.length > 0) dedupedGroups.push(dedupedGroup);
    }
    track.noteEventGroups = dedupedGroups;
    if (totalNotesAfter < totalNotesBefore) {
      warnings.push(
        `Duplicate events removed in ${track.difficulty} ${track.instrument}: ${totalNotesBefore - totalNotesAfter} duplicates`,
      );
    }

    if (totalNotesAfter > 0) {
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
      `Chart validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`,
    );
  }

  return {errors, warnings, document: result};
}
