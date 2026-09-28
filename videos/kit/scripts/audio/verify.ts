/**
 * Objective checks on the rendered soundtrack: splice clicks, drum sync
 * against the chart (and against the unedited stem), sample-exact timing of
 * the edit, and an independent loudness reading from ffmpeg.
 */
import type {DrumKit} from '../../src/music/contract';
import {ffmpeg} from '../lib/proc';
import {biquad, butterworth, median, syntheticBursts, toMono} from './dsp';
import type {FadeWindow} from './edit';
import {SAMPLE_RATE, toSamples, type Stereo} from './pcm';

// ---------------------------------------------------------------- Clicks

export interface ClickReport {
  /** Largest sample-to-sample step inside the crossfade window (+-2 ms). */
  spliceMaxStep: number;
  /** Largest step in the surrounding +-150 ms, excluding that window. */
  contextMaxStep: number;
  /** spliceMaxStep / contextMaxStep: <= 1 means no step stands out. */
  ratio: number;
  /** Same comparison for 1 ms frames of first-difference (high-frequency) energy. */
  hfRatio: number;
}

export function clickCheck(s: Stereo, window: FadeWindow): ClickReport {
  const w0 = toSamples(window.startSec) - toSamples(0.002);
  const w1 = toSamples(window.endSec) + toSamples(0.002);
  const c0 = Math.max(1, w0 - toSamples(0.15));
  const c1 = Math.min(s.l.length, w1 + toSamples(0.15));
  const step = (i: number) =>
    Math.max(Math.abs(s.l[i]! - s.l[i - 1]!), Math.abs(s.r[i]! - s.r[i - 1]!));
  let spliceMax = 0;
  let contextMax = 0;
  for (let i = c0; i < c1; i++) {
    const d = step(i);
    if (i >= w0 && i < w1) spliceMax = Math.max(spliceMax, d);
    else contextMax = Math.max(contextMax, d);
  }
  const hop = toSamples(0.001);
  let hfSplice = 0;
  let hfContext = 0;
  for (let a = c0; a + hop <= c1; a += hop) {
    let e = 0;
    for (let i = a; i < a + hop; i++) e += step(i) ** 2;
    if (a + hop > w0 && a < w1) hfSplice = Math.max(hfSplice, e);
    else hfContext = Math.max(hfContext, e);
  }
  return {
    spliceMaxStep: spliceMax,
    contextMaxStep: contextMax,
    ratio: spliceMax / Math.max(1e-12, contextMax),
    hfRatio: Math.sqrt(hfSplice / Math.max(1e-24, hfContext)),
  };
}

// ---------------------------------------------------------------- Drum sync

type Band = 'low' | 'mid' | 'high';

/** Pass bands (Hz; 0 = open): kick body, snare/tom body, cymbals. */
const BANDS: Record<Band, [number, number]> = {
  low: [0, 200],
  mid: [150, 4000],
  high: [6000, 0],
};

/** Attacks are looked for within this distance of each chart time. */
const SEARCH_SEC = 0.04;
/** An attack must raise the band's energy by at least this much. */
const MIN_RISE_DB = 6;
/**
 * Energy frames: 3 ms long, every 0.5 ms. A frame's rise is measured against
 * the loudest frame of the 10 ms before it, so the ripple of a low note that
 * is already sounding never reads as a new attack.
 */
const FRAME = toSamples(0.003);
const HOP = toSamples(0.0005);
const LOOKBACK = toSamples(0.01);

/** Two Butterworth sections per band edge (24 dB/octave). */
function filterBand(x: Float32Array, band: Band): Float32Array | Float64Array {
  const [lo, hi] = BANDS[band];
  const sections = [
    ...(lo > 0 ? [butterworth('hp', lo), butterworth('hp', lo)] : []),
    ...(hi > 0 ? [butterworth('lp', hi), butterworth('lp', hi)] : []),
  ];
  return sections.reduce<Float32Array | Float64Array>(
    (y, f) => biquad(y, f),
    x,
  );
}

/**
 * Band-limited energy flux around `t` (a one-band spectral flux with 0.5 ms
 * resolution): the frame whose energy rises most above the loudest frame of
 * the 10 ms before it. Returns the frame start (seconds, uncorrected) and
 * the rise in dB.
 */
function energyRise(
  mono: Float32Array,
  t: number,
  band: Band,
  bias: number,
): {at: number; riseDb: number} | null {
  const a = Math.max(0, toSamples(t - 0.15));
  const b = Math.min(mono.length, toSamples(t + 0.1));
  const y = filterBand(mono.subarray(a, b), band);
  const db: number[] = [];
  for (let s = 0; s + FRAME <= y.length; s += HOP) {
    let e = 0;
    for (let i = s; i < s + FRAME; i++) e += y[i]! * y[i]!;
    db.push(10 * Math.log10(e / FRAME + 1e-20));
  }
  const lag = Math.round(FRAME / HOP);
  const back = Math.round(LOOKBACK / HOP);
  let best: {at: number; riseDb: number} | null = null;
  for (let k = lag + back; k < db.length; k++) {
    const at = (a + k * HOP) / SAMPLE_RATE;
    if (Math.abs(at - bias - t) > SEARCH_SEC) continue;
    let before = -Infinity;
    for (let j = k - lag - back; j <= k - lag; j++)
      before = Math.max(before, db[j]!);
    const rise = db[k]! - before;
    if (!best || rise > best.riseDb) best = {at, riseDb: rise};
  }
  return best;
}

const biasCache = new Map<Band, number>();

/**
 * The energy-flux detector's own latency per band, measured on the synthetic
 * bursts, so reported offsets are the audio's and not the detector's.
 */
function bandBias(band: Band): number {
  const cached = biasCache.get(band);
  if (cached !== undefined) return cached;
  const {signal, truth} = syntheticBursts();
  const offsets = truth.flatMap(t => {
    const r = energyRise(signal, t, band, 0);
    return r ? [r.at - t] : [];
  });
  const bias = median(offsets);
  biasCache.set(band, bias);
  return bias;
}

/** One distinct drum-note time and the kit pieces struck on it. */
export interface DrumHit {
  t: number;
  kits: Set<DrumKit>;
}

export function groupDrumHits(notes: {t: number; kit: DrumKit}[]): DrumHit[] {
  const byTime = new Map<number, Set<DrumKit>>();
  for (const n of notes) {
    const kits = byTime.get(n.t) ?? new Set<DrumKit>();
    kits.add(n.kit);
    byTime.set(n.t, kits);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, kits]) => ({t, kits}));
}

const isTransient = (kits: Set<DrumKit>) =>
  [...kits].some(k => k === 'kick' || k === 'snare' || k.startsWith('tom'));

/** The band that shows a hit's attack best: its most transient piece's. */
function hitBand(kits: Set<DrumKit>): Band {
  if (kits.has('kick')) return 'low';
  if (isTransient(kits)) return 'mid';
  return 'high';
}

/**
 * The measured attack of a hit struck on `kits` at `t` in a mono stem,
 * relative to `t` (seconds): the largest band-limited energy rise within
 * +-40 ms, in the band of its most transient piece, corrected for the
 * detector's own latency. null when no rise of at least MIN_RISE_DB stands
 * out (a masked cymbal, say).
 */
function attackOffset(
  mono: Float32Array,
  t: number,
  kits: Set<DrumKit>,
): number | null {
  const band = hitBand(kits);
  const bias = bandBias(band);
  const r = energyRise(mono, t, band, bias);
  return r && r.riseDb >= MIN_RISE_DB ? r.at - bias - t : null;
}

/** A drum hit and its measured attack offset (see `attackOffset`). */
export interface HitAttack {
  hit: DrumHit;
  offset: number | null;
}

export function attackOffsets(drums: Stereo, hits: DrumHit[]): HitAttack[] {
  const mono = toMono(drums);
  return hits.map(hit => ({hit, offset: attackOffset(mono, hit.t, hit.kits)}));
}

export interface SyncStats {
  noteTimes: number;
  matched: number;
  medianAbsMs: number;
  p95AbsMs: number;
  maxAbsMs: number;
  /** Signed median (audio relative to chart), ms. */
  medianSignedMs: number;
}

export interface SyncReport {
  /** Every distinct drum-note time. */
  all: SyncStats;
  /** Times with a kick, snare or tom: a distinct transient to measure. */
  transient: SyncStats;
  /**
   * Cymbal-only times. A cymbal struck while another rings often has no
   * measurable attack in the stem, so these offsets are mostly detector
   * noise; reported separately rather than mixed in.
   */
  cymbalOnly: SyncStats;
  detectorBiasMs: Record<Band, number>;
}

const toMs = (sec: number): number => +(sec * 1000).toFixed(2);

function stats(offsets: (number | null)[]): SyncStats {
  const vals = offsets.filter((o): o is number => o !== null);
  const abs = vals.map(Math.abs).sort((a, b) => a - b);
  const ms = (v: number | undefined) => (v === undefined ? NaN : toMs(v));
  return {
    noteTimes: offsets.length,
    matched: vals.length,
    medianAbsMs: ms(median(abs)),
    p95AbsMs: ms(abs[Math.floor(abs.length * 0.95)]),
    maxAbsMs: ms(abs[abs.length - 1]),
    medianSignedMs: ms(median(vals)),
  };
}

/**
 * Drum sync against the chart, summarised for all hits, hits with a
 * transient piece, and cymbal-only hits.
 */
export function syncReport(attacks: HitAttack[]): SyncReport {
  const offsetsWhere = (keep: (kits: Set<DrumKit>) => boolean) =>
    attacks.filter(a => keep(a.hit.kits)).map(a => a.offset);
  return {
    all: stats(attacks.map(a => a.offset)),
    transient: stats(offsetsWhere(isTransient)),
    cymbalOnly: stats(offsetsWhere(kits => !isTransient(kits))),
    detectorBiasMs: {
      low: toMs(bandBias('low')),
      mid: toMs(bandBias('mid')),
      high: toMs(bandBias('high')),
    },
  };
}

/**
 * The same attack measurement on the unedited stem, at each hit's song time
 * (a dB rise does not depend on gain, so the stem is measured as decoded).
 * Lists the hits where it differs from the edited stem's by more than 0.5 ms:
 * any deviation elsewhere is the performance, not the edit.
 */
export function syncVsSource(
  attacks: HitAttack[],
  source: Stereo,
  songTimeOf: (videoSec: number) => number,
): {
  hits: number;
  differing: {t: number; editMs: number | null; sourceMs: number | null}[];
} {
  const mono = toMono(source);
  const differing = attacks.flatMap(({hit, offset}) => {
    const src = attackOffset(mono, songTimeOf(hit.t), hit.kits);
    const same =
      offset === null || src === null
        ? offset === src
        : Math.abs(offset - src) <= 0.0005;
    if (same) return [];
    const ms = (v: number | null) => (v === null ? null : toMs(v));
    return [{t: hit.t, editMs: ms(offset), sourceMs: ms(src)}];
  });
  return {hits: attacks.length, differing};
}

/**
 * Proves the edit moved nothing: for each note, cross-correlates the edited
 * stem against the source stem at the note's song time over +-`maxLagSec`.
 * Every lag should be exactly 0 samples. Notes the edit silences (a mute
 * lane, the end of the fade) have nothing to correlate and are skipped.
 */
export function editLagCheck(
  edited: Stereo,
  source: Stereo,
  notes: {t: number; songT: number}[],
  maxLagSec = 0.005,
): {notes: number; maxAbsLagSamples: number; minCorrelation: number} {
  const e = toMono(edited);
  const s = toMono(source);
  const L = toSamples(maxLagSec);
  const pre = toSamples(0.02);
  const len = toSamples(0.08);
  let maxLag = 0;
  let minCorr = 1;
  let count = 0;
  const seen = new Set<number>();
  for (const n of notes) {
    if (seen.has(n.t)) continue;
    seen.add(n.t);
    const e0 = toSamples(n.t) - pre;
    const s0 = toSamples(n.songT) - pre;
    if (e0 < 0 || e0 + len > e.length || s0 - L < 0 || s0 + len + L > s.length)
      continue;
    let ee = 0;
    for (let i = 0; i < len; i++) ee += e[e0 + i]! ** 2;
    if (ee < 1e-12) continue;
    let bestLag = 0;
    let bestCorr = -Infinity;
    for (let lag = -L; lag <= L; lag++) {
      let xy = 0;
      let ss = 0;
      for (let i = 0; i < len; i++) {
        const sv = s[s0 + lag + i]!;
        xy += e[e0 + i]! * sv;
        ss += sv * sv;
      }
      const c = xy / Math.sqrt(ee * ss + 1e-30);
      if (c > bestCorr) {
        bestCorr = c;
        bestLag = lag;
      }
    }
    count++;
    maxLag = Math.max(maxLag, Math.abs(bestLag));
    minCorr = Math.min(minCorr, bestCorr);
  }
  return {
    notes: count,
    maxAbsLagSamples: maxLag,
    minCorrelation: +minCorr.toFixed(4),
  };
}

// ---------------------------------------------------------------- Loudness

/**
 * A dB value from an ffmpeg report. "-inf" is digital silence; text that is
 * missing or not a number throws, so an unreadable reading can never pass a
 * `value > limit` check by being NaN.
 */
export function parseDb(text: string | undefined, what: string): number {
  if (text === undefined) throw new Error(`ffmpeg reported no ${what}`);
  if (/^-inf$/i.test(text.trim())) return -Infinity;
  const v = Number(text);
  if (Number.isNaN(v)) {
    throw new Error(`ffmpeg reported an unreadable ${what}: "${text}"`);
  }
  return v;
}

/** The integrated loudness and true peak from an ebur128 run's stderr summary. */
export function parseEbur128Summary(stderr: string): {
  lufs: number;
  truePeakDb: number;
} {
  const at = stderr.lastIndexOf('Summary:');
  if (at < 0) throw new Error('ffmpeg ebur128 printed no summary');
  const summary = stderr.slice(at);
  return {
    lufs: parseDb(
      /I:\s+(-?(?:[\d.]+|inf)) LUFS/i.exec(summary)?.[1],
      'integrated loudness',
    ),
    truePeakDb: parseDb(
      /Peak:\s+(-?(?:[\d.]+|inf)) dBFS/i.exec(summary)?.[1],
      'true peak',
    ),
  };
}

/**
 * ffmpeg's own EBU R128 reading (integrated loudness and true peak), an
 * independent check on the in-house BS.1770 code. Throws when ffmpeg fails
 * or its summary cannot be read.
 */
export function ffmpegLoudness(file: string): {
  lufs: number;
  truePeakDb: number;
} {
  const {stderr} = ffmpeg(
    ['-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    {logLevel: 'info'},
  );
  return parseEbur128Summary(stderr);
}
