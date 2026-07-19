/**
 * Tests for `prospectiveNoteAt` — the shared "what note would a click add"
 * computation the highway placement, the piano-roll placement, and the
 * piano-roll add-mode ghost preview all funnel through. If these three ever
 * disagreed, the ghost would predict a different note than the click places.
 */

import {prospectiveNoteAt} from '../prospectiveNote';

describe('prospectiveNoteAt', () => {
  // Editor lanes: 0 kick, 1 red, 2 yellow, 3 blue, 4 green.
  it('maps each lane to its drum type', () => {
    expect(prospectiveNoteAt(0, 0).type).toBe('kick');
    expect(prospectiveNoteAt(1, 0).type).toBe('redDrum');
    expect(prospectiveNoteAt(2, 0).type).toBe('yellowDrum');
    expect(prospectiveNoteAt(3, 0).type).toBe('blueDrum');
    expect(prospectiveNoteAt(4, 0).type).toBe('greenDrum');
  });

  it('passes the already-snapped tick through unchanged', () => {
    expect(prospectiveNoteAt(2, 720).tick).toBe(720);
    expect(prospectiveNoteAt(0, 0).tick).toBe(0);
  });

  it('defaults cymbal-legal lanes (yellow/blue/green) to cymbals', () => {
    for (const lane of [2, 3, 4]) {
      const p = prospectiveNoteAt(lane, 480);
      expect(p.cymbal).toBe(true);
      expect(p.flags.cymbal).toBe(true);
    }
  });

  it('never marks kick or red as a cymbal (§6 lane legality)', () => {
    for (const lane of [0, 1]) {
      const p = prospectiveNoteAt(lane, 480);
      expect(p.cymbal).toBe(false);
      expect(p.flags.cymbal).toBeUndefined();
    }
  });

  it('reports the queried lane back on the result', () => {
    expect(prospectiveNoteAt(3, 240).lane).toBe(3);
  });
});
