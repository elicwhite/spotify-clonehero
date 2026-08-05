/**
 * Tests for the EntityAffordance registry.
 *
 * Two responsibilities:
 *   1. Pin the affordance shape per kind (positive tests).
 *   2. Prevent behavior from leaking into the registry (negative tests).
 *      The registry is purely declarative metadata; if a future PR adds
 *      `onDelete` / `onDoubleClick` / `endpointAlias` / a `draggable` enum
 *      directly on the affordance object, these tests fail and force the
 *      author to put behavior on the tool instead.
 */

import {AFFORDANCES, type EntityAffordance} from '../affordances';
import type {EntityKind} from '@/lib/chart-edit';

describe('AFFORDANCES registry', () => {
  const kinds: EntityKind[] = [
    'note',
    'section',
    'lyric',
    'phrase-start',
    'phrase-end',
  ];

  it('declares an affordance for every entity kind', () => {
    for (const kind of kinds) {
      expect(AFFORDANCES[kind]).toBeDefined();
      expect(AFFORDANCES[kind].kind).toBe(kind);
    }
  });

  it('note: hoverable + selectable + deletable + laneAxis (drum lane drag)', () => {
    expect(AFFORDANCES.note).toEqual<EntityAffordance>({
      kind: 'note',
      hoverable: true,
      selectable: true,
      deletable: true,
      laneAxis: true,
    });
  });

  it('section: hoverable + selectable + deletable', () => {
    expect(AFFORDANCES.section).toEqual<EntityAffordance>({
      kind: 'section',
      hoverable: true,
      selectable: true,
      deletable: true,
      laneAxis: false,
    });
  });

  it('lyric: hoverable + selectable + deletable', () => {
    expect(AFFORDANCES.lyric).toEqual<EntityAffordance>({
      kind: 'lyric',
      hoverable: true,
      selectable: true,
      deletable: true,
      laneAxis: false,
    });
  });

  it('phrase-start: hoverable + selectable + deletable', () => {
    expect(AFFORDANCES['phrase-start']).toEqual<EntityAffordance>({
      kind: 'phrase-start',
      hoverable: true,
      selectable: true,
      deletable: true,
      laneAxis: false,
    });
  });

  it('phrase-end: hoverable + selectable + deletable', () => {
    expect(AFFORDANCES['phrase-end']).toEqual<EntityAffordance>({
      kind: 'phrase-end',
      hoverable: true,
      selectable: true,
      deletable: true,
      laneAxis: false,
    });
  });

  // -----------------------------------------------------------------------
  // Negative tests: prevent behavior from leaking into the registry
  // -----------------------------------------------------------------------

  it('no kind exposes onDoubleClick / onDelete / endpointAlias / draggable enum', () => {
    const expectedKeys = new Set([
      'kind',
      'hoverable',
      'selectable',
      'deletable',
      'laneAxis',
    ]);
    for (const kind of kinds) {
      const a = AFFORDANCES[kind] as unknown as Record<string, unknown>;
      const extra = Object.keys(a).filter(k => !expectedKeys.has(k));
      expect(extra).toEqual([]);
    }
  });

  it('all flag fields are booleans (not enums or callbacks)', () => {
    for (const kind of kinds) {
      const a = AFFORDANCES[kind];
      expect(typeof a.hoverable).toBe('boolean');
      expect(typeof a.selectable).toBe('boolean');
      expect(typeof a.deletable).toBe('boolean');
      expect(typeof a.laneAxis).toBe('boolean');
    }
  });
});
