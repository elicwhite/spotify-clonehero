/**
 * Pacing rules for on-screen copy: long enough to read, short enough not to
 * drag, and nothing moving while it is read. A film exports a `PacingSheet`
 * (its text blocks, UI actions and camera moves, in global frames) and
 * `auditPacing` checks it against a set of rules. Pure; the CLI is
 * pacingAudit.ts.
 *
 * The default rules (PACING_RULES): the camera settles, the copy lands and is
 * read, then the UI acts, and every block is sized to its words:
 * - reading time, from the moment the whole block is on screen: a headline
 *   needs 0.8 s + 0.3 s per word, a callout 0.5 s + one second per 3.5
 *   words, a ledger (a panel of evidence) 2.3 s;
 * - no block stays fully on screen longer than its reading time + 1.2 s
 *   (ids starting `end-`, the end card, are exempt);
 * - no camera move overlaps a block's reading window, and no action lands
 *   inside a headline's reading window;
 * - an action's result holds 1.0 s before the next headline starts arriving
 *   (its words start 0.6 s before it is fully in), and 1.0 s before the next
 *   camera move (an action during a move fails); an action marked
 *   `holds: false` has no result of its own and is exempt.
 */

import {
  checkArray,
  checkNumber,
  checkRecord,
  checkString,
  throwProblems,
} from '../lib/check';

/** A block of copy on screen. Frames are global film frames. */
export interface TextBlock {
  id: string;
  /** A kind the rules have a reading time for ('headline', 'callout', 'ledger'). */
  kind: string;
  /** The words on screen, as the text or a list of words: the reading time counts them. */
  words: string | readonly string[];
  /** The frame the whole block is on screen (its last word settled). */
  fullyIn: number;
  /** The frame it starts to leave. */
  out: number;
}

/** A UI action: a click, a flip, a panel opening, a state change. */
export interface PacingAction {
  id: string;
  at: number;
  /** False for an action with no result to hold on its own (rows cascading in as a view arrives). */
  holds?: boolean;
}

/** Frames where the camera visibly moves (a glide, whip or rack; not the slow drift). */
export interface CameraMove {
  from: number;
  to: number;
}

export interface PacingSheet {
  fps: number;
  text: readonly TextBlock[];
  actions: readonly PacingAction[];
  camera: readonly CameraMove[];
}

/** Reading time of a kind: `baseSec + perWordSec * words`. */
export interface ReadingRule {
  baseSec: number;
  perWordSec: number;
}

export interface PacingRules {
  reading: Readonly<Record<string, ReadingRule>>;
  /** A block may stay fully on screen at most its reading time plus this. */
  maxExtraSec: number;
  /** Blocks whose id starts with one of these may stay as long as they like. */
  exemptIdPrefixes: readonly string[];
  /** Kinds whose reading window no action may interrupt, and that a result must precede by `resultHoldSec`. */
  headlineKinds: readonly string[];
  /** A headline's words start arriving this long before it is fully in. */
  arrivalLeadSec: number;
  /** An action's result holds this long before the next headline starts arriving. */
  resultHoldSec: number;
  /** ... and this long before the next camera move. */
  cameraHoldSec: number;
}

export const PACING_RULES: PacingRules = {
  reading: {
    headline: {baseSec: 0.8, perWordSec: 0.3},
    callout: {baseSec: 0.5, perWordSec: 1 / 3.5},
    ledger: {baseSec: 2.3, perWordSec: 0},
  },
  maxExtraSec: 1.2,
  exemptIdPrefixes: ['end-'],
  headlineKinds: ['headline'],
  arrivalLeadSec: 0.6,
  resultHoldSec: 1.0,
  cameraHoldSec: 1.0,
};

/**
 * Checks a pacing sheet as it arrives from a module (the film's `pacing`
 * export), and narrows it; throws naming every problem. `words` must be the
 * block's text or its list of words: a typed-in count is refused.
 */
export function assertPacingSheet(
  value: unknown,
): asserts value is PacingSheet {
  const p: string[] = [];
  if (!checkRecord(p, value, 'the pacing sheet'))
    return throwProblems('Bad pacing sheet', p);
  checkNumber(p, value.fps, 'fps', {above: 0});
  const frame = {min: 0, integer: true};
  if (checkArray(p, value.text, 'text')) {
    value.text.forEach((b, i) => {
      const at = `text[${i}]`;
      if (!checkRecord(p, b, at)) return;
      checkString(p, b.id, `${at}.id`);
      checkString(p, b.kind, `${at}.kind`);
      const words = b.words;
      const isText =
        typeof words === 'string' ||
        (Array.isArray(words) && words.every(w => typeof w === 'string'));
      if (!isText) {
        const got =
          typeof words === 'number'
            ? `a count (${words})`
            : JSON.stringify(words);
        p.push(
          `${at}.words must be the block's text or its list of words, not ${got}`,
        );
      }
      const fullyIn = checkNumber(p, b.fullyIn, `${at}.fullyIn`, frame);
      const out = checkNumber(p, b.out, `${at}.out`, frame);
      if (fullyIn !== undefined && out !== undefined && out < fullyIn) {
        p.push(`${at} leaves (${out}) before it is fully in (${fullyIn})`);
      }
    });
  }
  if (checkArray(p, value.actions, 'actions')) {
    value.actions.forEach((a, i) => {
      if (!checkRecord(p, a, `actions[${i}]`)) return;
      checkString(p, a.id, `actions[${i}].id`);
      checkNumber(p, a.at, `actions[${i}].at`, frame);
      if (a.holds !== undefined && typeof a.holds !== 'boolean')
        p.push(`actions[${i}].holds must be true or false`);
    });
  }
  if (checkArray(p, value.camera, 'camera')) {
    value.camera.forEach((c, i) => {
      if (!checkRecord(p, c, `camera[${i}]`)) return;
      const from = checkNumber(p, c.from, `camera[${i}].from`, frame);
      const to = checkNumber(p, c.to, `camera[${i}].to`, frame);
      if (from !== undefined && to !== undefined && to <= from)
        p.push(`camera[${i}] ends before it starts`);
    });
  }
  throwProblems('Bad pacing sheet', p);
}

/** Checks rule overrides from a file or module (any fields of PacingRules), and narrows them. */
export function assertRuleOverrides(
  value: unknown,
): asserts value is Partial<PacingRules> {
  const p: string[] = [];
  if (!checkRecord(p, value, 'the rules'))
    return throwProblems('Bad pacing rules', p);
  const known = Object.keys(PACING_RULES);
  for (const k of Object.keys(value))
    if (!known.includes(k))
      p.push(`${k} is not a pacing rule (${known.join(', ')})`);
  for (const k of [
    'maxExtraSec',
    'arrivalLeadSec',
    'resultHoldSec',
    'cameraHoldSec',
  ] as const) {
    if (value[k] !== undefined) checkNumber(p, value[k], k, {min: 0});
  }
  for (const k of ['exemptIdPrefixes', 'headlineKinds'] as const) {
    const list = value[k];
    if (
      list !== undefined &&
      (!Array.isArray(list) || list.some(x => typeof x !== 'string'))
    ) {
      p.push(`${k} must be a list of strings`);
    }
  }
  if (value.reading !== undefined && checkRecord(p, value.reading, 'reading')) {
    for (const [kind, rule] of Object.entries(value.reading)) {
      if (!checkRecord(p, rule, `reading.${kind}`)) continue;
      checkNumber(p, rule.baseSec, `reading.${kind}.baseSec`, {min: 0});
      checkNumber(p, rule.perWordSec, `reading.${kind}.perWordSec`, {min: 0});
    }
  }
  throwProblems('Bad pacing rules', p);
}

/** Rules with some fields replaced; `reading` merges by kind. */
export function withRules(overrides: Partial<PacingRules>): PacingRules {
  return {
    ...PACING_RULES,
    ...overrides,
    reading: {...PACING_RULES.reading, ...overrides.reading},
  };
}

/** Words a reader reads: tokens with a letter or digit in them ("✓" and "·" are not words). */
export function countWords(words: string | readonly string[]): number {
  const tokens =
    typeof words === 'string'
      ? words.split(/\s+/)
      : words.flatMap(w => w.split(/\s+/));
  return tokens.filter(t => /[\p{L}\p{N}]/u.test(t)).length;
}

export interface PacingRow {
  id: string;
  kind: string;
  words: number;
  heldSec: number;
  needSec: number;
  maxSec: number | null;
  ok: boolean;
}

export interface PacingResult {
  rows: PacingRow[];
  failures: string[];
}

/** Checks a sheet against the rules. */
export function auditPacing(
  sheet: PacingSheet,
  rules: PacingRules = PACING_RULES,
): PacingResult {
  const {fps} = sheet;
  const fmt = (f: number) => `${(f / fps).toFixed(2)}s`;
  const failures: string[] = [];
  const rows: PacingRow[] = [];
  const eps = 1e-6;
  assertPacingSheet(sheet);
  const need = (b: TextBlock) => {
    const rule = rules.reading[b.kind];
    if (!rule) throw new Error(`${b.id}: no reading rule for kind "${b.kind}"`);
    return rule.baseSec + rule.perWordSec * countWords(b.words);
  };
  const isHeadline = (b: TextBlock) => rules.headlineKinds.includes(b.kind);

  for (const b of sheet.text) {
    const held = (b.out - b.fullyIn) / fps;
    const needSec = need(b);
    const exempt = rules.exemptIdPrefixes.some(p => b.id.startsWith(p));
    const maxSec = exempt ? null : needSec + rules.maxExtraSec;
    const tooShort = held < needSec - eps;
    const tooLong = maxSec !== null && held > maxSec + eps;
    rows.push({
      id: b.id,
      kind: b.kind,
      words: countWords(b.words),
      heldSec: held,
      needSec,
      maxSec,
      ok: !tooShort && !tooLong,
    });
    if (tooShort)
      failures.push(
        `${b.id}: held ${held.toFixed(2)}s, needs ${needSec.toFixed(2)}s`,
      );
    if (tooLong)
      failures.push(
        `${b.id}: held ${held.toFixed(2)}s, drags past ${maxSec!.toFixed(2)}s`,
      );
    const readEnd = b.fullyIn + needSec * fps;
    for (const c of sheet.camera) {
      if (c.from < readEnd && c.to > b.fullyIn) {
        failures.push(
          `${b.id}: camera moves ${fmt(c.from)}-${fmt(c.to)} while it is read (${fmt(b.fullyIn)}-${fmt(readEnd)})`,
        );
      }
    }
    if (isHeadline(b)) {
      for (const a of sheet.actions) {
        if (a.at > b.fullyIn && a.at < readEnd) {
          failures.push(
            `${b.id}: action "${a.id}" at ${fmt(a.at)} lands before it is read (until ${fmt(readEnd)})`,
          );
        }
      }
    }
  }
  const lead = rules.arrivalLeadSec * fps;
  const results = sheet.actions.filter(x => x.holds !== false);
  for (const a of results) {
    for (const b of sheet.text.filter(isHeadline)) {
      const arrives = b.fullyIn - lead;
      if (
        arrives > a.at &&
        (arrives - a.at) / fps < rules.resultHoldSec - eps
      ) {
        failures.push(
          `${b.id}: starts arriving ${((arrives - a.at) / fps).toFixed(2)}s after action "${a.id}" (${fmt(a.at)}); ` +
            `its result needs ${rules.resultHoldSec}s on its own`,
        );
      }
    }
  }
  for (const a of results) {
    // The first camera move still to come, or already under way, at the action.
    const next = sheet.camera
      .filter(c => c.to > a.at)
      .sort((x, y) => x.from - y.from)[0];
    if (!next) continue;
    const hold = (next.from - a.at) / fps;
    if (hold <= 0) {
      failures.push(
        `action "${a.id}" at ${fmt(a.at)} lands while the camera moves (${fmt(next.from)}-${fmt(next.to)})`,
      );
    } else if (hold < rules.cameraHoldSec - eps) {
      failures.push(
        `action "${a.id}" at ${fmt(a.at)} holds only ${hold.toFixed(2)}s before the camera moves`,
      );
    }
  }
  return {rows, failures};
}
