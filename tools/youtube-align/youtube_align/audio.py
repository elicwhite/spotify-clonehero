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
