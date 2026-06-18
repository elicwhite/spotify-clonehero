import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from youtube_align.align import AlignResult
from youtube_align.pipeline import chart_delay_ms, to_row


def test_chart_delay_precedence():
    assert chart_delay_ms({"delay": "2000"}) == 2000.0
    # chart_offset is seconds, used only as fallback
    assert chart_delay_ms({"chart_offset": "1.5"}) == 1500.0
    assert chart_delay_ms({"delay": "2000", "chart_offset": "1.5"}) == 2000.0
    assert chart_delay_ms({}) == 0.0
    assert chart_delay_ms({"delay": "0", "chart_offset": "0.25"}) == 250.0


def test_offset_is_chart_note_relative():
    # YouTube sits 1500 ms after the bundled audio; the chart's notes are 2000 ms
    # after the bundled audio. To line YouTube up with the NOTES we need both.
    result = AlignResult(
        matched=True,
        audio_offset_ms=1500.0,
        speed_ratio=1.0,
        aligned=True,
        coverage=1.0,
        confidence=12.0,
    )
    row = to_row("md5x", "https://y", {"delay": "2000"}, "full_mix", result)
    assert row["audio_offset_ms"] == 1500.0
    assert row["delay_ms"] == 2000.0
    assert row["offset_ms"] == 3500.0  # 1500 + 2000


def test_no_match_blanks_url_and_offset():
    result = AlignResult(False, 0.0, 1.0, False, 0.2, 3.0, notes="match=none")
    row = to_row("md5x", "https://y", {"delay": "2000"}, "stem_sum", result)
    assert row["youtube_url"] == ""
    assert row["offset_ms"] == ""
    assert row["aligned"] is False
