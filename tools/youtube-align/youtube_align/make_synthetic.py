"""Synthetic ground-truth generation for validating the aligner.

We cannot reach Encore or YouTube in the sandbox, so we manufacture a reference
"song" and derive fake "YouTube versions" with a KNOWN offset / speed / gap, then
assert the aligner recovers them. This validates the math precisely; it does NOT
substitute for a real-song spot-check (see README / plan 0050).
"""

from __future__ import annotations

import subprocess

import numpy as np

from .audio import SR


def make_song(seconds: float = 40.0, sr: int = SR, seed: int = 0) -> np.ndarray:
    """A pseudo-song whose content is unique to `seed`.

    Percussive broadband hits (sharp onsets) plus short pitched note bursts at
    seed-specific frequencies. No content is shared across seeds, so two
    different seeds are genuinely unrelated recordings.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    x = np.zeros(n, dtype=np.float32)
    scale = np.array([220, 247, 262, 294, 330, 349, 392, 440], dtype=np.float64)
    scale = scale * rng.uniform(0.94, 1.06)  # seed-specific detune
    period = rng.uniform(0.42, 0.6)  # seed-specific tempo
    t = 0.0
    while t < seconds - 0.6:
        start = int(t * sr)
        dur = int(0.25 * sr)
        idx = np.arange(dur)
        env = np.exp(-idx / (0.06 * sr)).astype(np.float32)
        # broadband percussive transient
        hit = rng.standard_normal(dur).astype(np.float32) * 0.6
        # one or two seed-specific pitched notes
        for f in rng.choice(scale, size=2, replace=False):
            hit += 0.5 * np.sin(2 * np.pi * f * idx / sr).astype(np.float32)
        x[start : start + dur] += env * hit
        t += period + rng.uniform(-0.04, 0.04)
    x /= np.max(np.abs(x)) + 1e-9
    return x


def prepend_silence(x: np.ndarray, ms: float, sr: int = SR) -> np.ndarray:
    pad = np.zeros(int(ms / 1000.0 * sr), dtype=x.dtype)
    return np.concatenate([pad, x])


def insert_gap(x: np.ndarray, at_ms: float, ms: float, sr: int = SR) -> np.ndarray:
    at = int(at_ms / 1000.0 * sr)
    gap = np.zeros(int(ms / 1000.0 * sr), dtype=x.dtype)
    return np.concatenate([x[:at], gap, x[at:]])


def time_stretch(x: np.ndarray, factor: float) -> np.ndarray:
    """Resample as if played at `factor` speed (factor>1 = faster/shorter)."""
    n = x.size
    src = np.arange(0, n - 1, factor, dtype=np.float64)
    return np.interp(src, np.arange(n), x).astype(np.float32)


def opus_roundtrip(x: np.ndarray, sr: int = SR, bitrate: str = "96k") -> np.ndarray:
    """Encode to Opus and decode back, to simulate a lossy YouTube re-upload."""
    enc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar",
         str(sr), "-ac", "1", "-i", "pipe:0", "-c:a", "libopus", "-b:a", bitrate,
         "-f", "ogg", "pipe:1"],
        input=x.astype(np.float32).tobytes(), stdout=subprocess.PIPE, check=True,
    ).stdout
    dec = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac",
         "1", "-ar", str(sr), "-f", "f32le", "pipe:1"],
        input=enc, stdout=subprocess.PIPE, check=True,
    ).stdout
    return np.frombuffer(dec, dtype=np.float32).copy()
