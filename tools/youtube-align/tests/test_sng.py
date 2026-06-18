import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from youtube_align.sng import build_sng, parse_sng


def test_sng_roundtrip():
    meta = {"name": "Test Song", "artist": "Test Artist", "delay": "2000"}
    files = {
        "notes.chart": b"[Song]\n{\n}\n",
        "song.opus": bytes(range(256)) * 4,
        "guitar.opus": b"\x00\x01\x02hello world stem data",
    }
    raw = build_sng(meta, files, xor_mask=bytes(range(10, 26)))
    sng = parse_sng(raw)

    assert sng.metadata["name"] == "Test Song"
    assert sng.metadata["delay"] == "2000"
    assert {f.name for f in sng.files} == set(files)
    for name, data in files.items():
        assert sng.read(name) == data, name


def test_sng_masking_resets_per_file():
    # Two identical files must unmask identically (counter resets per file).
    payload = bytes(range(200))
    raw = build_sng({}, {"a.bin": payload, "b.bin": payload}, xor_mask=bytes(range(16)))
    sng = parse_sng(raw)
    assert sng.read("a.bin") == payload
    assert sng.read("b.bin") == payload
