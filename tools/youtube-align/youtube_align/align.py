"""Whole-song alignment of a YouTube mix against a chart reference mix.

Pipeline:
  1. Dense offset(t) by a predictive left-to-right tracker (`dense_offsets`):
     several candidate initial offsets are tried, each tracked window-by-window
     with GCC-PHAT, and the most internally consistent track is kept. Each
     window searches a tight band around a short extrapolation of the recent
     good track (so a wrong-beat peak can't be selected); a confident off-track
     window that *persists* is treated as a real step (interruption) and the
     track re-locks. This follows drift and large steps without a lag ceiling
     and is robust to a bad initial lock.
  2. Interpret offset(t) (`interpret`): detect/remove steps on the raw offset
     (interruptions + magnitudes), fit the slope on the step-corrected series
     (speed_ratio), measure coverage of the flat corrected level over ALL
     windows, and gate match/abstain on coverage + PSR + step count.

Sign convention: a positive offset means YouTube content occurs *later* than the
chart content (YouTube has a longer intro / lead-in). To play YouTube aligned to
the chart audio with offset_ms > 0, start YouTube that many ms earlier (and the
reverse for a negative offset).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .audio import SR, phat_offset

# Window for dense local delay estimation.
WIN_SEC = 4.0
HOP_SEC = 2.0
# Tight band searched around the predicted track on normal windows. Narrower
# than a beat, so a wrong-beat peak can't be selected; wider than per-hop drift.
NARROW_LAG_SEC = 0.35
# Wider band searched only when the narrow search fails — used to catch a real
# step (interruption) the tight band would miss.
TRACK_LAG_SEC = 2.5
# Search radius before the first confident window locks (centered on the initial
# estimate, so it stays in GCC-PHAT's reliable equal-ish-length regime).
LOCK_LAG_SEC = 5.0
# A window whose offset lands within this of the predicted track is "on track".
# Larger than per-hop drift, smaller than a beat — so a wrong-beat peak is
# rejected rather than allowed to hijack the baseline.
ACCEPT_TOL_SEC = 0.25
# Initial offset estimate: equal-length early-window GCC-PHAT. Equal lengths keep
# PHAT out of the low-SNR regime where it whitens noise into spurious peaks.
INIT_SPAN_SEC = 20.0
MAX_INIT_LAG_SEC = 10.0

# A window's delay estimate is trusted only above this peak-to-sidelobe ratio.
PSR_MIN = 4.0
# A window is also required to reach this fraction of the running median PSR of
# accepted windows. Relative, so it adapts to each song's correlation scale (a
# post-gap window's weak in-band peak fails this even when it clears PSR_MIN).
REL_PSR_FRAC = 0.15
# Minimum trusted windows before we'll claim a match at all.
MIN_WINDOWS = 4
# Residual within this many ms counts as "aligned here".
RESIDUAL_TOL_MS = 50.0
# A consecutive offset jump beyond this (after removing local slope) is a
# mid-song interruption (inserted gap / ad / talking).
STEP_MS = 120.0
# Verdict thresholds. A genuine re-upload aligns across >90% of the song; a
# near-miss (same song, different mix) aligns only in patches. These need
# recalibration on real data — see plan 0050 / README.
COVERAGE_MATCH = 0.85
COVERAGE_ALIGNED = 0.9
# Median peak-to-sidelobe floor. Only a weak noise floor: a legit speed-changed
# match has PSR as low as ~10 (time-warp lowers the peak), which overlaps a
# structurally-similar near-miss — so absolute PSR can't separate those and
# COVERAGE is the real gate. On real cross-master audio this scale shifts; treat
# it as a knob to recalibrate. See plan 0050 / README.
CONFIDENCE_MIN = 8.0
SPEED_TOL = 0.002  # 0.2%
# Too many step discontinuities relative to the window count means the tracker
# is chasing noise, not following one recording -> abstain.
MAX_INTERRUPTION_FRACTION = 0.2


@dataclass
class AlignResult:
    matched: bool
    audio_offset_ms: float  # YouTube vs chart *audio* (excludes chart delay)
    speed_ratio: float  # YouTube playback speed relative to chart (1.0 = same)
    aligned: bool  # stays aligned with ~constant offset across whole song
    coverage: float
    confidence: float  # median PSR of trusted windows
    interruptions: list[dict] = field(default_factory=list)
    notes: str = ""
    samples: list[tuple[float, float, float]] = field(default_factory=list)  # (t_s, offset_ms, psr)


def _theil_sen(t: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Robust line fit y = a + b*t. Returns (a, b). b is ms per second."""
    n = t.size
    if n < 2:
        return (float(y[0]) if n else 0.0), 0.0
    # median of pairwise slopes
    slopes = []
    for i in range(n):
        dt = t[i + 1 :] - t[i]
        dy = y[i + 1 :] - y[i]
        mask = np.abs(dt) > 1e-9
        slopes.append(dy[mask] / dt[mask])
    b = float(np.median(np.concatenate(slopes)))
    a = float(np.median(y - b * t))
    return a, b


def _window_offset(
    chart: np.ndarray, yt: np.ndarray, t: int, win: int, center: int, search_radius: int
) -> tuple[int, float] | None:
    """Absolute YouTube-vs-chart offset (samples) for the chart window at `t`.

    The peak is searched only in `[center ± search_radius]`, but the YouTube
    region (and thus the PSR judgment) always spans the wider track radius so a
    real step shows up as a low-PSR narrow search. Returns (offset, psr); a chart
    sample `m` is expected at YouTube index `m + offset`. None if out of bounds.
    """
    region_r = max(search_radius, int(TRACK_LAG_SEC * SR))
    lo = max(0, t + center - region_r)
    hi = min(yt.size, t + center + win + region_r)
    if hi - lo < win:
        return None
    yseg = yt[lo:hi]
    cw = chart[t : t + win]
    base = lo - t  # offset = base + lag
    lag, psr = phat_offset(yseg, cw, (center - search_radius) - base, (center + search_radius) - base)
    return base + lag, psr


def initial_candidates(chart: np.ndarray, yt: np.ndarray, k: int = 4) -> list[int]:
    """Candidate seed offsets (samples): the top-k PHAT peaks from equal-length
    early windows, plus 0. Equal-length windows keep PHAT in its reliable regime,
    but under drift the true peak isn't always the global max — so we try several
    and let the tracker's consistency pick the winner.
    """
    span = min(chart.size, yt.size, int(INIT_SPAN_SEC * SR))
    if span <= 0:
        return [0]
    a, b = yt[:span], chart[:span]
    n = 1
    while n < a.size + b.size:
        n <<= 1
    R = np.fft.rfft(a, n) * np.conj(np.fft.rfft(b, n))
    R /= np.abs(R) + 1e-10
    cc = np.fft.irfft(R, n)
    max_lag = int(MAX_INIT_LAG_SEC * SR)
    lags = np.arange(-max_lag, max_lag + 1)
    vals = np.abs(cc[lags % n])
    cands: list[int] = []
    guard = int(0.2 * SR)
    order = np.argsort(vals)[::-1]
    for idx in order:
        lag = int(lags[idx])
        if all(abs(lag - c) > guard for c in cands):
            cands.append(lag)
        if len(cands) >= k:
            break
    if 0 not in cands:
        cands.append(0)
    return cands


def _track_consistency(out: list[tuple[float, float, float]]) -> float:
    """Score a candidate track by its post-step-removal coverage. This rewards a
    track that follows the whole song — including across an interruption — and
    penalizes a bad lock or a track that only fits one segment."""
    return interpret(out).coverage


def _predict(recent: list[tuple[int, int]], t: int) -> int:
    """Extrapolate the offset at chart-sample `t` from recent accepted points."""
    if not recent:
        return 0
    if len(recent) == 1:
        return recent[-1][1]
    (t0, o0), (t1, o1) = recent[-2], recent[-1]
    if t1 == t0:
        return o1
    slope = (o1 - o0) / (t1 - t0)
    return int(o1 + slope * (t - t1))


def dense_offsets(chart: np.ndarray, yt: np.ndarray) -> list[tuple[float, float, float]]:
    """Per-window (t_seconds, offset_ms, psr), picking the most consistent track
    among several candidate initial offsets (robust to a bad initial lock)."""
    best: list[tuple[float, float, float]] = []
    best_score = -1.0
    for init in initial_candidates(chart, yt):
        out = _track_from(chart, yt, init)
        score = _track_consistency(out)
        if score > best_score:
            best_score, best = score, out
    return best


def _track_from(chart: np.ndarray, yt: np.ndarray, init: int) -> list[tuple[float, float, float]]:
    """Predictive tracker from a fixed initial offset: per-window (t, offset, psr).

    The search is centered on a short extrapolation of the recent good track.
    A confident window that lands on the prediction is accepted; a confident
    window that lands off-prediction is held as `pending` (a single wrong-beat
    glitch is ignored, so it can't hijack the baseline), but two consistent
    off-prediction windows are treated as a real step (interruption) and the
    track re-locks to the new level.
    """
    win = int(WIN_SEC * SR)
    hop = int(HOP_SEC * SR)
    lock_lag = int(LOCK_LAG_SEC * SR)
    narrow_lag = int(NARROW_LAG_SEC * SR)
    track_lag = int(TRACK_LAG_SEC * SR)
    accept_tol = int(ACCEPT_TOL_SEC * SR)
    out: list[tuple[float, float, float]] = []
    recent: list[tuple[int, int, float]] = []  # (t, offset, psr)
    pending: list[tuple[int, int, float]] = []
    t = 0
    while t + win <= chart.size:
        if recent:
            predicted = _predict([(rt, ro) for rt, ro, _ in recent], t)
            thr = max(PSR_MIN, REL_PSR_FRAC * float(np.median([p for _, _, p in recent])))
            # Tier 1: tight band around the prediction. A wrong-beat false peak is
            # outside this band, so it can't be selected; a confident, on-track
            # peak is accepted.
            rn = _window_offset(chart, yt, t, win, center=predicted, search_radius=narrow_lag)
            if rn is not None and rn[1] >= thr and abs(rn[0] - predicted) <= accept_tol:
                out.append((t / SR, rn[0] / SR * 1000.0, rn[1]))
                recent.append((t, rn[0], rn[1]))
                recent = recent[-5:]
                pending = []
                t += hop
                continue
            # Tier 2: wider band to look for a real step / re-acquire.
            res = _window_offset(chart, yt, t, win, center=predicted, search_radius=track_lag)
        else:
            res = _window_offset(chart, yt, t, win, center=init, search_radius=lock_lag)
            predicted = init
            thr = PSR_MIN
        if res is None:
            t += hop
            continue
        offset, psr = res
        out.append((t / SR, offset / SR * 1000.0, psr))
        if psr >= thr and abs(offset - predicted) <= accept_tol:
            recent.append((t, offset, psr))
            recent = recent[-5:]
            pending = []
        elif psr >= thr:
            pending.append((t, offset, psr))
            if len(pending) >= 2 and abs(pending[-1][1] - pending[-2][1]) <= accept_tol:
                recent = pending[-2:]  # persistent step: re-lock to the new level
                pending = []
        t += hop
    return out


def interpret(samples: list[tuple[float, float, float]]) -> AlignResult:
    trusted = [(t, o, p) for (t, o, p) in samples if p >= PSR_MIN]
    if len(trusted) < MIN_WINDOWS:
        return AlignResult(
            matched=False,
            audio_offset_ms=0.0,
            speed_ratio=1.0,
            aligned=False,
            coverage=0.0,
            confidence=float(np.median([p for _, _, p in samples])) if samples else 0.0,
            notes="match=none (too few trusted windows)",
            samples=samples,
        )

    t = np.array([s[0] for s in trusted])
    off = np.array([s[1] for s in trusted])
    psr = np.array([s[2] for s in trusted])

    # Interruptions are steps in the RAW offset (which is piecewise-flat; a real
    # ±1% speed drift is < STEP_MS across a few windows, so it doesn't trip this).
    # Detect and measure each with a before/after median — robust to the straddle
    # window and to single-window glitches. We measure on the raw offset because a
    # step badly contaminates a global slope fit.
    interruptions: list[dict] = []
    steps: list[tuple[int, float]] = []
    w = 3
    i = 1
    while i < t.size:
        before = float(np.median(off[max(0, i - w) : i]))
        after = float(np.median(off[i : i + w]))
        jump = after - before
        if abs(jump) > STEP_MS:
            # Localize the boundary at the largest actual adjacent jump nearby,
            # and apply the correction from that index onward.
            lo_j, hi_j = max(1, i - w + 1), min(t.size, i + w)
            j = max(range(lo_j, hi_j), key=lambda k: abs(off[k] - off[k - 1]))
            at_ms = (t[j] + t[j - 1]) / 2.0 * 1000.0
            interruptions.append({"at_ms": round(at_ms, 1), "jump_ms": round(jump, 1)})
            steps.append((j, jump))
            i = hi_j  # skip the transition so it isn't re-counted
        else:
            i += 1

    # Remove the steps, then fit the slope on the corrected series for a clean
    # speed estimate, and measure coverage against that flat corrected level.
    corrected = off.copy()
    for idx, jump in steps:
        corrected[idx:] -= jump
    _, b = _theil_sen(t, corrected)
    detr = corrected - b * t
    a = float(np.median(detr))

    # Coverage is over ALL windows (trusted or not): a trusted window counts only
    # if it sits on the corrected flat level. So a near-miss whose bad half drops
    # out of `trusted` (or whose offsets are garbage) can't inflate coverage.
    inlier = np.abs(detr - a) <= RESIDUAL_TOL_MS
    coverage = float(np.sum(inlier) / len(samples))

    speed_ratio = 1.0 / (1.0 + b / 1000.0)
    confidence = float(np.median(psr))
    too_many_steps = len(interruptions) > MAX_INTERRUPTION_FRACTION * len(trusted)
    matched = (
        coverage >= COVERAGE_MATCH
        and confidence >= CONFIDENCE_MIN
        and not too_many_steps
    )
    aligned = (
        matched
        and coverage >= COVERAGE_ALIGNED
        and abs(speed_ratio - 1.0) < SPEED_TOL
        and len(interruptions) == 0
    )

    notes = ""
    if not matched:
        if too_many_steps:
            notes = "match=none (unstable tracking)"
        elif confidence < CONFIDENCE_MIN:
            notes = "match=none (low confidence)"
        else:
            notes = "match=none (low coverage)"

    return AlignResult(
        matched=matched,
        audio_offset_ms=round(a, 1),
        speed_ratio=round(speed_ratio, 5),
        aligned=aligned,
        coverage=round(coverage, 3),
        confidence=round(confidence, 2),
        interruptions=interruptions,
        notes=notes,
        samples=samples,
    )


def align(chart: np.ndarray, yt: np.ndarray) -> AlignResult:
    samples = dense_offsets(chart, yt)
    return interpret(samples)
