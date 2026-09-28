"""Musical timing of the logo sting, in sting-local frames.

The sting covers `length` frames starting at film frame `start`, at `fps`.
Its events are film frames from an events JSON (see README.md):

  kicks    the pushes: the first brings the mark in, the second is the impact
  flashes  lane-light flashes after the impact ({frame, lane}; lane 0-4 is
           green, red, yellow, blue, orange)
  sheens   downbeats for the soft sheen across the face during the idle

Missing events degrade gracefully: with one kick that kick is the impact and
the mark flies in for FLY_IN_SEC before it; with none it flies in from the
first frame. Durations are in seconds, so the motion is the same at any fps.
"""

import json
import math

SETTLE_SEC = 0.317  # the hit's wobble is gone this long after the impact
FLASH_TAIL_SEC = 0.05  # for the last flash to die away
SHEEN_HALF_SEC = 0.433  # a sheen spans +-this around its downbeat
FLY_IN_SEC = 0.55  # fly-in length when the events give no first push

# Clone Hero lanes left to right; a lane's index is its guitar fret.
LANE_ORDER = ['green', 'red', 'yellow', 'blue', 'orange']


def _lane_index(lane):
    if isinstance(lane, str):
        if lane not in LANE_ORDER:
            raise SystemExit(f'unknown lane "{lane}"; use one of {LANE_ORDER} or 0-4')
        return LANE_ORDER.index(lane)
    if not isinstance(lane, int) or not 0 <= lane < len(LANE_ORDER):
        raise SystemExit(f'lane {lane!r} is not 0-4')
    return lane


class Timing:
    """The sting's events in sting-local frames, and its frame rate."""

    def __init__(self, fps, length, global_start, kicks, flashes, sheens, log=print):
        if fps <= 0 or length < 2:
            raise SystemExit(f'need fps > 0 and at least 2 frames, got fps {fps}, length {length}')
        self.fps = fps
        self.length = length
        self.last = length - 1
        self.global_start = global_start
        inside = sorted({k for k in kicks if 0 <= k <= self.last})
        fly_in = max(1, round(FLY_IN_SEC * fps))
        if len(inside) >= 2:
            self.appear, self.impact = inside[0], inside[1]
        elif len(inside) == 1:
            self.impact = inside[0]
            self.appear = max(0, self.impact - fly_in)
        else:
            self.appear = 0
            self.impact = min(fly_in, self.last)
        if len(inside) < 2:
            log(f'{len(inside)} kick(s) inside the sting: appear {self.appear}, impact {self.impact}')
        self.flashes = sorted((f, lane) for f, lane in flashes if self.impact < f <= self.last)
        dropped = len(flashes) - len(self.flashes)
        if dropped:
            log(f'{dropped} flash(es) outside ({self.impact}, {self.last}] dropped')
        self.last_flash = max([f for f, _ in self.flashes], default=self.impact)
        rest = math.ceil(max(self.impact + self.frames(SETTLE_SEC),
                             self.last_flash + self.frames(FLASH_TAIL_SEC)))
        if rest > self.last:
            log(f'the sting ends {rest - self.last} frames before the settle does; the last frame snaps to rest')
        self.rest = min(rest, self.last)
        half = self.frames(SHEEN_HALF_SEC)
        # a sheen must start after the rest frame and finish before the last
        # frame, so both stay exactly the resting pose
        self.sheens = [b for b in sorted(set(sheens)) if self.rest + half <= b <= self.last - half]

    def frames(self, sec):
        """A duration in (fractional) frames."""
        return sec * self.fps

    @classmethod
    def from_events(cls, path, fps, start, length, log=print):
        """Reads an events JSON of film frames. `fps`, `start` (the --from
        flag) and `length` may be None to take them from the file; given both
        ways, they must agree."""
        with open(path) as fh:
            ev = json.load(fh)

        def pick(field, flag, value):
            in_file = ev.get(field)
            if value is None and in_file is None:
                raise SystemExit(f'give --{flag} (the events file has no "{field}")')
            if value is not None and in_file is not None and value != in_file:
                raise SystemExit(f'--{flag} {value} disagrees with the events file\'s {field} ({in_file})')
            return value if value is not None else in_file

        fps = pick('fps', 'fps', fps)
        start = pick('start', 'from', start)
        length = pick('length', 'length', length)
        kicks = [k - start for k in ev.get('kicks', [])]
        flashes = [(fl['frame'] - start, _lane_index(fl.get('lane', 0)))
                   for fl in ev.get('flashes', [])]
        sheens = [s - start for s in ev.get('sheens', [])]
        return cls(fps, length, start, kicks, flashes, sheens, log)

    def describe(self):
        return (f'{self.length} frames at {self.fps} fps from film frame {self.global_start}; '
                f'appear {self.appear}, impact {self.impact}, flashes {self.flashes}, '
                f'rest {self.rest} and {self.last}, sheens {self.sheens}')
