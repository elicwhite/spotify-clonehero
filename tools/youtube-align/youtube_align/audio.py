"""Audio decoding and DSP primitives.

Everything decodes through one ffmpeg invocation to a common mono sample rate so
the two sides we compare share an identical timebase (naive per-side resampling
introduces sub-frame drift that corrupts offset estimates).
"""

from __future__ import annotations

import subprocess

import numpy as np

# Feature sample rate. 16 kHz is plenty for the phase-transform delay estimate
# and keeps correlations cheap at corpus scale.
SR = 16000


def decode_to_mono(source: str | bytes, sr: int = SR) -> np.ndarray:
    """Decode a file path or raw bytes to a mono float32 numpy array at `sr`.

    Uses ffmpeg, which reads opus/ogg/mp3/wav/m4a transparently.
    """
    stdin = None
    inp = source
    if isinstance(source, bytes):
        inp = "pipe:0"
        stdin = source
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inp,  # type: ignore[list-item]
        "-ac",
        "1",
        "-ar",
        str(sr),
        "-f",
        "f32le",
        "-",
    ]
    proc = subprocess.run(cmd, input=stdin, stdout=subprocess.PIPE, check=True)
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def phat_offset(a: np.ndarray, b: np.ndarray, search_lo: int, search_hi: int) -> tuple[int, float]:
    """GCC-PHAT delay: peak chosen within lags `[search_lo, search_hi]`, but the
    peak-to-sidelobe ratio judged over ALL valid lags.

    Searching a narrow band keeps a wrong-beat peak from being *selected*; judging
    PSR over the wide range means a window whose true peak lies outside the band
    (e.g. after an inserted gap) scores low — which is the signal to escalate.
    Returns (lag, psr) with `a[n] ≈ b[n - lag]`.
    """
    n = 1
    while n < a.size + b.size:
        n <<= 1
    R = np.fft.rfft(a, n) * np.conj(np.fft.rfft(b, n))
    R /= np.abs(R) + 1e-10
    cc = np.fft.irfft(R, n)

    lo_l, hi_l = -(b.size - 1), a.size - 1  # valid overlap lags
    all_lags = np.arange(lo_l, hi_l + 1)
    all_vals = np.abs(cc[all_lags % n])

    s_lo, s_hi = max(search_lo, lo_l), min(search_hi, hi_l)
    if s_hi < s_lo:
        return 0, 0.0
    band = np.arange(s_lo, s_hi + 1)
    bvals = np.abs(cc[band % n])
    j = int(np.argmax(bvals))
    lag, peak = int(band[j]), float(bvals[j])

    guard = 8
    side_mask = np.abs(all_lags - lag) > guard
    sidelobe = float(all_vals[side_mask].std()) if side_mask.any() else 0.0
    psr = peak / sidelobe if sidelobe > 1e-12 else (float("inf") if peak > 0 else 0.0)
    return lag, psr


def gcc_phat(a: np.ndarray, b: np.ndarray, max_lag: int | None = None) -> tuple[int, float]:
    """Generalized cross-correlation with phase transform (GCC-PHAT).

    Whitens the cross-spectrum magnitude, so the delay peak is sharp and robust
    to the EQ / mastering / limiting differences between a copyright master and a
    YouTube re-upload. Returns (lag_in_samples, psr).
    """
    n = 1
    while n < a.size + b.size:
        n <<= 1
    A = np.fft.rfft(a, n)
    B = np.fft.rfft(b, n)
    R = A * np.conj(B)
    R /= np.abs(R) + 1e-10
    cc = np.fft.irfft(R, n)
    max_shift = n // 2 if max_lag is None else min(max_lag, n // 2)
    cc = np.concatenate([cc[-max_shift:], cc[: max_shift + 1]])
    peak = int(np.argmax(np.abs(cc)))
    lag = peak - max_shift
    psr = _peak_to_sidelobe(np.abs(cc), peak)
    return lag, psr


def _peak_to_sidelobe(cc: np.ndarray, peak: int, guard: int = 8) -> float:
    """Peak value divided by the std of the correlation outside a guard window.

    A high ratio means one dominant, unambiguous alignment; a low ratio means
    the peak is no better than noise (silence, or a wrong/near-miss recording).
    """
    pk = abs(float(cc[peak]))
    masked = cc.copy()
    lo = max(0, peak - guard)
    hi = min(cc.size, peak + guard + 1)
    masked[lo:hi] = 0.0
    sidelobe = float(np.std(masked))
    if sidelobe <= 1e-12:
        return float("inf") if pk > 0 else 0.0
    return pk / sidelobe
