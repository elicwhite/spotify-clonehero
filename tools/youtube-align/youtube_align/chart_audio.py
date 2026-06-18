"""Reconstruct a single mono reference mix from a chart's audio files.

Rules (matching the repo's conventions and the Contrarian review):
  - Prefer a single full mix (`song.*`) when present.
  - Otherwise equal-power sum (1/sqrt(n)) of the instrument stems, the same
    loudness-preserving mixdown as `lib/tempo-map/merge-audio.ts`.
  - Always exclude `preview.*` and `crowd.*` — they are not part of the song.
Returns (mono_pcm, mix_source) where mix_source is "full_mix" or "stem_sum".
"""

from __future__ import annotations

import numpy as np

from .audio import SR, decode_to_mono

AUDIO_EXTS = {"opus", "ogg", "mp3", "wav", "m4a", "flac"}
EXCLUDE_STEMS = {"preview", "crowd"}
# A file literally named "song" is the full pre-mixed track.
FULL_MIX_NAMES = {"song"}


def _basename(name: str) -> str:
    base = name.rsplit("/", 1)[-1]
    return base.rsplit(".", 1)[0].lower()


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def audio_file_names(names: list[str]) -> list[str]:
    out = []
    for n in names:
        if _ext(n) in AUDIO_EXTS and _basename(n) not in EXCLUDE_STEMS:
            out.append(n)
    return out


def build_reference_mix(
    audio: dict[str, bytes], sr: int = SR
) -> tuple[np.ndarray, str]:
    """`audio` maps filename -> raw encoded bytes. Returns (mono_pcm, mix_source)."""
    names = audio_file_names(list(audio.keys()))
    if not names:
        raise ValueError("no usable audio files in chart")

    full = [n for n in names if _basename(n) in FULL_MIX_NAMES]
    if full:
        return decode_to_mono(audio[full[0]], sr), "full_mix"

    stems = [decode_to_mono(audio[n], sr) for n in names]
    length = max(s.size for s in stems)
    mix = np.zeros(length, dtype=np.float64)
    for s in stems:
        mix[: s.size] += s
    gain = 1.0 / np.sqrt(len(stems))
    mix *= gain
    return mix.astype(np.float32), "stem_sum"
