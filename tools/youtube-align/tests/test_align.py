import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np

from youtube_align.align import align
from youtube_align.make_synthetic import (
    insert_gap,
    make_song,
    opus_roundtrip,
    prepend_silence,
    time_stretch,
)


def test_recovers_known_offset_through_opus():
    ref = make_song(40.0, seed=1)
    yt = opus_roundtrip(prepend_silence(ref, 1500.0))  # 1.5 s lead-in, lossy
    r = align(ref, yt)
    assert r.matched
    assert abs(r.audio_offset_ms - 1500.0) < 30.0, r.audio_offset_ms
    assert abs(r.speed_ratio - 1.0) < 0.002, r.speed_ratio
    assert r.aligned
    assert r.interruptions == []


def test_recovers_known_speed():
    ref = make_song(45.0, seed=2)
    yt = time_stretch(ref, 1.01)  # YouTube plays 1% faster
    r = align(ref, yt)
    assert r.matched
    assert abs(r.speed_ratio - 1.01) < 0.003, r.speed_ratio
    assert not r.aligned  # constant speed difference => drifts apart


def test_detects_mid_song_interruption():
    ref = make_song(45.0, seed=3)
    yt = prepend_silence(insert_gap(ref, at_ms=22000.0, ms=800.0), 500.0)
    r = align(ref, yt)
    assert r.matched
    assert len(r.interruptions) >= 1, r.interruptions
    worst = max(r.interruptions, key=lambda d: abs(d["jump_ms"]))
    assert abs(worst["at_ms"] - 22000.0) < 1500.0, worst
    assert abs(worst["jump_ms"] - 800.0) < 120.0, worst
    assert not r.aligned


def test_negative_unrelated_audio_abstains():
    ref = make_song(40.0, seed=4)
    other = make_song(40.0, seed=999)  # different song
    r = align(ref, other)
    assert not r.matched, (r.coverage, r.confidence)
