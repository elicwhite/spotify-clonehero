/**
 * Tests for `prospectiveNoteAt` — the shared "what note would a click add"
 * computation the highway placement, the piano-roll placement, and the
 * piano-roll add-mode ghost preview all funnel through. If these three ever
 * disagreed, the ghost would predict a different note than the click places.
 */

import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import {guitarSchema} from '@/lib/chart-edit';
import {prospectiveNoteAt} from '../prospectiveNote';

describe('prospectiveNoteAt', () => {
  // Editor lanes: 0 red, 1 yellow, 2 blue, 3 green, 4 kick.
  it('maps each lane to its drum type', () => {
    expect(prospectiveNoteAt(0, 0).type).toBe(noteTypes.redDrum);
    expect(prospectiveNoteAt(1, 0).type).toBe(noteTypes.yellowDrum);
    expect(prospectiveNoteAt(2, 0).type).toBe(noteTypes.blueDrum);
    expect(prospectiveNoteAt(3, 0).type).toBe(noteTypes.greenDrum);
    expect(prospectiveNoteAt(4, 0).type).toBe(noteTypes.kick);
  });

  it('passes the already-snapped tick through unchanged', () => {
    expect(prospectiveNoteAt(1, 720).tick).toBe(720);
    expect(prospectiveNoteAt(4, 0).tick).toBe(0);
  });

  it('defaults cymbal-legal lanes (yellow/blue/green) to cymbals', () => {
    for (const lane of [1, 2, 3]) {
      const p = prospectiveNoteAt(lane, 480);
      expect(p.cymbal).toBe(true);
      expect(p.flags & noteFlags.cymbal).toBeTruthy();
    }
  });

  it('never marks kick or red as a cymbal (§6 lane legality)', () => {
    for (const lane of [4, 0]) {
      const p = prospectiveNoteAt(lane, 480);
      expect(p.cymbal).toBe(false);
      expect(p.flags & noteFlags.cymbal).toBeFalsy();
    }
  });

  it('reports the queried lane back on the result', () => {
    expect(prospectiveNoteAt(3, 240).lane).toBe(3);
  });

  // Parity: the schema parameter generalizes cleanly to a non-drum
  // InstrumentSchema (plan 0037 Task 4) — no cymbal-default lane, no
  // kick-like excluded lane.
  it('resolves lanes for guitarSchema (open/green/red/yellow/blue/orange)', () => {
    expect(prospectiveNoteAt(0, 0, guitarSchema).type).toBe(noteTypes.open);
    expect(prospectiveNoteAt(1, 0, guitarSchema).type).toBe(noteTypes.green);
    expect(prospectiveNoteAt(5, 0, guitarSchema).type).toBe(noteTypes.orange);
    expect(prospectiveNoteAt(1, 0, guitarSchema).cymbal).toBe(false);
  });
});
