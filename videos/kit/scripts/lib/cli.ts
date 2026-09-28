/**
 * Command-line plumbing shared by the tools: every path and number comes from
 * a flag (node:util parseArgs), a module is a CLI only when run directly, and
 * failures print one line instead of a stack trace.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs, type ParseArgsConfig} from 'node:util';

/** A bad command line: the tool prints its usage and exits 2. */
export class UsageError extends Error {}

/** True when the module at `importMetaUrl` is the script node was started with. */
export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(fileURLToPath(importMetaUrl)) === real(entry);
}

/**
 * Runs a tool's `main`. A UsageError prints the message and `usage`, and
 * exits 2; any other error prints its message (and its stack when DEBUG is
 * set) and exits 1. `main` may set process.exitCode itself for a check that
 * ran but failed.
 */
export function runCli(usage: string, main: () => void | Promise<void>): void {
  Promise.resolve()
    .then(main)
    .catch((err: unknown) => {
      if (err instanceof UsageError) {
        console.error(`${err.message}\n\n${usage.trim()}`);
        process.exitCode = 2;
        return;
      }
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(process.env.DEBUG ? e.stack : `error: ${e.message}`);
      process.exitCode = 1;
    });
}

type Options = NonNullable<ParseArgsConfig['options']>;

/** parseArgs in strict mode; unknown flags and stray positionals are usage errors. */
export function parseFlags<O extends Options>(
  options: O,
  args: string[] = process.argv.slice(2),
  allowPositionals = false,
) {
  try {
    return parseArgs({options, args, strict: true, allowPositionals});
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

/** A required string flag. */
export function need(value: string | undefined, flag: string): string {
  if (value === undefined || value === '') {
    throw new UsageError(`--${flag} is required`);
  }
  return value;
}

/** A number flag (optional, with a default). Rejects blanks and anything non-finite. */
export function num(
  value: string | undefined,
  flag: string,
  fallback?: number,
): number {
  if (value === undefined) {
    if (fallback === undefined) throw new UsageError(`--${flag} is required`);
    return fallback;
  }
  const n = value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(n)) {
    throw new UsageError(`--${flag} must be a number, got "${value}"`);
  }
  return n;
}

/** A number flag that must be above zero (a rate, a scale, a duration). */
export function positive(
  value: string | undefined,
  flag: string,
  fallback?: number,
): number {
  const n = num(value, flag, fallback);
  if (!(n > 0)) throw new UsageError(`--${flag} must be above 0, got ${n}`);
  return n;
}

/** An integer flag, optionally with a lower bound. */
export function int(
  value: string | undefined,
  flag: string,
  fallback?: number,
  min = -Infinity,
): number {
  const n = num(value, flag, fallback);
  if (!Number.isInteger(n) || n < min) {
    throw new UsageError(
      `--${flag} must be an integer${min > -Infinity ? ` >= ${min}` : ''}, got ${n}`,
    );
  }
  return n;
}

/** An inclusive frame range "from-to" (or a single frame "n"). */
export function frameRange(value: string, flag: string): [number, number] {
  const m = /^(\d+)(?:-(\d+))?$/.exec(value.trim());
  if (!m)
    throw new UsageError(`--${flag} must look like 120-480, got "${value}"`);
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  if (to < from) throw new UsageError(`--${flag}: ${to} is before ${from}`);
  return [from, to];
}

/** A comma-separated list of integers ("12,40,96"). */
export function intList(value: string, flag: string): number[] {
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => int(s, flag));
}

/** A module's exports by name (TypeScript works under `node --import tsx`); unchecked. */
export async function moduleExports(
  file: string,
): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(path.resolve(file)).href)) as Record<
    string,
    unknown
  >;
}

/**
 * Imports a module by path and returns its export `name`, or the default
 * export when `name` is 'default'. The value is unchecked: pass it through
 * the tool's assertion function.
 */
export async function importExport(
  file: string,
  name: string,
): Promise<unknown> {
  const mod = await moduleExports(file);
  if (!(name in mod)) {
    const have = Object.keys(mod).join(', ') || 'nothing';
    throw new Error(`${file} has no export "${name}" (it exports ${have})`);
  }
  return mod[name];
}

/** Reads a JSON file, or imports export `name` from a JS/TS module; unchecked, as `importExport`. */
export async function loadData(file: string, name: string): Promise<unknown> {
  if (/\.json$/i.test(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return importExport(file, name);
}
