/**
 * Checking data that arrives as `unknown` (a JSON file, a module's export)
 * before a tool trusts it. Each check records a readable problem instead of
 * throwing, so one run names every mistake; `throwProblems` then fails with
 * all of them. The tools' assertion functions (`assertSoundtrackConfig`,
 * `assertCues`, ...) are built from these and narrow the value's type.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface NumberRule {
  /** The value must be at least this. */
  min?: number;
  /** The value must be strictly above this. */
  above?: number;
  /** The value must be at most this. */
  max?: number;
  integer?: boolean;
}

/**
 * The value, when it is a finite number within `rule`; otherwise records a
 * problem and returns undefined. Compare the result with undefined: 0 is a
 * good number.
 */
export function checkNumber(
  problems: string[],
  value: unknown,
  name: string,
  rule: NumberRule = {},
): number | undefined {
  const bad = (why: string) => {
    problems.push(
      `${name} ${why}, got ${JSON.stringify(value) ?? String(value)}`,
    );
    return undefined;
  };
  if (typeof value !== 'number' || !Number.isFinite(value))
    return bad('must be a number');
  if (rule.integer && !Number.isInteger(value))
    return bad('must be a whole number');
  if (rule.min !== undefined && value < rule.min)
    return bad(`must be at least ${rule.min}`);
  if (rule.above !== undefined && !(value > rule.above))
    return bad(`must be above ${rule.above}`);
  if (rule.max !== undefined && value > rule.max)
    return bad(`must be at most ${rule.max}`);
  return value;
}

/** Records a problem unless `value` is a non-empty string; returns whether it is. */
export function checkString(
  problems: string[],
  value: unknown,
  name: string,
): value is string {
  if (typeof value === 'string' && value !== '') return true;
  problems.push(`${name} must be a non-empty string`);
  return false;
}

/** Records a problem unless `value` is an array; returns whether it is. */
export function checkArray(
  problems: string[],
  value: unknown,
  name: string,
): value is unknown[] {
  if (Array.isArray(value)) return true;
  problems.push(`${name} must be a list`);
  return false;
}

/** Records a problem unless `value` is an object; returns whether it is. */
export function checkRecord(
  problems: string[],
  value: unknown,
  name: string,
): value is Record<string, unknown> {
  if (isRecord(value)) return true;
  problems.push(`${name} must be an object`);
  return false;
}

/** Throws one error naming every problem, when there are any. */
export function throwProblems(what: string, problems: readonly string[]): void {
  if (problems.length) throw new Error(`${what}:\n- ${problems.join('\n- ')}`);
}
