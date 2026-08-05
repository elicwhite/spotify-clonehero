/**
 * Tests for reconcilerKeyFor — the single utility that maps editor
 * selection ids to reconciler keys per entity kind.
 *
 * The most likely silent-failure mode here is a key-format drift:
 * selection state stores `2880:yellowDrum` but the reconciler keys
 * its element by `note:2880:yellowDrum`, and the wrong concatenation
 * highlights nothing. These tests pin the contract.
 */

import {reconcilerKeyFor} from '../reconcilerKey';
import {lyricId, phraseEndId, phraseStartId} from '@/lib/chart-edit';

describe('reconcilerKeyFor', () => {
  describe('chart-wide kinds (note, section)', () => {
    it('note: id is tick:type → key is note:tick:type', () => {
      expect(reconcilerKeyFor('note', '2880:yellowDrum')).toBe(
        'note:2880:yellowDrum',
      );
    });

    it('note: partName is ignored if passed', () => {
      expect(reconcilerKeyFor('note', '2880:yellowDrum', 'vocals')).toBe(
        'note:2880:yellowDrum',
      );
      expect(reconcilerKeyFor('note', '2880:yellowDrum', 'harm1')).toBe(
        'note:2880:yellowDrum',
      );
    });

    it('section: id is tick → key is section:tick', () => {
      expect(reconcilerKeyFor('section', '2880')).toBe('section:2880');
    });

    it('section: partName is ignored if passed', () => {
      expect(reconcilerKeyFor('section', '2880', 'harm1')).toBe('section:2880');
    });
  });

  describe('vocal kinds (lyric, phrase-start, phrase-end)', () => {
    it('lyric: id encodes partName → key matches existing vocalMarkerKey format', () => {
      const id = lyricId(480, 'harm1');
      expect(reconcilerKeyFor('lyric', id, 'harm1')).toBe('lyric:harm1:480');
    });

    it('phrase-start: id encodes partName → key matches', () => {
      const id = phraseStartId(960, 'harm2');
      expect(reconcilerKeyFor('phrase-start', id, 'harm2')).toBe(
        'phrase-start:harm2:960',
      );
    });

    it('phrase-end: id encodes endTick → key matches', () => {
      const id = phraseEndId(1920, 'harm3');
      expect(reconcilerKeyFor('phrase-end', id, 'harm3')).toBe(
        'phrase-end:harm3:1920',
      );
    });

    it('default vocals partName: lyric:vocals:480', () => {
      const id = lyricId(480, 'vocals');
      expect(reconcilerKeyFor('lyric', id, 'vocals')).toBe('lyric:vocals:480');
    });
  });

  describe('consumer-side: translating a selection map', () => {
    it('translates Map<EntityKind, Set<string>> to a Set<reconciler-key>', () => {
      const selection = new Map<string, Set<string>>([
        ['note', new Set(['2880:yellowDrum', '3360:redDrum'])],
        ['section', new Set(['480'])],
        ['lyric', new Set([lyricId(960, 'harm1')])],
        ['phrase-start', new Set([phraseStartId(120, 'harm1')])],
        ['phrase-end', new Set([phraseEndId(2400, 'harm2')])],
      ]);

      const out = new Set<string>();
      for (const [kind, ids] of selection) {
        for (const id of ids) {
          out.add(reconcilerKeyFor(kind as any, id, 'harm1'));
        }
      }

      expect(out).toEqual(
        new Set([
          'note:2880:yellowDrum',
          'note:3360:redDrum',
          'section:480',
          'lyric:harm1:960',
          'phrase-start:harm1:120',
          'phrase-end:harm2:2400',
        ]),
      );
    });
  });
});
