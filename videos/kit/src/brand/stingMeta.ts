/**
 * The Blender logo sting's meta: the JSON the kit's `blender/logo_sting.py`
 * writes beside its PNG frames, its check, and its events as film frames.
 * React-free, so Node tools (the sting preview, a pacing sheet) read it too.
 */

/** The sting's meta (version 1). Frame numbers are sting frames: film frame = start + sting frame. */
export interface StingMeta {
  version: 1;
  /** The fps it was rendered at; it must equal the composition's. */
  fps: number;
  /** Sting length in frames. */
  frames: number;
  /** The film frame of sting frame 0, from the timeline it was rendered against. */
  globalStart: number;
  /** File name padding: frame i is `String(i).padStart(digits, '0') + '.png'`. */
  digits: number;
  /** The side of a (square) frame, px. */
  frameSizePx: number;
  /** The first frame the mark shows on; the frames before it are empty. */
  appearFrame: number;
  /** The hit: the mark frontal and full size. */
  impactFrame: number;
  /** Lane-light flashes after the hit. */
  flashFrames: readonly number[];
  /** The mark rests exactly frontal from the first of these to the last (the last is frames - 1). */
  restFrames: readonly [number, number];
  /** Light sheens across the mark's face. */
  sheenFrames: readonly number[];
  /** The mark at rest, in frame px (origin top left, y down). */
  rest: {
    centerPx: readonly [number, number];
    squarePx: number;
    cornerRadiusPx: number;
    iconBoxPx: number;
    strokePx: number;
  };
}

/** What writes a sting, for the errors that ask for a new one. */
export const STING_WRITTEN_BY = "the kit's blender/logo_sting.py";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

interface NumberRule {
  min?: number;
  /** Strictly above. */
  above?: number;
  max?: number;
  integer?: boolean;
}

/**
 * Every way `value`, as read from its JSON file, is not a version-1 sting
 * meta: none when it is one.
 */
export const stingMetaProblems = (value: unknown): string[] => {
  if (!isRecord(value)) return ['the sting meta must be an object'];
  const p: string[] = [];
  /** The value when it is a finite number within `rule`, else a recorded problem. */
  const num = (
    v: unknown,
    name: string,
    rule: NumberRule = {},
  ): number | undefined => {
    const bad = (why: string) => {
      p.push(`${name} ${why}, got ${JSON.stringify(v) ?? String(v)}`);
      return undefined;
    };
    if (typeof v !== 'number' || !Number.isFinite(v))
      return bad('must be a number');
    if (rule.integer && !Number.isInteger(v))
      return bad('must be a whole number');
    if (rule.min !== undefined && v < rule.min)
      return bad(`must be at least ${rule.min}`);
    if (rule.above !== undefined && !(v > rule.above))
      return bad(`must be above ${rule.above}`);
    if (rule.max !== undefined && v > rule.max)
      return bad(`must be at most ${rule.max}`);
    return v;
  };
  const list = (v: unknown, name: string): v is unknown[] => {
    if (Array.isArray(v)) return true;
    p.push(`${name} must be a list`);
    return false;
  };

  if (value.version !== 1) {
    p.push(`meta version ${JSON.stringify(value.version)} is not 1`);
  }
  const whole = {min: 0, integer: true};
  num(value.fps, 'fps', {above: 0});
  const frames = num(value.frames, 'frames', {min: 1, integer: true});
  num(value.globalStart, 'globalStart', whole);
  num(value.digits, 'digits', {min: 1, integer: true});
  num(value.frameSizePx, 'frameSizePx', {min: 1, integer: true});
  const frame = {...whole, max: frames === undefined ? Infinity : frames - 1};
  num(value.appearFrame, 'appearFrame', frame);
  num(value.impactFrame, 'impactFrame', frame);
  for (const k of ['flashFrames', 'restFrames', 'sheenFrames'] as const) {
    const frameList = value[k];
    if (list(frameList, k))
      frameList.forEach((f, i) => num(f, `${k}[${i}]`, frame));
  }
  if (Array.isArray(value.restFrames) && value.restFrames.length !== 2) {
    p.push('restFrames must be [first, last]');
  }
  const {rest} = value;
  if (!isRecord(rest)) {
    p.push('rest must be an object');
  } else {
    if (list(rest.centerPx, 'rest.centerPx')) {
      if (rest.centerPx.length !== 2) p.push('rest.centerPx must be [x, y]');
      else rest.centerPx.forEach((c, i) => num(c, `rest.centerPx[${i}]`));
    }
    for (const k of [
      'squarePx',
      'cornerRadiusPx',
      'iconBoxPx',
      'strokePx',
    ] as const) {
      num(rest[k], `rest.${k}`, {above: 0});
    }
  }
  return p;
};

/**
 * Narrows a sting meta read from JSON: throws once, naming every problem,
 * unless it is a version-1 meta. The player and the kit's sting preview both
 * check with it.
 */
export function assertStingMeta(value: unknown): asserts value is StingMeta {
  const problems = stingMetaProblems(value);
  if (problems.length > 0)
    throw new Error(
      `Bad sting meta (re-render it with ${STING_WRITTEN_BY}):\n- ${problems.join('\n- ')}`,
    );
}

/** Throws unless `meta` is a version-1 sting rendered at `fps`. */
export const checkSting = (meta: StingMeta, fps: number): void => {
  if (meta.version !== 1)
    throw new Error(
      `[LogoSting] meta version ${String(meta.version)} is not 1; re-render with ${STING_WRITTEN_BY}`,
    );
  if (meta.fps !== fps)
    throw new Error(
      `[LogoSting] the sting was rendered at ${meta.fps} fps but the composition runs at ${fps}; re-render it at ${fps}`,
    );
};

/** The sting's events as film frames. */
export interface StingCues {
  /** Sting frame 0. */
  start: number;
  appear: number;
  impact: number;
  flashes: number[];
  /** The first frame of the rest pose. */
  rest: number;
  sheens: number[];
  /** The last frame (held after). */
  end: number;
}

/** The sting's events as film frames, for choreography around it. */
export const stingCues = (
  meta: StingMeta,
  start = meta.globalStart,
): StingCues => ({
  start,
  appear: start + meta.appearFrame,
  impact: start + meta.impactFrame,
  flashes: meta.flashFrames.map(f => start + f),
  rest: start + meta.restFrames[0],
  sheens: meta.sheenFrames.map(f => start + f),
  end: start + meta.frames - 1,
});
