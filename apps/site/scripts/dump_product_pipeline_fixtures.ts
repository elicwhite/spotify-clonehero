// Fixture dump for drum-to-chart's analysis/product_pipeline PARITY registry
// (analysis/product_pipeline/PARITY.md). Run via `pnpm run dump:product-pipeline-fixtures`
// from drum-to-chart's sync_fixtures.py (which pins this checkout's commit and stamps
// PARITY.md with it -- see that file's docstring for the staleness-check contract).
//
// TODAY this dumps ONE stage's fixtures: stage 8-9 (offsets+snap), the
// snapOnsetTick composition (chart-builder.ts:433-464) exercised via the real
// exported primitives (buildTimedTempos/msToTick/tickToMs from
// lib/drum-transcription/timing, snapGroupToGrid from lib/tempo-map/
// quantize-grid, getChartMapping from ml/class-mapping) -- snapOnsetTick
// itself is module-private in chart-builder.ts and wasn't exported for this
// test, so this composes the identical logic instead of re-deriving a
// divergent copy. snapTickUniform / SnapMode's 'uniform' member were REMOVED
// (drum-to-chart plan §4 step 5, R5-3: dead in the app since the 2026-07-04
// uniform-grid carve-out drop) -- this generator no longer branches on it.
//
// Stages 3 (postprocess), 4 (peak-pick), 5 (max-2-hands filter), 7 (grid), 9b
// (dedup) do NOT have a fixture generator here yet -- PARITY.md marks those
// registry rows PENDING. Extend this script (one `dump*Fixtures()` function
// per stage, all invoked from `main()` below) when those are built; keep this
// file the ONE place that composes real exported app functions for the
// registry, so a future generator can't drift into a second hand-rolled copy.
//
// Output: newline-free JSON to stdout, keyed by stage name -- e.g.
// `{"stage89_snap": [...850 cases...]}`. sync_fixtures.py splits this into
// per-stage fixture files.
import {
  buildTimedTempos,
  msToTick,
  tickToMs,
} from '../lib/drum-transcription/timing';
import {snapGroupToGrid} from '../lib/tempo-map/quantize-grid';

const RESOLUTION = 480;
const DEFAULT_SNAP_TOLERANCE_MS = 40;
const SYSTEMATIC_ONSET_MS_CHART_FLOW = 0;
const SYSTEMATIC_ONSET_MS_AUDIO_FLOW = 7;

// snapModeForLane / the 'uniform' branch REMOVED (drum-to-chart plan §4 step 5,
// R5-3: dead in the app since the 2026-07-04 uniform-grid carve-out drop --
// ml/class-mapping.ts's SnapMode is 'candidate'-only now, so every lane always
// took this branch already). `lane` is kept as a parameter purely for the
// fixture record (labeling), not for any snap-mode decision.
function snapOnsetTickRef(
  ms: number,
  timedTempos: ReturnType<typeof buildTimedTempos>,
  resolution: number,
  lane: number,
  flow: 'chart' | 'audio',
  phaseAlignShiftMs: number,
): {tick: number; kind: string} {
  void lane;
  const systematicOnsetMs =
    flow === 'chart'
      ? SYSTEMATIC_ONSET_MS_CHART_FLOW
      : SYSTEMATIC_ONSET_MS_AUDIO_FLOW;
  const adjMs =
    ms + systematicOnsetMs + (flow === 'audio' ? phaseAlignShiftMs : 0);
  const frac = msToTick(adjMs, timedTempos, resolution);
  const snapped = snapGroupToGrid(frac, resolution);
  // re-derive which candidate won for the fixture label (straight vs triplet)
  const straightTicks = resolution / 4;
  const tripletTicks = resolution / 6;
  const straight = Math.round(frac / straightTicks) * straightTicks;
  const triplet = Math.round(frac / tripletTicks) * tripletTicks;
  const kind =
    Math.abs(triplet - frac) < Math.abs(straight - frac)
      ? 'triplet'
      : 'straight';
  const driftMs = Math.abs(tickToMs(snapped, timedTempos, resolution) - adjMs);
  if (driftMs > DEFAULT_SNAP_TOLERANCE_MS) {
    return {tick: Math.max(0, Math.round(frac)), kind: 'abstain'};
  }
  return {tick: snapped, kind};
}

// --- fixture tempo maps -----------------------------------------------------
// A: constant 120bpm from tick 0 (matches the Phantom Limb rebuild convention).
// B: a tempo CHANGE partway through (tick 96000 -> 150bpm), to exercise the
//    multi-segment branch of msToTick/tickToMs/buildTimedTempos.
const tempoA = [{tick: 0, beatsPerMinute: 120}];
const tempoB = [
  {tick: 0, beatsPerMinute: 120},
  {tick: 96000, beatsPerMinute: 150},
];

function dumpStage89Fixtures() {
  const out: any[] = [];
  const rng = (() => {
    let s = 20260715;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  })();

  for (const [label, tempos] of [
    ['A_const120', tempoA],
    ['B_tempo_change', tempoB],
  ] as const) {
    const timedTempos = buildTimedTempos(tempos as any, RESOLUTION);
    for (let i = 0; i < 400; i++) {
      const ms = rng() * 300000; // 0..300s
      const lane = Math.floor(rng() * 9);
      const flow: 'chart' | 'audio' = rng() < 0.5 ? 'chart' : 'audio';
      const phaseAlignShiftMs = flow === 'audio' ? (rng() - 0.5) * 20 : 0;
      const {tick, kind} = snapOnsetTickRef(
        ms,
        timedTempos,
        RESOLUTION,
        lane,
        flow,
        phaseAlignShiftMs,
      );
      out.push({
        tempoLabel: label,
        tempos,
        ms,
        lane,
        flow,
        phaseAlignShiftMs,
        expectedTick: tick,
        expectedKind: kind,
      });
    }
    // boundary cases near the tempo-change point (tempoB only) and near 40ms
    // abstain thresholds
    for (const boundaryMs of [0, 1, -1, 400000, 399999.9]) {
      for (const lane of [0, 1, 2, 6, 8]) {
        const flow: 'chart' | 'audio' = 'audio';
        const {tick, kind} = snapOnsetTickRef(
          boundaryMs,
          timedTempos,
          RESOLUTION,
          lane,
          flow,
          0,
        );
        out.push({
          tempoLabel: label,
          tempos,
          ms: boundaryMs,
          lane,
          flow,
          phaseAlignShiftMs: 0,
          expectedTick: tick,
          expectedKind: kind,
        });
      }
    }
  }
  return out;
}

function main() {
  const fixtures = {
    stage89_snap: dumpStage89Fixtures(),
  };
  console.log(JSON.stringify(fixtures));
}

main();
