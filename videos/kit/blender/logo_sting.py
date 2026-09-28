"""3D logo sting for a film's final hit.

Builds the brand mark procedurally (the lucide "music" glyph as raised white
tubes on a beveled rounded-square slab in the brand colours), animates it on
the film's musical events, and renders a square RGBA PNG sequence with a
transparent background. The pieces live in the sibling modules: sting_timing
(the events), sting_geometry (the mark and its rest framing), sting_look
(materials, world, lights) and sting_motion (the animation).

  appear   the first push: the mark pops in, far away; invisible before
  ->       flies in from depth, tumbling 1.25 turns, accelerating, motion blur
  impact   the second push: exactly frontal at full size, squashed in depth,
           then a recoil and one springy wobble
  flashes  each nudges the mark and flashes its lane-coloured rim light
  rest     exactly the resting pose
  ->       idle: a few pixels of float, a small sway, and a soft sheen across
           the face on each sheen frame
  last     exactly the resting pose again

Usage (every path from the command line; Blender 4.2 or later):

  Blender -b --factory-startup --python blender/logo_sting.py -- \\
      --events <events.json> --brand <brand.json> --size 1080 \\
      [--fps 60 --from 2370 --length 330] --out <dir> [--meta <file.json>]
  ... --out <dir> --frames 0,15,21,30 --size 540 --samples 16   (a preview)
  ... --still <file.png> --size 2048 --samples 128              (the rest pose)
  ... --meta <file.json>                                        (plan only)

--fps, --from (the film frame of sting frame 0) and --length default to the
events file's own (blender/stingEvents.ts writes them). Frames are written as
<out>/<NNNN>.png from sting frame 0. The meta JSON (default: <out>.json) is
what the kit's LogoSting player reads; it is written only for a complete
sequence, or on its own without --out.
"""

import argparse
import json
import math
import os
import sys
import time
import traceback

import bpy

# The sibling modules load from this folder; leave no bytecode cache in the kit.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sting_geometry import (CORNER, FOCAL_MM, HALF, ICON_FRAC, REST_SIZE_FRAC, SENSOR_MM,
                            SIDE, calibrate, glyph_geometry, mesh_object, slab_geometry)
from sting_look import Palette, build_lights, build_world, glyph_material, slab_material
from sting_motion import IDLE_FLOAT_FRAC, Motion, keyframe_everything
from sting_timing import Timing


def log(msg):
    print(f'[logo_sting] {msg}', flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser(prog='logo_sting.py')
    p.add_argument('--events', required=True,
                   help='events JSON: kicks, flashes and sheens in film frames')
    p.add_argument('--brand', required=True, help="the kit's brand JSON (colours)")
    p.add_argument('--size', type=int, required=True, help='square frame side in px')
    p.add_argument('--fps', type=float, help='frame rate (default: the events file)')
    p.add_argument('--from', dest='from_frame', type=int,
                   help='film frame of sting frame 0 (default: the events file)')
    p.add_argument('--length', type=int, help='sting frames (default: the events file)')
    p.add_argument('--out', help='directory for the PNG sequence')
    p.add_argument('--frames', help='comma-separated sting frames to render (a preview)')
    p.add_argument('--samples', type=int, default=64, help='Eevee samples per frame')
    p.add_argument('--still', help='render the resting pose to this PNG')
    p.add_argument('--meta', help='the meta JSON (default with --out: <out>.json)')
    p.add_argument('--save-blend', help='also save the built scene to this .blend')
    args = p.parse_args(argv)
    if not (args.out or args.still or args.save_blend or args.meta):
        p.error('nothing to do: give --out, --still, --meta, or --save-blend')
    if args.meta and args.out and args.frames:
        p.error('--meta describes a complete sequence: drop --frames, or drop --meta')
    if args.size < 16:
        p.error('--size must be at least 16 px')
    return args


def configure_render(scene, timing, size, samples):
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    fps = timing.fps
    scene.render.fps = round(fps)
    scene.render.fps_base = round(fps) / fps
    scene.render.film_transparent = True
    scene.render.filter_size = 1.5
    scene.render.dither_intensity = 1.0
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 15
    # PNGs carry only pixels: no render date or time, so reruns are identical
    scene.render.use_stamp = False
    for flag in ('date', 'time', 'render_time', 'frame', 'frame_range', 'memory', 'hostname',
                 'camera', 'lens', 'scene', 'marker', 'filename', 'sequencer_strip', 'note'):
        if hasattr(scene.render, f'use_stamp_{flag}'):
            setattr(scene.render, f'use_stamp_{flag}', False)
    # Standard keeps the brand purple exact where the face is lit to its albedo
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    ee = scene.eevee
    ee.taa_render_samples = samples
    ee.use_raytracing = True
    ee.ray_tracing_method = 'SCREEN'
    ee.ray_tracing_options.resolution_scale = '1'
    ee.ray_tracing_options.trace_max_roughness = 0.6
    ee.ray_tracing_options.use_denoise = True
    ee.use_fast_gi = True
    ee.use_shadows = True
    ee.shadow_ray_count = 2
    ee.shadow_step_count = 8
    ee.motion_blur_max = 160
    scene.render.motion_blur_position = 'CENTER'


def frame_settings(scene, timing, f, samples):
    """A long shutter on the fly-in, a crisp impact frame, light blur on the
    recoil, none at rest. The fly-in's motion blur splits its samples across
    time steps, so it gets twice as many."""
    r, ee = scene.render, scene.eevee
    ee.taa_render_samples = samples
    if timing.appear <= f < timing.impact:
        r.use_motion_blur, r.motion_blur_shutter, ee.motion_blur_steps = True, 0.7, 12
        ee.taa_render_samples = samples * 2
    elif timing.impact < f < timing.rest:
        r.use_motion_blur, r.motion_blur_shutter, ee.motion_blur_steps = True, 0.5, 1
    else:
        r.use_motion_blur = False


def build_scene(timing, palette, size):
    scene = bpy.context.scene
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for block in list(coll):
            coll.remove(block)
    scene.frame_start = 0
    scene.frame_end = timing.last

    cam_dist, unit, z_center = calibrate(size)
    log(f'camera distance {cam_dist:.5f}, glyph unit {unit:.6f}, glyph centerline z {z_center:.5f}')

    # Orient maps logo-local axes onto the world (Z up, camera on -Y).
    orient = bpy.data.objects.new('Orient', None)
    scene.collection.objects.link(orient)
    orient.rotation_euler = (math.radians(90), 0, 0)
    anim = bpy.data.objects.new('Mark', None)
    scene.collection.objects.link(anim)
    anim.parent = orient
    anim.rotation_mode = 'QUATERNION'

    slab_v, slab_f, slab_n = slab_geometry()
    mesh_object('Slab', slab_v, slab_f, slab_n, slab_material(palette)).parent = anim
    gv, gf, gn = glyph_geometry(unit, z_center)
    mesh_object('Glyph', gv, gf, gn, glyph_material()).parent = anim

    cam_data = bpy.data.cameras.new('Camera')
    cam_data.lens = FOCAL_MM
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.sensor_width = SENSOR_MM
    cam_data.clip_start = 0.5
    cam_data.clip_end = 2000.0
    cam = bpy.data.objects.new('Camera', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0.0, -cam_dist, 0.0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam

    _, sheen = build_world(scene)
    lights = build_lights(palette)
    float_units = IDLE_FLOAT_FRAC * (HALF / (REST_SIZE_FRAC / 2))
    keyframe_everything(Motion(timing, cam_dist, float_units), anim, lights, sheen)
    return scene


def sting_meta(timing, size):
    """The LogoSting player's view of the sequence (see README.md)."""
    side = REST_SIZE_FRAC * size
    return {
        'version': 1,
        'fps': int(timing.fps) if float(timing.fps).is_integer() else timing.fps,
        'frames': timing.length,
        'globalStart': timing.global_start,
        'digits': max(4, len(str(timing.last))),
        'frameSizePx': size,
        'appearFrame': timing.appear,
        'impactFrame': timing.impact,
        'flashFrames': [f for f, _ in timing.flashes],
        'restFrames': [timing.rest, timing.last],
        'sheenFrames': timing.sheens,
        'rest': {
            'centerPx': [size / 2, size / 2],
            'squarePx': round(side, 3),
            'cornerRadiusPx': round(side * CORNER / SIDE, 3),
            'iconBoxPx': round(side * ICON_FRAC, 3),
            'strokePx': round(side * ICON_FRAC / 12, 3),
        },
    }


def write_json_atomic(path, data):
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f'{path}.{os.getpid()}.tmp'
    with open(tmp, 'w') as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)


def render_still(scene, timing, f, samples, path):
    """Renders frame f to `path`. Blender writes the file itself, so it renders
    beside it and renames: a reader never sees half a PNG."""
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.frame_set(f)
    frame_settings(scene, timing, f, samples)
    scene.render.filepath = os.path.join(os.path.dirname(path), f'.{os.getpid()}.{f}.tmp.png')
    bpy.ops.render.render(write_still=True)
    os.replace(scene.render.filepath, path)


def render_frames(scene, timing, out_dir, frames, samples, digits):
    t_all = time.time()
    for f in frames:
        t0 = time.time()
        render_still(scene, timing, f, samples, os.path.join(out_dir, f'{f:0{digits}d}.png'))
        log(f'frame {f:4d} {time.time() - t0:6.2f}s')
    log(f'rendered {len(frames)} frames in {time.time() - t_all:.1f}s')


def main():
    args = parse_args()
    timing = Timing.from_events(args.events, args.fps, args.from_frame, args.length, log)
    log(timing.describe())
    palette = Palette.from_brand_json(args.brand)
    scene = build_scene(timing, palette, args.size)
    configure_render(scene, timing, args.size, args.samples)
    meta = sting_meta(timing, args.size)
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))
    if args.still:
        t0 = time.time()
        render_still(scene, timing, timing.rest, args.samples, args.still)
        log(f'still {args.still} {time.time() - t0:.1f}s')
    meta_path = args.meta
    if args.out:
        frames = ([int(x) for x in args.frames.split(',') if x.strip()] if args.frames
                  else list(range(timing.length)))
        bad = [f for f in frames if not 0 <= f <= timing.last]
        if bad:
            raise SystemExit(f'frames {bad} are outside the sting (0-{timing.last})')
        out = os.path.abspath(args.out)
        render_frames(scene, timing, out, frames, args.samples, meta['digits'])
        if not args.frames and not meta_path:
            meta_path = out.rstrip(os.sep) + '.json'
    if meta_path:
        write_json_atomic(meta_path, meta)
        log(f'wrote {meta_path}')


def run():
    """main(), exiting non-zero on any error: Blender itself exits 0 when a
    script raises anything but SystemExit."""
    try:
        main()
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001 - reported, then the exit code says it failed
        traceback.print_exc()
        sys.exit(1)


run()
