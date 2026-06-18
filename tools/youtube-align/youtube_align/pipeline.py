"""Per-chart orchestration + CSV output.

For each chart:
  1. Download the `.sng` from Encore and unpack it.
  2. Reconstruct the chart reference mix (full mix, or equal-power stem sum).
  3. Search YouTube for the artist/title and pick the candidate that ALIGNS
     best (coverage + PSR), not the top search rank.
  4. Align YouTube audio to the chart mix; convert to a chart-NOTE-relative
     offset by adding the chart delay.
  5. Emit a CSV row.

Network steps (Encore download, YouTube search/download) only run where those
hosts are reachable. The `--demo` path validates everything offline against a
synthetic ground-truth pair.
"""

from __future__ import annotations

import argparse
import csv
import sys

import numpy as np

from .align import AlignResult, align
from .chart_audio import build_reference_mix
from .sng import parse_sng

ENCORE_FILE_URL = "https://files.enchor.us/{md5}.sng"

CSV_COLUMNS = [
    "chart_md5",
    "youtube_url",
    "offset_ms",
    "audio_offset_ms",
    "delay_ms",
    "speed_ratio",
    "aligned",
    "coverage",
    "confidence",
    "mix_source",
    "interruptions",
    "notes",
]


def chart_delay_ms(metadata: dict[str, str]) -> float:
    """Normalized chart delay in ms. Mirrors `getChartDelayMs` (plan 0027):
    `delay` (ms) takes precedence; `chart_offset` (seconds) is the fallback."""
    delay = metadata.get("delay")
    if delay not in (None, "", "0"):
        try:
            return float(delay)
        except ValueError:
            pass
    off = metadata.get("chart_offset")
    if off not in (None, ""):
        try:
            return float(off) * 1000.0
        except ValueError:
            pass
    return 0.0


def to_row(
    chart_md5: str,
    youtube_url: str,
    metadata: dict[str, str],
    mix_source: str,
    result: AlignResult,
) -> dict:
    """Build a CSV row. `offset_ms` is chart-NOTE-relative: the YouTube-vs-audio
    offset plus the chart's own audio delay."""
    import json

    delay = chart_delay_ms(metadata)
    offset_ms = result.audio_offset_ms + delay if result.matched else ""
    return {
        "chart_md5": chart_md5,
        "youtube_url": youtube_url if result.matched else "",
        "offset_ms": round(offset_ms, 1) if result.matched else "",
        "audio_offset_ms": result.audio_offset_ms if result.matched else "",
        "delay_ms": round(delay, 1),
        "speed_ratio": result.speed_ratio if result.matched else "",
        "aligned": result.aligned if result.matched else False,
        "coverage": result.coverage,
        "confidence": result.confidence,
        "mix_source": mix_source,
        "interruptions": json.dumps(result.interruptions),
        "notes": result.notes,
    }


def process_md5(md5: str) -> dict:
    """Full network pipeline for one chart md5. Requires Encore + YouTube."""
    import requests  # local import: only needed on the networked path

    from . import youtube

    raw = requests.get(ENCORE_FILE_URL.format(md5=md5)).content
    sng = parse_sng(raw)
    audio = {f.name: sng.read(f.name) for f in sng.files
             if f.name.rsplit(".", 1)[-1].lower()
             in {"opus", "ogg", "mp3", "wav", "m4a", "flac"}}
    chart_mix, mix_source = build_reference_mix(audio)

    artist = sng.metadata.get("artist", "")
    name = sng.metadata.get("name", "")
    candidates = youtube.search(artist, name)

    best: tuple[AlignResult, str] | None = None
    for cand in candidates:
        yt_pcm = _decode_bytes(youtube.download_audio(cand["url"]))
        res = align(chart_mix, yt_pcm)
        if res.matched and (best is None or res.coverage > best[0].coverage):
            best = (res, cand["url"])
        if best and best[0].coverage > 0.97:
            break

    if best is None:
        empty = AlignResult(False, 0.0, 1.0, False, 0.0, 0.0, notes="match=none")
        return to_row(md5, "", sng.metadata, mix_source, empty)
    return to_row(md5, best[1], sng.metadata, mix_source, best[0])


def _decode_bytes(data: bytes) -> np.ndarray:
    from .audio import decode_to_mono

    return decode_to_mono(data)


def _demo() -> dict:
    """Offline end-to-end demo: synthetic chart mix + a fake YouTube re-upload
    (1.2 s lead-in, lossy Opus) with a chart delay of 1000 ms."""
    from .make_synthetic import make_song, opus_roundtrip, prepend_silence

    ref = make_song(40.0, seed=7)
    yt = opus_roundtrip(prepend_silence(ref, 1200.0))
    result = align(ref, yt)
    metadata = {"artist": "Demo Artist", "name": "Demo Song", "delay": "1000"}
    return to_row("demomd5", "https://youtu.be/DEMO", metadata, "stem_sum", result)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="YouTube ↔ chart audio alignment")
    ap.add_argument("--md5", help="Encore chart md5 (requires network)")
    ap.add_argument("--demo", action="store_true", help="run the offline demo")
    ap.add_argument("--out", default="-", help="CSV output path (default stdout)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    if args.demo:
        row = _demo()
    elif args.md5:
        row = process_md5(args.md5)
    else:
        ap.error("provide --md5 <hash> or --demo")
        return 2

    out = sys.stdout if args.out == "-" else open(args.out, "w", newline="")
    writer = csv.DictWriter(out, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    writer.writerow(row)
    if out is not sys.stdout:
        out.close()
    if args.verbose:
        print(row, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
