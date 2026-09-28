"""Motion of the mark and of the lights, as pure functions of the frame, and
the keyframes that carry them into the scene. Rates and decays are per
second, so the motion is the same at any frame rate."""

import math

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

from sting_look import CATCH_ENERGY, CATCH_FROM_DEG, CATCH_RADIUS, CATCH_TO_DEG, SHEEN_TILT_DEG
from sting_timing import SETTLE_SEC, SHEEN_HALF_SEC

APPEAR_SCALE = 0.1  # apparent size when the mark pops in, relative to rest
# 1.25 turns: with the leaned axis the mark pops in showing its face at a
# steep angle (1.5 turns would start exactly edge-on), goes face-on, flips
# edge-on, and whips back to frontal through the final approach.
TUMBLE_TURNS = 1.25
# The tumble axis leans TUMBLE_LEAN_DEG out of the face plane toward the view
# axis. Turning about it, the face normal stays within 2 * (90 - lean) degrees
# of the camera, so the tumble shows the glyph and the bevel nearly the whole
# way in and only a sliver of the plain back.
TUMBLE_LEAN_DEG = 35.0
TUMBLE_AXIS = (Vector((0.3, 1.0, 0.0)).normalized() * math.cos(math.radians(TUMBLE_LEAN_DEG))
               + Vector((0.0, 0.0, 1.0)) * math.sin(math.radians(TUMBLE_LEAN_DEG))).normalized()
NUTATION_DEG = 24.0  # secondary wobble of the tumble, gone by the hit
SQUASH_DEPTH = 0.85  # depth scale on the impact frame
SQUASH_BULGE = 0.25  # xy scale = depth ** -SQUASH_BULGE
RECOIL_SIZE = 0.035  # how far the rebound shrinks the mark (fraction of size)
WOBBLE_YAW_DEG = 6.5
WOBBLE_PITCH_DEG = 2.5
# The settle's springs: (angular rate rad/s, decay 1/s).
RECOIL_SPRING = (7.5 * math.pi, 8.4)
PITCH_SPRING = (8.571 * math.pi, 9.0)
SQUASH_SPRING = (12 * math.pi, 9.6)
RECOIL_PEAK = 0.608  # the largest value of the recoil spring's damped sine
SETTLE_FADE_SEC = 0.133  # the settle tapers to exactly nothing over its last this long
FLASH_SCALE = 0.012  # size punch per flash
FLASH_NOD_DEG = 0.6
FLASH_DECAY_SEC = 0.0267
IMPACT_FLARE = 3.0  # rim lights at the hit, times their base energy
IMPACT_FLARE_SEC = 0.1  # its decay time
FLASH_LIGHT = 8.0  # a flash's lane light, times its base energy
IDLE_SWAY_DEG = 3.0
IDLE_ROLL_DEG = 0.6
IDLE_PITCH_DEG = 1.0
IDLE_FLOAT_FRAC = 0.00324  # float amplitude over the frame side (3.5 px on a 1080 px frame)
IDLE_RAMP_SEC = 1.0  # the idle motion fades in over this after the rest frame
SHEEN_ARC_DEG = 80.0
SHEEN_SLOW = 4.4  # how much the sheen's orbit slows through the middle


def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def taper(x, start, end):
    """1 until start, a cosine taper to exactly 0 at end."""
    if x <= start:
        return 1.0
    if x >= end:
        return 0.0
    return 0.5 + 0.5 * math.cos(math.pi * (x - start) / (end - start))


def damped_sin(t, spring):
    omega, decay = spring
    return math.exp(-decay * t) * math.sin(omega * t)


def damped_cos(t, spring):
    omega, decay = spring
    return math.exp(-decay * t) * math.cos(omega * t)


REST_POSE = ((0.0, 0.0, 0.0), Quaternion(), (1.0, 1.0, 1.0))


class Motion:
    """Pose of the mark and the light levels as pure functions of the frame."""

    def __init__(self, timing, cam_dist, float_units):
        self.tm = timing
        self.cam_dist = cam_dist
        self.float_units = float_units

    def sec(self, frames):
        return frames / self.tm.fps

    # fly-in -----------------------------------------------------------------
    @staticmethod
    def approach_progress(t):
        # log-size progress: a steady zoom that kicks hard into the last frames
        w, n = 0.2, 8
        return (1 - w) * t + (w * t ** n if t > 0 else 0.0)

    @staticmethod
    def spin_progress(t):
        # a steady tumble that picks up a little speed into the hit
        w = 0.15
        return (1 - w) * t + (w * t * t if t > 0 else 0.0)

    def flyin_at(self, t):
        """The pose at fly-in progress t (0 = appears, 1 = the impact)."""
        t = min(t, 1.0)
        size = math.exp(math.log(APPEAR_SCALE) * (1 - self.approach_progress(t)))
        z = self.cam_dist * (1 - 1 / size)
        remaining = 1 - self.spin_progress(t)
        spin = Quaternion(TUMBLE_AXIS, -2 * math.pi * TUMBLE_TURNS * remaining)
        nutation = Quaternion((1, 0, 0), math.radians(NUTATION_DEG) * remaining
                              * math.sin(2 * math.pi * 1.25 * t))
        return (0.0, 0.0, z), spin @ nutation, (1.0, 1.0, 1.0)

    def flyin(self, f):
        return self.flyin_at((f - self.tm.appear) / (self.tm.impact - self.tm.appear))

    # impact, settle, and the flashes -----------------------------------------
    def flash_pulses(self, f):
        """{lane: summed pulse} for flashes at or before f."""
        pulses = {}
        win = taper(f, self.tm.last_flash, self.tm.rest)
        for frame, lane in self.tm.flashes:
            if f >= frame:
                pulse = math.exp(-self.sec(f - frame) / FLASH_DECAY_SEC) * win
                pulses[lane] = pulses.get(lane, 0.0) + pulse
        return pulses

    def settle(self, f):
        t = self.sec(f - self.tm.impact)
        win = taper(t, SETTLE_SEC - SETTLE_FADE_SEC, SETTLE_SEC)
        # rebound away from the viewer, then one overshoot toward it
        z = -(RECOIL_SIZE / RECOIL_PEAK * self.cam_dist) * damped_sin(t, RECOIL_SPRING) * win
        yaw = math.radians(WOBBLE_YAW_DEG) * damped_sin(t, RECOIL_SPRING) * win
        pitch = -math.radians(WOBBLE_PITCH_DEG) * damped_sin(t, PITCH_SPRING) * win
        depth = 1 - (1 - SQUASH_DEPTH) * damped_cos(t, SQUASH_SPRING) * win
        xy = depth ** -SQUASH_BULGE
        pulse = sum(self.flash_pulses(f).values())
        xy *= 1 + FLASH_SCALE * pulse
        depth *= 1 + FLASH_SCALE * pulse
        pitch -= math.radians(FLASH_NOD_DEG) * pulse
        rot = Quaternion((0, 1, 0), yaw) @ Quaternion((1, 0, 0), pitch)
        return (0.0, 0.0, z), rot, (xy, xy, depth)

    # idle ----------------------------------------------------------------------
    def idle(self, f):
        rest, last = self.tm.rest, self.tm.last
        ramp = smoothstep(rest, rest + IDLE_RAMP_SEC * self.tm.fps, f)
        # whole cycles between the rest frame and the last frame, so every
        # term is exactly zero at both
        ph = 2 * math.pi * (f - rest) / (last - rest)
        yaw = math.radians(IDLE_SWAY_DEG) * math.sin(ph) * ramp
        roll = math.radians(IDLE_ROLL_DEG) * math.sin(ph) * ramp
        pitch = math.radians(IDLE_PITCH_DEG) * math.sin(3 * ph) * ramp
        y = self.float_units * math.sin(2 * ph) * ramp
        rot = (Quaternion((0, 1, 0), yaw) @ Quaternion((1, 0, 0), pitch)
               @ Quaternion((0, 0, 1), roll))
        return (0.0, y, 0.0), rot, (1.0, 1.0, 1.0)

    def pose(self, f):
        tm = self.tm
        if f < tm.appear - 0.5 or (f < tm.impact and tm.impact == tm.appear):
            # not there yet: where it will pop in, scaled to nothing
            loc, rot, _ = self.flyin_at(0.0)
            return loc, rot, (1e-6, 1e-6, 1e-6)
        if f < tm.impact:
            return self.flyin(f)
        if f < tm.rest:
            return self.settle(f)
        if f in (tm.rest, tm.last) or tm.rest >= tm.last:
            return REST_POSE
        return self.idle(f)

    # lights ------------------------------------------------------------------------
    def sheen(self, f):
        """(orbit angle in radians, level 0..1) of the downbeat sheen."""
        half = SHEEN_HALF_SEC * self.tm.fps
        for beat in self.tm.sheens:
            u = (f - beat) / half
            if -1 < u < 1:
                # The flat face mirrors only a few degrees around the camera, so
                # the orbit slows right down through the middle (sinh profile):
                # the sheen glides across the face around the downbeat, and
                # rolls over the bevels on the way in and out.
                s = math.sinh(SHEEN_SLOW * u) / math.sinh(SHEEN_SLOW)
                return math.radians(SHEEN_ARC_DEG) * s, math.cos(0.5 * math.pi * u)
        return math.radians(-SHEEN_ARC_DEG), 0.0

    def impact_flare(self, f):
        """Rim-light boost that rings out after the hit."""
        t = self.sec(f - self.tm.impact)
        if t < 0:
            return 0.0
        return (IMPACT_FLARE * math.exp(-t / IMPACT_FLARE_SEC)
                * taper(t, SETTLE_SEC - SETTLE_FADE_SEC, SETTLE_SEC))


def keyframe_everything(motion, anim, lights, sheen):
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    rims = {k: lights[k].data.energy for k in lights if k.startswith(('rim_', 'lane_'))}
    orient_q = Euler((math.radians(90), 0.0, 0.0)).to_quaternion()
    to_camera = Vector((0.0, -1.0, 0.0))
    # Sub-frame keys through the fly-in and settle so motion blur samples the
    # real curves; whole frames are enough once the mark is at rest.
    rest, last = motion.tm.rest, motion.tm.last
    times = [k / 8 for k in range(-3 * 8, (rest + 2) * 8 + 1)]
    times += list(range(rest + 3, last + 3))
    up = Vector((0.0, 0.0, 1.0))
    tilt = math.radians(SHEEN_TILT_DEG)
    prev_q = None
    prev_cq = {'catch_up': None, 'catch_down': None}
    for f in times:
        loc, q, scl = motion.pose(f)
        if prev_q is not None and prev_q.dot(q) < 0:
            q = -q
        prev_q = q.copy()
        anim.location = loc
        anim.rotation_quaternion = q
        anim.scale = scl
        anim.keyframe_insert('location', frame=f)
        anim.keyframe_insert('rotation_quaternion', frame=f)
        anim.keyframe_insert('scale', frame=f)
        # the rig sits at the mark's world position (Orient maps x, y, z to x, -z, y)
        lights['rig'].location = (loc[0], -loc[2], loc[1])
        lights['rig'].keyframe_insert('location', frame=f)

        # The sheen's band is centered on the face's mirror direction (the
        # camera ray reflected off the face), orbited sideways by the sheen.
        # The long lens makes the flat face mirror only a few degrees around
        # that direction, and the idle sway turns it by twice the sway angle,
        # so centering on it lands the band on the face center exactly on the
        # downbeat.
        angle, level = motion.sheen(f)
        normal = orient_q @ q @ Vector((0.0, 0.0, 1.0))
        mirror = (2 * normal.dot(to_camera) * normal - to_camera).normalized()
        center = Quaternion((0.0, 0.0, 1.0), angle) @ mirror
        rise = (up - up.dot(center) * center).normalized()
        right = up.cross(center).normalized()  # screen right, as the face mirrors it
        along = math.cos(tilt) * rise - math.sin(tilt) * right  # up and to the left
        plane = center.cross(along).normalized()
        for name, vec in (('plane', plane), ('center', center)):
            for i in range(3):
                sheen[name].inputs[i].default_value = vec[i]
                sheen[name].inputs[i].keyframe_insert('default_value', frame=f)
        sheen['level'].outputs[0].default_value = level
        sheen['level'].outputs[0].keyframe_insert('default_value', frame=f)
        # the catch strips sit along the band's ends, lying along the band
        mid = math.radians(0.5 * (CATCH_FROM_DEG + CATCH_TO_DEG))
        for end, sign in (('catch_up', 1.0), ('catch_down', -1.0)):
            out = (math.cos(mid) * center + math.sin(mid) * sign * along).normalized()
            tangent = (math.cos(mid) * sign * along - math.sin(mid) * center).normalized()
            side = tangent.cross(out).normalized()
            basis = Matrix((side, tangent, out)).transposed()  # local X, Y, Z columns
            catch = lights[end]
            catch.location = CATCH_RADIUS * out
            cq = basis.to_quaternion()
            if prev_cq[end] is not None and prev_cq[end].dot(cq) < 0:
                cq = -cq
            prev_cq[end] = cq.copy()
            catch.rotation_quaternion = cq
            catch.keyframe_insert('location', frame=f)
            catch.keyframe_insert('rotation_quaternion', frame=f)
            catch.data.energy = CATCH_ENERGY * level
            catch.data.keyframe_insert('energy', frame=f)

        flare = motion.impact_flare(f)
        pulses = motion.flash_pulses(f)
        for k, base in rims.items():
            flash = 0.0
            if k.startswith('lane_'):
                flash = FLASH_LIGHT * pulses.get(int(k.split('_')[1]), 0.0)
            lights[k].data.energy = base * (1 + flare + flash)
            lights[k].data.keyframe_insert('energy', frame=f)
