/**
 * The pacing rules: reading time from the words themselves, the maximum
 * hold, nothing moving while copy is read, and results that hold before the
 * next headline or camera move.
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  PACING_RULES,
  auditPacing,
  countWords,
  withRules,
  type PacingSheet,
  type TextBlock,
} from '../scripts/qa/pacing';

const FPS = 30;
const sec = (s: number) => Math.round(s * FPS);

/** A headline of three words: needs 0.8 + 3 * 0.3 = 1.7 s, at most 2.9 s. */
const headline = (
  fullyIn: number,
  heldSec: number,
  id = 'filters',
): TextBlock => ({
  id,
  kind: 'headline',
  words: 'Filter by instrument.',
  fullyIn,
  out: fullyIn + sec(heldSec),
});

const sheet = (parts: Partial<PacingSheet>): PacingSheet => ({
  fps: FPS,
  text: [],
  actions: [],
  camera: [],
  ...parts,
});

const failuresOf = (s: PacingSheet) => auditPacing(s).failures;

describe('countWords', () => {
  it('counts words from the text, not symbols', () => {
    assert.equal(countWords('Your library is already a setlist.'), 6);
    assert.equal(
      countWords('Spotify, Apple Music, or your streaming history.'),
      7,
    );
    assert.equal(countWords('✓ Installed'), 1);
    assert.equal(countWords(['Find', 'Music']), 2);
    assert.equal(countWords('  '), 0);
  });
});

describe('reading time and maximum hold', () => {
  it('passes a block held between its reading time and the maximum', () => {
    const {rows, failures} = auditPacing(
      sheet({text: [headline(sec(1), 2.0)]}),
    );
    assert.deepEqual(failures, []);
    assert.equal(rows[0]!.words, 3);
    assert.ok(Math.abs(rows[0]!.needSec - 1.7) < 1e-9);
    assert.ok(Math.abs(rows[0]!.maxSec! - 2.9) < 1e-9);
  });

  it('fails a block too short to read, and one that drags', () => {
    assert.match(
      failuresOf(sheet({text: [headline(sec(1), 1.5)]}))[0]!,
      /held 1\.50s, needs 1\.70s/,
    );
    assert.match(
      failuresOf(sheet({text: [headline(sec(1), 3.0)]}))[0]!,
      /drags past 2\.90s/,
    );
  });

  it('exempts the end card from the maximum hold', () => {
    assert.deepEqual(
      failuresOf(sheet({text: [headline(sec(1), 5, 'end-card')]})),
      [],
    );
  });

  it('uses a fixed reading time for a ledger and words / 3.5 for a callout', () => {
    const {rows} = auditPacing(
      sheet({
        text: [
          {
            id: 'why',
            kind: 'ledger',
            words: 'Every score shows its work',
            fullyIn: 0,
            out: sec(3),
          },
          {
            id: 'note',
            kind: 'callout',
            words: 'Straight into your Songs folder.',
            fullyIn: 0,
            out: sec(2),
          },
        ],
      }),
    );
    assert.ok(Math.abs(rows[0]!.needSec - 2.3) < 1e-9);
    assert.ok(Math.abs(rows[1]!.needSec - (0.5 + 5 / 3.5)) < 1e-9);
  });

  it('rejects a typed-in word count and an unknown kind', () => {
    const counted = {...headline(0, 2), words: 3 as unknown as string};
    assert.throws(() => auditPacing(sheet({text: [counted]})), /not a count/);
    assert.throws(
      () => auditPacing(sheet({text: [{...headline(0, 2), kind: 'caption'}]})),
      /no reading rule/,
    );
  });
});

describe('nothing moves while copy is read', () => {
  it('fails a camera move inside the reading window, passes one after it', () => {
    const text = [headline(sec(1), 2.0)];
    assert.match(
      failuresOf(sheet({text, camera: [{from: sec(2), to: sec(2.5)}]}))[0]!,
      /camera moves/,
    );
    assert.deepEqual(
      failuresOf(sheet({text, camera: [{from: sec(2.8), to: sec(3.2)}]})),
      [],
    );
  });

  it('fails an action that lands before a headline is read', () => {
    const failures = failuresOf(
      sheet({
        text: [headline(sec(1), 2.0)],
        actions: [{id: 'click', at: sec(2)}],
      }),
    );
    assert.ok(
      failures.some(f => /action "click" .* before it is read/.test(f)),
      failures.join(' | '),
    );
  });
});

describe('results hold', () => {
  it('fails a headline that arrives too soon after an action', () => {
    // Fully in at 2.2 s, so its words start at 1.6 s: 0.6 s after the click.
    const failures = failuresOf(
      sheet({
        text: [headline(sec(2.2), 2.0)],
        actions: [{id: 'click', at: sec(1)}],
      }),
    );
    assert.ok(
      failures.some(f => /starts arriving 0\.60s after action "click"/.test(f)),
      failures.join(' | '),
    );
  });

  it('lets an action with no result of its own go by', () => {
    const failures = failuresOf(
      sheet({
        text: [headline(sec(2.2), 2.0)],
        actions: [{id: 'rows', at: sec(1), holds: false}],
      }),
    );
    assert.deepEqual(failures, []);
  });

  it('fails an action that lands while the camera moves, unless it holds no result', () => {
    const camera = [{from: sec(0.8), to: sec(1.5)}];
    assert.match(
      failuresOf(sheet({actions: [{id: 'click', at: sec(1)}], camera}))[0]!,
      /lands while the camera moves/,
    );
    assert.match(
      failuresOf(sheet({actions: [{id: 'click', at: sec(0.8)}], camera}))[0]!,
      /lands while the camera moves/,
    );
    assert.deepEqual(
      failuresOf(
        sheet({actions: [{id: 'rows', at: sec(1), holds: false}], camera}),
      ),
      [],
    );
  });

  it('fails a camera move less than a second after an action', () => {
    const failures = failuresOf(
      sheet({
        actions: [{id: 'click', at: sec(1)}],
        camera: [{from: sec(1.5), to: sec(2)}],
      }),
    );
    assert.match(failures[0]!, /holds only 0\.50s before the camera moves/);
  });
});

describe('withRules', () => {
  it('replaces the fields it gives and merges reading times by kind', () => {
    const rules = withRules({
      maxExtraSec: 3,
      reading: {headline: {baseSec: 1, perWordSec: 0.5}},
    });
    assert.equal(rules.maxExtraSec, 3);
    assert.deepEqual(rules.reading.callout, PACING_RULES.reading.callout);
    const {rows} = auditPacing(sheet({text: [headline(0, 2.5)]}), rules);
    assert.ok(Math.abs(rows[0]!.needSec - 2.5) < 1e-9);
  });
});
