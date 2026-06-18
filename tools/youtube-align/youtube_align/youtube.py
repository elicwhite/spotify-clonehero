"""YouTube search + audio download via yt-dlp.

Network-gated: in the development sandbox YouTube is blocked
(`host_not_allowed`). These functions run only where youtube.com /
googlevideo.com are reachable.
"""

from __future__ import annotations

import json
import subprocess
import tempfile


def search(artist: str, name: str, limit: int = 5) -> list[dict]:
    """Return up to `limit` candidate videos as {url, title, duration}."""
    query = f"ytsearch{limit}:{artist} {name}".strip()
    proc = subprocess.run(
        ["yt-dlp", "--no-warnings", "--flat-playlist", "-J", query],
        stdout=subprocess.PIPE, check=True,
    )
    data = json.loads(proc.stdout)
    out = []
    for e in data.get("entries", []):
        vid = e.get("id")
        if not vid:
            continue
        out.append(
            {
                "url": f"https://www.youtube.com/watch?v={vid}",
                "title": e.get("title", ""),
                "duration": e.get("duration"),
            }
        )
    return out


def download_audio(url: str) -> bytes:
    """Download bestaudio for `url` and return raw encoded bytes."""
    with tempfile.NamedTemporaryFile(suffix=".webm") as tmp:
        subprocess.run(
            ["yt-dlp", "--no-warnings", "-f", "bestaudio", "-o", tmp.name,
             "--force-overwrites", url],
            check=True,
        )
        with open(tmp.name, "rb") as f:
            return f.read()
