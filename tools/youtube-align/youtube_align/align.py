"""Whole-song alignment of a YouTube mix against a chart reference mix.

Pipeline:
  1. Coarse global offset from onset-envelope cross-correlation (robust, cheap).
  2. Dense offset(t) via GCC-PHAT on overlapping windows (sharp, EQ-robust).
  3. Interpret offset(t): linear fit -> speed_ratio; step discontinuities ->
     interruptions; residual coverage -> alignment verdict; PSR + coverage ->
     match / abstain.

Sign convention: a positive offset means YouTube content occurs *later* than the
chart content (YouTube has a longer intro / lead-in). To play YouTube aligned to
the chart audio, start YouTube `offset_ms` earlier.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .audio import SR, gcc_phat

# Window for dense local delay estimation.
WIN_SEC = 4.0
HOP_SEC = 2.0
MAX_LOCAL_LAG_SEC = 1.0
# Early span used for the unambiguous coarse offset estimate.
COARSE_SPAN_SEC = 25.0
MAX_COARSE_LAG_SEC = 25.0

# A window's delay estimate is trusted only above this peak-to-sidelobe ratio.
PSR_MIN = 4.0
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
COVERAGE_MATCH = 0.8
COVERAGE_ALIGNED = 0.9
SPEED_TOL = 0.002  # 0.2%


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


def coarse_offset_ms(chart: np.ndarray, yt: np.ndarray) -> tuple[float, float]:
    """Coarse global offset (ms) and its PSR.

    GCC-PHAT on an early raw-audio span. Phase-transform whitening makes the
    delay peak sharp and EQ-robust; using the raw waveform (not the onset
    envelope) avoids the periodic-peak ambiguity that steady drum beats create.
    """
    span = int(COARSE_SPAN_SEC * SR)
    c = chart[:span]
    # Widen the YouTube side so a lead-in offset still fits inside the window.
    y = yt[: span + int(MAX_COARSE_LAG_SEC * SR)]
    lag, psr = gcc_phat(y, c, max_lag=int(MAX_COARSE_LAG_SEC * SR))
    return lag / SR * 1000.0, psr  # yt later than chart => positive


def dense_offsets(
    chart: np.ndarray, yt: np.ndarray, coarse_ms: float
) -> list[tuple[float, float, float]]:
    """Per-window (t_seconds, total_offset_ms, psr) via GCC-PHAT."""
    win = int(WIN_SEC * SR)
    hop = int(HOP_SEC * SR)
    max_lag = int(MAX_LOCAL_LAG_SEC * SR)
    coarse = int(round(coarse_ms / 1000.0 * SR))
    out: list[tuple[float, float, float]] = []
    t = 0
    while t + win <= chart.size:
        yt_start = t + coarse
        if yt_start < 0 or yt_start + win > yt.size:
            t += hop
            continue
        cw = chart[t : t + win]
        yw = yt[yt_start : yt_start + win]
        local_lag, psr = gcc_phat(yw, cw, max_lag=max_lag)
        total = coarse + local_lag
        out.append((t / SR, total / SR * 1000.0, psr))
        t += hop
    return out


def _detect_interruptions(
    t: np.ndarray, off: np.ndarray, slope_ms_per_s: float
) -> tuple[list[dict], np.ndarray]:
    """Find step discontinuities in offset(t). Returns (interruptions, step-corrected offsets)."""
    interruptions: list[dict] = []
    corrected = off.copy()
    cum = 0.0
    for i in range(1, t.size):
        expected = slope_ms_per_s * (t[i] - t[i - 1])
        jump = (off[i] - off[i - 1]) - expected
        if abs(jump) > STEP_MS:
            at_ms = (t[i] + t[i - 1]) / 2.0 * 1000.0
            interruptions.append({"at_ms": round(at_ms, 1), "jump_ms": round(jump, 1)})
            cum += jump
        corrected[i] = off[i] - cum
    return interruptions, corrected


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

    # First robust slope (used to separate drift from interruptions).
    _, b0 = _theil_sen(t, off)
    interruptions, corrected = _detect_interruptions(t, off, b0)

    # Refit on step-corrected offsets for a clean offset + slope.
    a, b = _theil_sen(t, corrected)
    model = a + b * t
    residuals = corrected - model
    coverage = float(np.mean(np.abs(residuals) <= RESIDUAL_TOL_MS))

    speed_ratio = 1.0 / (1.0 + b / 1000.0)
    confidence = float(np.median(psr))
    matched = coverage >= COVERAGE_MATCH
    aligned = (
        coverage >= COVERAGE_ALIGNED
        and abs(speed_ratio - 1.0) < SPEED_TOL
        and len(interruptions) == 0
    )

    notes = ""
    if not matched:
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
    coarse_ms, coarse_psr = coarse_offset_ms(chart, yt)
    samples = dense_offsets(chart, yt, coarse_ms)
    result = interpret(samples)
    if not result.matched and not result.notes:
        result.notes = f"match=none (coarse psr {coarse_psr:.1f})"
    return result
