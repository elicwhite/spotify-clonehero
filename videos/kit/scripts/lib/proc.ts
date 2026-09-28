/**
 * Child processes for the Node tools. Every call checks the exit status: a
 * tool that fails throws with the tail of its stderr, so a broken ffmpeg run
 * can never be read as a result.
 */
import {spawn, spawnSync} from 'node:child_process';

export interface RunOptions {
  /** Bytes written to the child's stdin. */
  input?: Buffer;
  /** Largest stdout the call may collect, bytes (default 2 GiB). */
  maxBuffer?: number;
  cwd?: string;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

/** The last `lines` lines of a tool's stderr, for error messages. */
const stderrTail = (stderr: string, lines = 12): string =>
  stderr.trim().split('\n').slice(-lines).join('\n');

/** Runs `cmd` to completion. Throws when it cannot start or exits non-zero. */
export function run(
  cmd: string,
  args: readonly string[],
  options: RunOptions = {},
): RunResult {
  const res = spawnSync(cmd, [...args], {
    input: options.input,
    cwd: options.cwd,
    maxBuffer: options.maxBuffer ?? 2 * 1024 ** 3,
  });
  if (res.error) {
    throw new Error(`${cmd} could not run: ${res.error.message}`);
  }
  const stderr = res.stderr?.toString() ?? '';
  if (res.status !== 0) {
    throw new Error(
      `${cmd} exited with ${res.status ?? res.signal}: ${stderrTail(stderr)}`,
    );
  }
  return {stdout: res.stdout, stderr};
}

/**
 * The kit's ffmpeg preamble in front of `args`: no banner, no stdin, and a
 * log level (`error` keeps stderr for failures only; analysis filters that
 * report on stderr, such as ebur128, need `info`).
 */
export const ffmpegArgs = (
  args: readonly string[],
  logLevel: 'error' | 'info' = 'error',
): string[] => ['-hide_banner', '-nostdin', '-v', logLevel, ...args];

/** Runs ffmpeg with the kit's preamble (see `ffmpegArgs`). */
export function ffmpeg(
  args: readonly string[],
  options: RunOptions & {logLevel?: 'error' | 'info'} = {},
): RunResult {
  return run('ffmpeg', ffmpegArgs(args, options.logLevel), options);
}

/** ffprobe's JSON output for `args` (which must not set `-of`). */
export function ffprobeJson<T>(args: readonly string[]): T {
  const {stdout} = run('ffprobe', ['-v', 'error', '-of', 'json', ...args]);
  return JSON.parse(stdout.toString()) as T;
}

/**
 * Streams a child's stdout in fixed-size records (raw video frames, say) to
 * `onRecord`, and resolves when the child exits cleanly. A trailing partial
 * record or a non-zero exit rejects.
 */
export function streamRecords(
  cmd: string,
  args: readonly string[],
  recordBytes: number,
  onRecord: (record: Buffer, index: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], {stdio: ['ignore', 'pipe', 'pipe']});
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-20000);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let offset = 0;
      while (pending.length - offset >= recordBytes) {
        onRecord(pending.subarray(offset, offset + recordBytes), index++);
        offset += recordBytes;
      }
      pending = Buffer.from(pending.subarray(offset));
    });
    child.on('error', err =>
      reject(new Error(`${cmd} could not run: ${err.message}`)),
    );
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`${cmd} exited with ${code}: ${stderrTail(stderr)}`));
      } else if (pending.length) {
        reject(
          new Error(`${cmd} ended mid-record (${pending.length} bytes left)`),
        );
      } else {
        resolve(index);
      }
    });
  });
}
